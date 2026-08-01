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
  const loadPersistedItem = (id) => {
    const persisted = trashRepository.getTrashItem(id);
    if (!persisted) throw Object.assign(new Error("Trash item persistence is unavailable"), { code: "persistence_unavailable" });
    return persisted;
  };
  const recordPersistenceFailure = (req, id, error) => {
    auditLog("trash.delete.persistence_failed", getAuditActor(req), { type: "trash", id }, "persistence", "failure", {
      category: error?.code === "persistence_unavailable" ? "reload_failed" : "persistence_error",
    });
  };
  const persistenceFailure = (req, id, error, res) => {
    recordPersistenceFailure(req, id, error);
    return res.status(500).json({ error: "Erro de persistencia da lixeira" });
  };

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
      let operationError = null;
      try {
        let deleted = remoteRequired
          ? trashService.queueRemoteDeletion({ item, deletedBy: req.user.username, loaders: getTrashLoaders(), provider: getCloudStorageStatus?.().provider })
          : trashService.permanentlyDelete({ item, deletedBy: req.user.username, loaders: getTrashLoaders() });
        if (remoteRequired) await trashService.processRemoteDeletion({ item: deleted, provider: deleteCloudTrashItem });
      } catch (error) {
        operationError = error;
      }
      let deleted;
      try {
        deleted = loadPersistedItem(id);
      } catch (error) {
        return persistenceFailure(req, id, error, res);
      }
      const persistedRemoteState = deleted.metadata?.remoteDeletion?.state;
      if (operationError && (!remoteRequired || !["pending", "retry_wait", "completed", "terminal_failure"].includes(persistedRemoteState))) {
        if (!remoteRequired && deleted.status === "trashed") {
          auditLog("trash.delete.failed", getAuditActor(req), { type: "trash", id }, "permanently_delete", "failure", {
            category: operationError.code || "operational_failure",
          });
          return res.status(500).json({ error: "Erro ao excluir permanentemente" });
        }
        return persistenceFailure(req, id, operationError, res);
      }
      const remoteDeletion = remoteRequired ? remoteStatus(deleted) : "not_required";
      if (remoteRequired && persistedRemoteState === "pending") {
        auditLog("trash.remote_delete.queued", getAuditActor(req), { type: "trash", id }, "remote_delete", "success", {});
      } else if (remoteDeletion === "completed") {
        auditLog("trash.remote_delete.completed", getAuditActor(req), { type: "trash", id }, "remote_delete", "success", {});
      } else if (remoteDeletion === "terminal_failure") {
        auditLog("trash.remote_delete.failed", getAuditActor(req), { type: "trash", id }, "remote_delete", "failure", { category: deleted.metadata.remoteDeletion.failureCategory });
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
    let terminalCount = 0;
    let persistenceFailed = false;
    for (const item of items) {
      try {
        let operationError = null;
        if (!isCloudStorageEnabled()) {
          try { trashService.permanentlyDelete({ item, deletedBy: req.user.username, loaders: getTrashLoaders() }); } catch (error) { operationError = error; }
        } else {
          try {
            const queued = trashService.queueRemoteDeletion({ item, deletedBy: req.user.username, loaders: getTrashLoaders(), provider: getCloudStorageStatus?.().provider });
            await trashService.processRemoteDeletion({ item: queued, provider: deleteCloudTrashItem });
          } catch (error) { operationError = error; }
        }
        let persisted;
        try { persisted = loadPersistedItem(item.id); } catch (error) {
          persistenceFailed = true;
          recordPersistenceFailure(req, item.id, error);
          continue;
        }
        const state = isCloudStorageEnabled() ? remoteStatus(persisted) : "not_required";
        if (operationError && isCloudStorageEnabled() && !["pending", "retry_wait", "completed", "terminal_failure"].includes(state)) {
          persistenceFailed = true;
          recordPersistenceFailure(req, item.id, operationError);
          continue;
        }
        if (operationError && !isCloudStorageEnabled()) continue;
        if (state === "completed" || state === "not_required") deletedCount += 1;
        else if (state === "terminal_failure") terminalCount += 1;
        else pendingCount += 1;
      } catch (error) {
        auditLog("trash.delete.failed", getAuditActor(req), { type: "trash", id: item.id }, "empty_trash", "failure", {
          category: error.code || "operational_failure",
        });
      }
    }
    const persistedItems = listVisibleItems();
    terminalCount = persistedItems.filter((entry) => remoteStatus(entry) === "terminal_failure").length;
    if (persistenceFailed) return res.status(500).json({ error: "Erro de persistencia da lixeira" });
    auditLog("trash.emptied", getAuditActor(req), { type: "trash", id: "all" }, "emptied", "success", { deletedCount });
    broadcastDataChanged("trash", { action: "emptied" });
    res.json({ message: "Lixeira esvaziada", deletedCount, pendingCount, terminalCount });
  });
}

module.exports = registerTrashRoutes;
