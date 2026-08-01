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

  app.get("/trash", authenticate, requirePermission("listFiles"), (req, res) => {
    if (!isTrashEnabled()) return res.status(503).json({ error: "Lixeira desativada" });
    const items = trashRepository.listTrashItems()
      .filter((item) => canManageTrash(req) || item.deletedBy === req.user.username)
      .map(serializeTrashItemForUser);
    res.json({ items, canManageTrash: canManageTrash(req) });
  });

  app.get("/trash/summary", authenticate, requirePermission("listFiles"), (req, res) => {
    if (!isTrashEnabled()) return res.status(503).json({ error: "Lixeira desativada" });
    const items = canManageTrash(req)
      ? trashRepository.listTrashItems()
      : trashRepository.listTrashItems().filter((item) => item.deletedBy === req.user.username);
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
        ? trashService.queueRemoteDeletion({ item, deletedBy: req.user.username, loaders: getTrashLoaders() })
        : trashService.permanentlyDelete({ item, deletedBy: req.user.username, loaders: getTrashLoaders() });
      let remoteDeletion = remoteRequired ? "pending" : "not_required";
      if (remoteRequired) {
        auditLog("trash.remote_delete.queued", getAuditActor(req), { type: "trash", id }, "remote_delete", "success", {});
        try {
          await deleteCloudTrashItem(deleted);
          deleted = trashService.completeRemoteDeletion(deleted);
          remoteDeletion = "completed";
          auditLog("trash.remote_delete.completed", getAuditActor(req), { type: "trash", id }, "remote_delete", "success", {});
        } catch {
          deleted = trashService.failRemoteDeletion(deleted);
          auditLog("trash.remote_delete.failed", getAuditActor(req), { type: "trash", id }, "remote_delete", "failure", {});
        }
      }
      if (remoteDeletion !== "pending") {
        auditLog(
          item.itemType === "file" ? "trash.file.permanently_deleted" : "trash.folder.permanently_deleted",
          getAuditActor(req),
          { type: "trash", id },
          "permanently_deleted",
          "success",
          { itemType: item.itemType, originalFolderId: item.originalFolderId, name: item.originalFileName }
        );
      }
      broadcastDataChanged("trash", { id, action: remoteDeletion === "pending" ? "remote_delete_pending" : "permanently_deleted" });
      res.json({ message: remoteDeletion === "completed" || remoteDeletion === "not_required" ? "Item excluido permanentemente" : "Exclusao remota pendente", remoteDeletion, item: serializeTrashItemForUser(deleted) });
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
    const items = trashRepository.listTrashItems();
    let deletedCount = 0;
    let pendingCount = 0;
    for (const item of items) {
      try {
        if (!isCloudStorageEnabled()) {
          trashService.permanentlyDelete({ item, deletedBy: req.user.username, loaders: getTrashLoaders() });
          deletedCount += 1;
          continue;
        }
        let deleted = trashService.queueRemoteDeletion({ item, deletedBy: req.user.username, loaders: getTrashLoaders() });
        auditLog("trash.remote_delete.queued", getAuditActor(req), { type: "trash", id: item.id }, "remote_delete", "success", {});
        try {
          await deleteCloudTrashItem(deleted);
          trashService.completeRemoteDeletion(deleted);
          deletedCount += 1;
          auditLog("trash.remote_delete.completed", getAuditActor(req), { type: "trash", id: item.id }, "remote_delete", "success", {});
        } catch {
          trashService.failRemoteDeletion(deleted);
          pendingCount += 1;
          auditLog("trash.remote_delete.failed", getAuditActor(req), { type: "trash", id: item.id }, "remote_delete", "failure", {});
        }
      } catch (error) {
        auditLog("trash.delete.failed", getAuditActor(req), { type: "trash", id: item.id }, "empty_trash", "failure", {
          error: error.message,
        });
      }
    }
    auditLog("trash.emptied", getAuditActor(req), { type: "trash", id: "all" }, "emptied", "success", { deletedCount });
    broadcastDataChanged("trash", { action: "emptied" });
    res.json({ message: "Lixeira esvaziada", deletedCount, pendingCount });
  });
}

module.exports = registerTrashRoutes;
