# Phase 13 — protected client UX and groups

## Scope

Phase 13 adds a bounded browser client slice: AES-256-GCM protected metadata
indexes and previews, an opaque Phase 12 sync adapter, an installable public
PWA shell, a client-local encrypted offline queue boundary, additive groups,
and minimal groups/protected-client UI wiring. Existing server search,
preview, user sharing, and public WebDAV route shapes remain unchanged.

## Frozen trust boundary

- Protected index metadata and preview bodies are encrypted before local
  persistence or transport. Search decrypts entries locally before matching;
  search terms, keys, and protected plaintext are not sent to server routes.
- The browser sync adapter accepts only the Phase 12 opaque envelope. It
  rejects plaintext, keys, search terms, and preview bodies before submission.
- The service worker precaches only the public shell allow-list. Auth, API,
  files, previews, sync, groups, folders, and other protected paths bypass the
  cache. Tokens, keys, plaintext, and protected content are not cache inputs.
- The offline queue accepts already-encrypted envelopes only. It is a client
  local convenience boundary, not a claim that browser storage is a hardware
  secure enclave or that offline conflict resolution is complete.

## Groups and folder access

Groups are stored in `data/groups.json` using temporary-file plus rename
replacement. All CRUD and membership routes require authenticated
`manageUsers` authorization and return only group metadata/member usernames.
Folder `groupIds` are additive to existing per-user folder/file sharing:
membership grants folder read visibility, while existing individual ACLs and
edit rules remain in force. Deleting a group removes only that group ID from
folders; it does not revoke or rewrite individual user sharing entries.

## Validation and limitations

`test/phase13-client-ux.test.js` covers canonical protected-index search,
tamper and wrong-key rejection, protected preview leakage, opaque/offline
input rejection, service-worker cache exclusions, and group authorization,
atomic persistence, membership, and folder-access semantics. Browser install,
real multi-device offline replay, provider behavior, production deployment,
and independent Phase 16 review remain outside this bounded local phase.
