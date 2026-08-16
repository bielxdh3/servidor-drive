# Phase 12 — ZK sync and local WebDAV bridge

## Scope

This phase adds a versioned client protocol, a durable local operation journal,
a loopback-only trusted WebDAV bridge, and authenticated server-blind
`/sync/v1/objects` routes, including DELETE tombstones. Existing public WebDAV
routes and response shapes are unchanged. Phase 13 UI/search/PWA/groups, Phase 14 deployment, Phase 15 release,
and Phase 16 independent review are not implemented here.

## Trust boundaries

- The authorized local sync client may read/write plaintext inside its chosen
  root. The bridge is bound to loopback and bearer-token protected.
- The client creates AES-256-GCM envelopes using a caller-provided 32-byte
  per-file key. AAD binds protocol version, stable IDs, operation, Lamport
  revision, base revision, key epoch, compartment, and device.
- The server receives opaque ciphertext, envelope fields, tombstones, and an
  allow-listed bounded metadata subset. It has no key-handling or decryption
  path.
- The server store is scoped by authenticated username. Reads require
  `listFiles`; writes require `upload`; replay, stale, missing-base, and
  mismatched-base operations fail closed with conflict responses.

## Data safety

The client journal and server object store use temporary files, restrictive
file modes, flush/sync, rename, and directory sync. Journal restart recovery
returns pending operations and preserves seen operation IDs. Local DELETE is a
rename into a contained trash directory and is never permanent.

The bridge rejects encoded traversal, backslashes, NUL/control characters,
outside-root paths, and existing symlink components. The server route bounds
requests/ciphertext and persists sanitized records only.

## Validation and residuals

The independent bounded Phase 12 focused gate is recorded as 65/65 passed; the
local `test/phase12-sync.test.js` executable slice is 4/4. Coverage includes
AES-GCM/AAD, Lamport ordering, tombstones, journal restart recovery, bridge
authorization/containment/trash callbacks, and server route opaque
persistence/conflict/replay behavior. Syntax and diff/secret checks are
separate gates. Dependency-backed broader repository tests remain
environment-dependent when `node_modules` is unavailable.

Residual risk: local bridge security depends on protecting the bearer token and
the client root; path checks are application-level and do not provide an OS
openat-style race-free capability on every platform. Provider, browser,
production, deployment, release, and independent Phase 16 review evidence are
outside this phase.
