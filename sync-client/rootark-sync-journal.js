"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const JOURNAL_VERSION = 1;

function isUnsupportedDirectorySync(error) {
  return ["EINVAL", "ENOTSUP"].includes(error?.code)
    || (process.platform === "win32" && error?.code === "EPERM");
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fsp.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySync(error)) throw error;
  } finally {
    if (handle) await handle.close();
  }
}

async function durableWrite(filePath, value) {
  const directory = path.dirname(filePath);
  await fsp.mkdir(directory, { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const handle = await fsp.open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(temporary, filePath);
  await syncDirectory(directory);
}

class SyncJournal {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.state = { version: JOURNAL_VERSION, pending: [], seen: [] };
    this.queue = Promise.resolve();
  }

  async open() {
    try {
      this.state = JSON.parse(await fsp.readFile(this.filePath, "utf8"));
      if (this.state.version !== JOURNAL_VERSION || !Array.isArray(this.state.pending) || !Array.isArray(this.state.seen)) throw new Error("Invalid sync journal");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await durableWrite(this.filePath, this.state);
    }
    return this;
  }

  async commit(mutator) {
    this.queue = this.queue.then(async () => {
      const next = { version: JOURNAL_VERSION, pending: [...this.state.pending], seen: [...this.state.seen] };
      await mutator(next);
      next.pending = next.pending.slice(-10000);
      next.seen = next.seen.slice(-10000);
      await durableWrite(this.filePath, next);
      this.state = next;
    });
    return this.queue;
  }

  async enqueue(operation) {
    if (!operation?.operationId) throw new Error("Journal operationId required");
    await this.commit((next) => {
      if (!next.seen.includes(operation.operationId) && !next.pending.some((item) => item.operationId === operation.operationId)) next.pending.push(operation);
    });
    return operation;
  }

  async markSeen(operationId) {
    await this.commit((next) => {
      next.pending = next.pending.filter((item) => item.operationId !== operationId);
      if (!next.seen.includes(operationId)) next.seen.push(operationId);
    });
  }

  async update(operationId, patch) {
    await this.commit((next) => {
      const operation = next.pending.find((item) => item.operationId === operationId);
      if (operation) Object.assign(operation, patch);
    });
  }

  async replace(operationId, replacement) {
    await this.commit((next) => {
      const index = next.pending.findIndex((item) => item.operationId === operationId);
      if (index >= 0) next.pending[index] = { ...replacement };
    });
  }

  pending() { return this.state.pending.map((operation) => ({ ...operation })); }
  hasSeen(operationId) { return this.state.seen.includes(operationId); }
  async recover() { return this.pending(); }
}

module.exports = { SyncJournal, durableWrite };
