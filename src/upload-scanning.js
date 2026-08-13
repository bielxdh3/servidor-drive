const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const net = require("net");

function createUploadScanning({
  rootFolderId,
  quarantineDirectory,
  uploadScanEnabled,
  uploadScanProvider,
  clamAvHost,
  clamAvPort,
  uploadBlockExecutables,
  uploadFailClosed,
  suspiciousExtensions,
  loadQuarantine,
  saveQuarantine,
  getAuditActor,
  auditLog,
  isSafeChildPath,
}) {
  function sanitizeQuarantineFilename(name) {
    const base = path.basename(String(name || "upload.bin")).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
    return (base || "upload.bin").slice(0, 120);
  }

  function getClamAvPort() {
    return Number.isInteger(clamAvPort) && clamAvPort > 0 ? clamAvPort : 3310;
  }

  function scanFileWithClamAv(filePath) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: clamAvHost, port: getClamAvPort() });
      const chunks = [];
      let settled = false;

      function finish(error, result) {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(result);
      }

      socket.setTimeout(5000, () => finish(new Error("ClamAV indisponivel: timeout")));
      socket.on("error", (error) => finish(error));
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => {
        const response = Buffer.concat(chunks).toString("utf-8").trim();
        if (/FOUND$/i.test(response)) {
          const virus = response.replace(/^stream:\s*/i, "").replace(/\s+FOUND$/i, "");
          return finish(null, { status: "infected", provider: "clamav", virus, raw: response.slice(0, 300) });
        }
        if (/OK$/i.test(response)) {
          return finish(null, { status: "clean", provider: "clamav", raw: response.slice(0, 300) });
        }
        return finish(new Error(response || "Resposta invalida do ClamAV"));
      });

      socket.on("connect", () => {
        socket.write(Buffer.from("zINSTREAM\0"));
        const input = fs.createReadStream(filePath);
        input.on("data", (chunk) => {
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length, 0);
          socket.write(size);
          socket.write(chunk);
        });
        input.on("end", () => socket.write(Buffer.alloc(4)));
        input.on("error", (error) => finish(error));
      });
    });
  }

  function quarantineUploadedFile(req, options) {
    const folderId = options.folderId || rootFolderId;
    const originalFilename = path.basename(options.originalName || options.fileName || "upload.bin");
    const storedQuarantineFilename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${sanitizeQuarantineFilename(originalFilename)}`;
    const destinationPath = path.join(quarantineDirectory, storedQuarantineFilename);

    fs.mkdirSync(quarantineDirectory, { recursive: true });
    if (!isSafeChildPath(quarantineDirectory, destinationPath)) {
      throw new Error("Caminho de quarentena invalido");
    }

    try {
      fs.renameSync(options.filePath, destinationPath);
    } catch (error) {
      fs.copyFileSync(options.filePath, destinationPath);
      fs.rmSync(options.filePath, { force: true });
    }

    const entries = loadQuarantine();
    const item = {
      id: crypto.randomUUID(),
      originalFilename,
      storedQuarantineFilename,
      uploader: req.user?.username || "anonymous",
      folderId,
      size: Number(options.size) || fs.statSync(destinationPath).size,
      reason: options.reason || "blocked",
      scanResult: options.scanResult || {},
      timestamp: new Date().toISOString(),
    };
    entries.items.unshift(item);
    saveQuarantine(entries);

    auditLog("upload.quarantined", getAuditActor(req), { type: "quarantine", id: item.id }, "quarantined", "success", {
      filename: originalFilename,
      folderId,
      reason: item.reason,
      result: item.scanResult?.status || "blocked",
    });

    return item;
  }

  async function scanUploadBeforePending(req, options) {
    if (!uploadScanEnabled) {
      return { allowed: true, scanResult: { status: "skipped", provider: "disabled" } };
    }

    const fileName = path.basename(options.fileName || options.originalName || "");
    const folderId = options.folderId || rootFolderId;
    const extension = path.extname(fileName).toLowerCase();
    const auditTarget = { type: "file", id: fileName };

    if (uploadBlockExecutables && suspiciousExtensions.has(extension)) {
      const scanResult = { status: "suspicious", provider: "extension-block", extension };
      auditLog("upload.scan.suspicious", getAuditActor(req), auditTarget, "scan", "failure", {
        filename: fileName,
        folderId,
        reason: "suspicious_extension",
        extension,
      });
      const quarantine = quarantineUploadedFile(req, {
        ...options,
        reason: "suspicious_extension",
        scanResult,
      });
      return {
        allowed: false,
        status: 415,
        error: "Upload bloqueado por politica de seguranca.",
        quarantine,
        scanResult,
      };
    }

    if (uploadScanProvider !== "clamav") {
      auditLog("upload.scan.clean", getAuditActor(req), auditTarget, "scan", "success", {
        filename: fileName,
        folderId,
        provider: uploadScanProvider,
        result: "skipped",
      });
      return { allowed: true, scanResult: { status: "skipped", provider: uploadScanProvider } };
    }

    try {
      const scanResult = await scanFileWithClamAv(options.filePath);
      if (scanResult.status === "infected") {
        auditLog("upload.scan.infected", getAuditActor(req), auditTarget, "scan", "failure", {
          filename: fileName,
          folderId,
          provider: "clamav",
          virus: scanResult.virus,
        });
        const quarantine = quarantineUploadedFile(req, {
          ...options,
          reason: "clamav_infected",
          scanResult,
        });
        return {
          allowed: false,
          status: 422,
          error: "Upload bloqueado pela verificacao de seguranca.",
          quarantine,
          scanResult,
        };
      }

      auditLog("upload.scan.clean", getAuditActor(req), auditTarget, "scan", "success", {
        filename: fileName,
        folderId,
        provider: "clamav",
        result: scanResult.status,
      });
      return { allowed: true, scanResult };
    } catch (error) {
      const scanResult = { status: "failed", provider: "clamav", error: error.message };
      auditLog("upload.scan.failed", getAuditActor(req), auditTarget, "scan", "failure", {
        filename: fileName,
        folderId,
        provider: "clamav",
        failClosed: uploadFailClosed,
        error: error.message,
      });

      if (uploadFailClosed) {
        const quarantine = quarantineUploadedFile(req, {
          ...options,
          reason: "scan_failed_fail_closed",
          scanResult,
        });
        return {
          allowed: false,
          status: 503,
          error: "Upload bloqueado: scanner indisponivel.",
          quarantine,
          scanResult,
        };
      }

      return { allowed: true, scanResult };
    }
  }

  return { scanUploadBeforePending };
}

module.exports = { createUploadScanning };
