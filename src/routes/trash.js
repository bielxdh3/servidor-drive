function registerTrashRoutes(app, context) {
  const {
    addActionHistory,
    auditLog,
    authenticate,
    broadcastDataChanged,
    canManageTrash,
    canRestoreTrashItem,
    deleteCloudTrashItem,
    deleteCloudTrashItemLater,
    ensureFolderDirectories,
    getAuditActor,
    getCloudStorageStatus,
    getFolderById,
    getTrashLoaders,
    isTrashEnabled,
    isCloudStorageEnabled,
    requirePermission,
    requireTrashManageAccess,
    rootFolderId,
    serializeTrashItemForUser,
    trashRepository,
    trashService,
  } = context;

  const listVisibleItems = () => trashRepository.listTrashItems({ status: "*" })
    .filter((item) => ["trashed", "remote_delete_pending"].includes(item.status));
  const remoteStatus = (item) => item.metadata?.remoteDeletion?.state || "pending";

  app.get("/trash", authenticate, requirePermission("listFiles"), (req, res) => {
    if (!isTrashEnabled()) return res.status(503).json({ error: "Lixeira desativada" });
    const items = listVisibleItems()
      .filter((item) => canManageTrash(req) || item.deletedBy === req.user.username)
      .map(serializeTrashItemForUser);
    res.json({ items, canManageTrash: canManageTrash(req) });
  });

  app.get("/trash/summary", authenticate, requirePermission("listFiles"), (req, res) => {
    if (!isTrashEnabled()) return res.status(503).json({ error: "Lixeira desativada" });
    const items = listVisibleItems().filter((item) => canManageTrash(req) || item.deletedBy === req.user.username);
    res.json({
      count: items.length,
      sizeBytes: items.reduce((sum, item) => sum + (Number(item.sizeBytes) || 0), 0),
      canManageTrash: canManageTrash(req),
    });
  });

  app.post("/trash/:id/restore", authenticate, requirePermission("listFiles"), (req, res) => {
    if (!isTrashEnabled()) return res.status(503).json({ error: "Lixeira desativada" });
    const id = String(req.params.id || "");
    if (!/^[a-f0-9-]{36}$/i.test(id)) return res.status(400).json({ error: "Item de lixeira invalido" });
    const item = trashRepository.getTrashItem(id);
    if (item?.status === "remote_delete_pending") return res.status(409).json({ error: "Exclusao remota pendente", remoteDeletion: remoteStatus(item) });
    if (!item || item.status !== "trashed") return res.status(404).json({ error: "Item nao encontrado na lixeira" });
    if (!canRestoreTrashItem(req, item)) return res.status(403).json({ error: "Permissao negada para restaurar" });

    try {
      let restored;
      if (item.itemType === "file") {
        const folder = getFolderById(item.originalFolderId) || getFolderById(rootFolderId);
        const paths = ensureFolderDirectories(folder.id);
        restored = trashService.restoreFile({
          item,
          folder: { ...folder, ...paths },
          restoredBy: req.user.username,
          loaders: getTrashLoaders(),
        });
        auditLog("trash.file.restored", getAuditActor(req), { type: "trash", id }, "restored", "success", {
          originalFolderId: item.originalFolderId,
          fileName: item.originalFileName,
        });
      } else {
        restored = trashService.restoreFolder({
          item,
          restoredBy: req.user.username,
          loaders: getTrashLoaders(),
        });
        auditLog("trash.folder.restored", getAuditActor(req), { type: "trash", id }, "restored", "success", {
          originalFolderId: item.originalFolderId,
          folderName: item.originalFolderName,
        });
      }
      addActionHistory(item.itemType === "file" ? "trash_file_restored" : "trash_folder_restored", item.originalFileName || item.originalFolderName, req.user.username, { trashId: id });
      broadcastDataChanged("trash", { id, action: "restored" });
      res.json({ message: "Item restaurado", item: serializeTrashItemForUser(restored) });
    } catch (error) {
      auditLog("trash.restore.failed", getAuditActor(req), { type: "trash", id }, "restore", "failure", {
        itemType: item.itemType,
        error: error.message,
      });
      res.status(500).json({ error: "Erro ao restaurar item" });
    }
  });

  app.delete("/trash/:id", authenticate, requireTrashManageAccess, async (req, res) => {
    if (!isTrashEnabled()) return res.status(503).json({ error: "Lixeira desativada" });
    const id = String(req.params.id || "");
    if (!/^[a-f0-9-]{36}$/i.test(id)) return res.status(400).json({ error: "Item de lixeira invalido" });
    const item = trashRepository.getTrashItem(id);
    if (!item || item.status !== "trashed") return res.status(404).json({ error: "Item nao encontrado na lixeira" });

    try {
      const remoteRequired = isCloudStorageEnabled();
      let deleted = remoteRequired
        ? trashService.queueRemoteDeletion({ item, deletedBy: req.user.username, loaders: getTrashLoaders(), provider: getCloudStorageStatus?.().provider })
        : trashService.permanentlyDelete({ item, deletedBy: req.user.username, loaders: getTrashLoaders() });
      let remoteDeletion = remoteRequired ? "pending" : "not_required";
      if (remoteRequired) {
        auditLog("trash.remote_delete.queued", getAuditActor(req), { type: "trash", id }, "remote_delete", "success", {});
        try {
          deleted = await trashService.processRemoteDeletion({ item: deleted, provider: deleteCloudTrashItem });
          remoteDeletion = remoteStatus(deleted);
          if (remoteDeletion === "completed") auditLog("trash.remote_delete.completed", getAuditActor(req), { type: "trash", id }, "remote_delete", "success", {});
          else if (remoteDeletion === "terminal_failure") auditLog("trash.remote_delete.failed", getAuditActor(req), { type: "trash", id }, "remote_delete", "failure", {});
        } catch (error) {
          remoteDeletion = "terminal_failure";
          auditLog("trash.remote_delete.failed", getAuditActor(req), { type: "trash", id }, "remote_delete", "failure", { category: "persistence_failure" });
        }
      }
      if (["completed", "not_required"].includes(remoteDeletion)) {
        auditLog(
          item.itemType === "file" ? "trash.file.permanently_deleted" : "trash.folder.permanently_deleted",
          getAuditActor(req),
          { type: "trash", id },
          "permanently_deleted",
          "success",
          { itemType: item.itemType, originalFolderId: item.originalFolderId, name: item.originalFileName }
        );
      }
      broadcastDataChanged("trash", { id, action: remoteDeletion === "completed" || remoteDeletion === "not_required" ? "permanently_deleted" : "remote_delete_pending" });
      res.json({ message: remoteDeletion === "completed" || remoteDeletion === "not_required" ? "Item excluido permanentemente" : remoteDeletion === "terminal_failure" ? "Falha terminal na exclusao remota" : "Exclusao remota pendente", remoteDeletion, item: serializeTrashItemForUser(deleted) });
    } catch (error) {
      auditLog("trash.delete.failed", getAuditActor(req), { type: "trash", id }, "permanently_delete", "failure", {
        error: error.message,
      });
      res.status(500).json({ error: "Erro ao excluir permanentemente" });
    }
  });

  app.delete("/trash", authenticate, requireTrashManageAccess, async (req, res) => {
    if (!isTrashEnabled()) return res.status(503).json({ error: "Lixeira desativada" });
    if (req.body?.confirmation !== "DELETE") {
      return res.status(400).json({ error: "Confirmacao invalida. Digite DELETE." });
    }
    const items = listVisibleItems();
    let deletedCount = 0;
    let pendingCount = 0;
    for (const item of items) {
      try {
        if (!isCloudStorageEnabled()) {
          trashService.permanentlyDelete({ item, deletedBy: req.user.username, loaders: getTrashLoaders() });
          deletedCount += 1;
          continue;
        }
        let deleted = trashService.queueRemoteDeletion({ item, deletedBy: req.user.username, loaders: getTrashLoaders(), provider: getCloudStorageStatus?.().provider });
        auditLog("trash.remote_delete.queued", getAuditActor(req), { type: "trash", id: item.id }, "remote_delete", "success", {});
        try {
          deleted = await trashService.processRemoteDeletion({ item: deleted, provider: deleteCloudTrashItem });
          if (remoteStatus(deleted) === "completed") {
            deletedCount += 1;
            auditLog("trash.remote_delete.completed", getAuditActor(req), { type: "trash", id: item.id }, "remote_delete", "success", {});
          } else {
            pendingCount += 1;
            if (remoteStatus(deleted) === "terminal_failure") auditLog("trash.remote_delete.failed", getAuditActor(req), { type: "trash", id: item.id }, "remote_delete", "failure", {});
          }
        } catch {
          pendingCount += 1;
        }
      } catch (error) {
        auditLog("trash.delete.failed", getAuditActor(req), { type: "trash", id: item.id }, "empty_trash", "failure", {
          error: error.message,
        });
      }
    }
    auditLog("trash.emptied", getAuditActor(req), { type: "trash", id: "all" }, "emptied", "success", { deletedCount });
    broadcastDataChanged("trash", { action: "emptied" });
    res.json({ message: "Lixeira esvaziada", deletedCount, pendingCount, terminalCount: items.filter((item) => remoteStatus(item) === "terminal_failure").length });
  });
}

module.exports = registerTrashRoutes;
