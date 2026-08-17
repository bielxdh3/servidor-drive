"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateManifest } = require("../services/groupKeySharing");

const STORE_VERSION = 1;
const MAX_GROUP_NAME = 80;
const MAX_MEMBERS = 500;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function atomicWrite(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function emptyState() {
  return { version: STORE_VERSION, groups: {} };
}

function normalizeName(value) {
  const name = String(value || "").trim();
  return name && name.length <= MAX_GROUP_NAME && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}

function normalizeMembers(value, validUsers) {
  if (!Array.isArray(value) || value.length > MAX_MEMBERS) return null;
  const members = [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  return members.every((member) => validUsers.has(member)) ? members.sort((left, right) => left.localeCompare(right)) : null;
}

function assertMemberLimit(members) {
  if (!Array.isArray(members) || members.length > MAX_MEMBERS) throw new RangeError("Group member limit exceeded");
  return members;
}

function isGroupMember(store, username, ids) {
  const member = String(username || "");
  return Boolean(store && Array.isArray(ids) && ids.some((id) => store.state.groups[String(id)]?.members.includes(member)));
}

class AtomicGroupsStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.state = emptyState();
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (parsed?.version !== STORE_VERSION || !parsed.groups || typeof parsed.groups !== "object") throw new Error("Invalid groups store");
      this.state = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      atomicWrite(this.filePath, this.state);
    }
  }

  save(next) {
    atomicWrite(this.filePath, next);
    this.state = next;
  }

  list() {
    return Object.values(this.state.groups).map((group) => clone(group));
  }

  get(id) {
    const group = this.state.groups[String(id || "")];
    return group ? clone(group) : null;
  }

  validateIds(ids) {
    if (ids === undefined) return [];
    if (!Array.isArray(ids)) return null;
    const normalized = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
    return normalized.every((id) => Boolean(this.state.groups[id])) ? normalized : null;
  }

  isMember(username, ids) {
    return isGroupMember(this, username, ids);
  }

  create(name, members) {
    assertMemberLimit(members);
    const now = new Date().toISOString();
    const id = `group-${crypto.randomUUID()}`;
    const group = { id, name, members, keyEpoch: 1, keyManifest: null, createdAt: now, updatedAt: now };
    const next = clone(this.state);
    next.groups[id] = group;
    this.save(next);
    return clone(group);
  }

  update(id, changes) {
    const current = this.state.groups[id];
    if (!current) return null;
    if (changes.members !== undefined) assertMemberLimit(changes.members);
    const next = clone(this.state);
    const membershipChanged = changes.members && JSON.stringify(changes.members) !== JSON.stringify(current.members);
    next.groups[id] = { ...current, ...changes, keyEpoch: membershipChanged ? (current.keyEpoch || 1) + 1 : (current.keyEpoch || 1), keyManifest: membershipChanged ? null : current.keyManifest || null, updatedAt: new Date().toISOString() };
    this.save(next);
    return clone(next.groups[id]);
  }

  setKeyManifest(id, manifest) {
    const current = this.state.groups[id];
    if (!current) return null;
    const normalized = validateManifest(manifest);
    if (normalized.groupId !== id || normalized.epoch !== (current.keyEpoch || 1)) throw new Error("Stale group key manifest");
    const next = clone(this.state);
    next.groups[id] = { ...current, keyManifest: normalized, updatedAt: new Date().toISOString() };
    this.save(next);
    return clone(next.groups[id]);
  }

  remove(id) {
    if (!this.state.groups[id]) return false;
    const next = clone(this.state);
    delete next.groups[id];
    this.save(next);
    return true;
  }
}

function publicGroup(group) {
  return {
    id: group.id,
    name: group.name,
    members: [...group.members],
    memberCount: group.members.length,
    keyEpoch: group.keyEpoch || 1,
    wrapCount: group.keyManifest?.wraps?.length || 0,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

function registerGroupRoutes({
  app,
  authenticate,
  requirePermission,
  loadUsers,
  loadFolders,
  saveFolders,
  auditLog,
  getAuditActor,
  storagePath = process.env.GROUPS_FILE || "./data/groups.json",
}) {
  const store = new AtomicGroupsStore(storagePath);
  const authorize = [authenticate, requirePermission("manageUsers")];
  const validUsers = () => new Set(loadUsers().map((user) => user.username));
  const respondInvalid = (res, message = "Dados de grupo invalidos") => res.status(400).json({ error: message });
  const cleanGroup = (req, res, existing = null) => {
    const name = req.body?.name === undefined && existing ? existing.name : normalizeName(req.body?.name);
    const members = req.body?.members === undefined && existing ? existing.members : normalizeMembers(req.body?.members, validUsers());
    if (!name) return respondInvalid(res, "Nome do grupo e obrigatorio");
    if (!members) return respondInvalid(res, "Membros invalidos");
    return { name, members };
  };

  app.get("/groups", authorize, (_req, res) => res.json(store.list().map(publicGroup)));

  app.get("/groups/:groupId/key-manifest", authenticate, (req, res) => {
    const group = store.get(req.params.groupId);
    if (!group) return res.status(404).json({ error: "Grupo nao encontrado" });
    const canRead = req.user?.role === "admin" || req.user?.permissions?.manageUsers || store.isMember(req.user?.username, [group.id]);
    if (!canRead) return res.status(403).json({ error: "Permissao negada" });
    return res.json(group.keyManifest || { groupId: group.id, epoch: group.keyEpoch || 1, wraps: [] });
  });

  app.post("/groups/:groupId/key-manifest", authorize, (req, res) => {
    try {
      const group = store.setKeyManifest(req.params.groupId, req.body);
      if (!group) return res.status(404).json({ error: "Grupo nao encontrado" });
      auditLog("group.key_manifest.updated", getAuditActor(req), { type: "group", id: group.id }, "modified", "success", { epoch: group.keyEpoch, wrapCount: group.keyManifest.wraps.length });
      return res.status(201).json({ message: "Manifesto de chaves atualizado", group: publicGroup(group) });
    } catch { return respondInvalid(res, "Manifesto de chaves invalido ou desatualizado"); }
  });

  app.post("/groups", authorize, (req, res) => {
    const input = cleanGroup(req, res);
    if (!input) return;
    const group = store.create(input.name, input.members);
    auditLog("group.created", getAuditActor(req), { type: "group", id: group.id }, "created", "success", { memberCount: group.members.length });
    res.status(201).json({ message: "Grupo criado", group: publicGroup(group) });
  });

  app.put("/groups/:groupId", authorize, (req, res) => {
    const current = store.get(req.params.groupId);
    if (!current) return res.status(404).json({ error: "Grupo nao encontrado" });
    const input = cleanGroup(req, res, current);
    if (!input) return;
    const group = store.update(current.id, input);
    auditLog("group.updated", getAuditActor(req), { type: "group", id: group.id }, "modified", "success", { memberCount: group.members.length });
    res.json({ message: "Grupo atualizado", group: publicGroup(group) });
  });

  app.put("/groups/:groupId/members", authorize, (req, res) => {
    const current = store.get(req.params.groupId);
    if (!current) return res.status(404).json({ error: "Grupo nao encontrado" });
    const members = normalizeMembers(req.body?.members, validUsers());
    if (!members) return respondInvalid(res, "Membros invalidos");
    const group = store.update(current.id, { members });
    auditLog("group.members.changed", getAuditActor(req), { type: "group", id: group.id }, "modified", "success", { memberCount: members.length });
    res.json({ message: "Membros atualizados", group: publicGroup(group) });
  });

  app.post("/groups/:groupId/members", authorize, (req, res) => {
    const current = store.get(req.params.groupId);
    const username = String(req.body?.username || "").trim();
    if (!current) return res.status(404).json({ error: "Grupo nao encontrado" });
    if (!validUsers().has(username)) return res.status(400).json({ error: "Usuario invalido" });
    if (current.members.length >= MAX_MEMBERS && !current.members.includes(username)) return respondInvalid(res, "Limite de membros excedido");
    const members = [...new Set([...current.members, username])].sort((left, right) => left.localeCompare(right));
    const group = store.update(current.id, { members });
    auditLog("group.member.added", getAuditActor(req), { type: "group", id: group.id }, "modified", "success", { memberCount: members.length });
    res.status(201).json({ message: "Membro adicionado", group: publicGroup(group) });
  });

  app.delete("/groups/:groupId/members/:username", authorize, (req, res) => {
    const current = store.get(req.params.groupId);
    if (!current) return res.status(404).json({ error: "Grupo nao encontrado" });
    const members = current.members.filter((member) => member !== req.params.username);
    const group = store.update(current.id, { members });
    auditLog("group.member.removed", getAuditActor(req), { type: "group", id: group.id }, "modified", "success", { memberCount: members.length });
    res.json({ message: "Membro removido", group: publicGroup(group) });
  });

  app.delete("/groups/:groupId", authorize, (req, res) => {
    const group = store.get(req.params.groupId);
    if (!group) return res.status(404).json({ error: "Grupo nao encontrado" });
    store.remove(group.id);
    const folders = loadFolders();
    let changed = false;
    for (const folder of folders) {
      if (!Array.isArray(folder.groupIds) || !folder.groupIds.includes(group.id)) continue;
      folder.groupIds = folder.groupIds.filter((id) => id !== group.id);
      changed = true;
    }
    if (changed) saveFolders(folders);
    auditLog("group.deleted", getAuditActor(req), { type: "group", id: group.id }, "deleted", "success", { memberCount: group.members.length });
    res.json({ message: "Grupo excluido" });
  });

  return { store };
}

module.exports = { AtomicGroupsStore, MAX_GROUP_NAME, MAX_MEMBERS, isGroupMember, normalizeMembers, normalizeName, registerGroupRoutes };
