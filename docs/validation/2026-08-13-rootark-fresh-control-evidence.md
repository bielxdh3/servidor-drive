# Root.ark fresh control evidence — 2026-08-13

This is a fresh bounded execution of the exact 468-line attachment identified by SHA-256 `31822A11CACDC5B2693861F2CA945F0A895673F08E925EF1E66CBF4BE73B56DB`. This record does not reuse prior counts as fresh evidence.

## Status and provenance

- Executor context: `biel4`, configured App Server/headless backend, thread `019ffb95-e675-76e1-ae22-a3129af79b5a`.
- Latest fresh completed bounded turn: `019ffcfa-d41d-7fc2-a80b-f8790578b6c1`, request `rootark-exact-attachment-20260813-fresh-c`.
- Prior fresh turn `019ffcf0-0977-7e43-a8a8-70065bb1f937` was an incomplete timed-out attempt and is not fresh evidence.
- Repository: `E:\servidor-roadmap`.
- Branch: `cdx/rootark-roadmap`.
- Starting and final SHA for this bounded run: `28747c6ebdac873650e2d5a3c6193824e7cc9985`.
- The pre-existing dirty worktree was preserved. No runtime, test, package, dependency, user-data, ACL, branch, remote, or publication state was intentionally changed.
- The executor-created `.codex-fresh-cache-20260813-b` and `.codex-fresh-install-20260813-b` directories were identified as disposable dependency/cache artifacts and were removed only after exact-scope inspection. Post-cleanup checks verified both paths are absent; user data and unrelated dirty files were not targeted.

## Phase A — Git and worktree boundary

Fresh identity/status commands returned the branch and SHA above. The linked worktree uses a separate worktree Git metadata directory and common object store. Read-only inspection found no actionable live lock to repair. Direct repository-file writes are available, while safe writes to linked-worktree metadata/object locations are denied. No ACL or ownership change was attempted. Classification: `BLOCKED_ENVIRONMENT_LOCAL_GIT_ACL`; no commit was eligible or created.

## Phase B — toolchain and network diagnostics

| Command/probe | Exit | Result and classification |
|---|---:|---|
| `Get-Command node.exe`, `node --version`, `node -p process.execPath`, `node -p process.versions.modules` | 0 | Node `v24.14.1`, executable under the installed Node path, ABI `137`; toolchain identity available. |
| `Get-Command npm.cmd`, `npm.cmd --version` | 0 | npm `11.11.0`; `npm.cmd` is usable, while the PowerShell `npm` shim remains execution-policy sensitive. |
| `npm.cmd config get registry/cache/proxy/https-proxy/noproxy/cafile/strict-ssl/fetch-retries/fetch-timeout/maxsockets` | 0 | Registry is npmjs; cache path is local; proxy, CA-file, and no-proxy values were recorded only as redacted/empty; strict TLS is enabled; retry/timeout/socket settings were captured without secrets. |
| `Resolve-DnsName registry.npmjs.org -Type A` | 0 | DNS returned 12 A records. |
| `Test-NetConnection registry.npmjs.org -Port 443` | 1 | TCP 443 failed; `TcpTestSucceeded=False`; `BLOCKED_ENVIRONMENT_NETWORK`. |
| `curl.exe --max-time 10 .../express/latest` | 7 | HTTPS metadata probe returned HTTP 000 and could not connect; `BLOCKED_ENVIRONMENT_NETWORK_TLS`. |
| `curl.exe --max-time 10 .../better-sqlite3-12.9.0.tgz` | 7 | HTTPS package tarball probe returned HTTP 000 and could not connect; `BLOCKED_ENVIRONMENT_NETWORK_TLS`. |
| `curl.exe --max-time 10 .../security/advisories/bulk` | 7 | HTTPS advisory probe returned HTTP 000 and could not connect; `BLOCKED_ENVIRONMENT_REGISTRY_AUDIT`. |
| `npm.cmd cache verify --cache .codex-fresh-cache-20260813-b` | 0 | Disposable cache verified with zero cached content. |
| `npm.cmd ci --ignore-scripts --cache .codex-fresh-cache-20260813-b --no-audit --no-fund --prefer-online --fetch-retries=0 --fetch-timeout=15000` | 1 | npm reported `Exit handler never called`; no usable dependency installation; `BLOCKED_TOOLCHAIN_DEPENDENCY_INSTALL`. |
| `npm.cmd install --ignore-scripts --cache .codex-fresh-cache-20260813-b --no-audit --no-fund --prefer-online --fetch-retries=0 --fetch-timeout=15000` | 1 | Same npm failure; no usable dependency installation; `BLOCKED_TOOLCHAIN_DEPENDENCY_INSTALL`. |
| `npm.cmd rebuild better-sqlite3 --cache .codex-fresh-cache-20260813-b --no-audit --no-fund` | 0 | npm printed a success message, but post-check `require()` still failed; exit 0 is not usable native-binding evidence. |
| Compiler probe for `cl.exe`, `gcc`, `clang`, `msbuild`, `nmake`, `make` | 0 | All six compiler/build tools were missing; `BLOCKED_NATIVE_DEPENDENCY`. |
| Repository and disposable `require('better-sqlite3')` plus ABI probe | 1 | ABI `137`; both repository and disposable require/open checks failed with `MODULE_NOT_FOUND`; `BLOCKED_NATIVE_DEPENDENCY`. |

## Phase C — fresh validation ledger

Counts are from this run only. A failure caused by unavailable packages is classified as environment evidence, not as a source correction.

| Command | Exit | Counts | First actionable error | Classification |
|---|---:|---|---|---|
| `node --test test/realtime-transport-boundaries.test.js test/realtime-webdav-completed-recovery.test.js test/realtime-webdav-crash-consistency.test.js test/realtime-webdav-executable.test.js test/realtime-webdav-meta-remediation.test.js` | 1 | 0/5 passed | `MODULE_NOT_FOUND: bcryptjs` | `BLOCKED_ENVIRONMENT` |
| `node --test test/auth-security.test.js test/auth-core-boundaries.test.js` | 1 | 0/2 passed | `MODULE_NOT_FOUND: jsonwebtoken` (also bcryptjs) | `BLOCKED_ENVIRONMENT` |
| `node --test test/upload-security.test.js` | 1 | 0/1 passed | `MODULE_NOT_FOUND: bcryptjs` | `BLOCKED_ENVIRONMENT` |
| `node --test test/cloud-storage.test.js` | 1 | 19/27 passed, 8 failed | `MODULE_NOT_FOUND: @aws-sdk/client-s3` in S3 paths | `BLOCKED_ENVIRONMENT` |
| `node --test test/sqlite-recovery.test.js test/sqlite-stage-cleanup.test.js test/sqlite-meta-remediation.test.js test/sqlite-online-backup.test.js test/trash-route-persistence.test.js test/trash-local-completion.test.js test/trash-meta-remediation.test.js test/trash-remote-state.test.js test/trash-runtime-root.test.js test/trash-security.test.js` | 1 | 0/11 passed | `MODULE_NOT_FOUND: better-sqlite3` (some trash fixtures also require bcryptjs) | `BLOCKED_ENVIRONMENT` |
| `node --test test/users-repository.test.js test/backup-sqlite-path.test.js test/sqlite-meta-remediation.test.js test/sqlite-online-backup.test.js` | 1 | 0/4 passed | `MODULE_NOT_FOUND: better-sqlite3` | `BLOCKED_ENVIRONMENT` |
| Exact combined focused command covering realtime/auth/upload/cloud/WebDAV/SQLite/trash | 1 | 19/43 passed, 24 failed | `MODULE_NOT_FOUND: bcryptjs`; S3 and SQLite failures were dependency-loading failures | `BLOCKED_ENVIRONMENT` |
| `npm.cmd run validate:syntax` | 0 | 83 checked, 0 failed | None | `PASS` |
| `npm.cmd run validate:artifacts` | 0 | Validator passed | None | `PASS` |
| `npm.cmd test` | 1 | 34/106 passed, 72 failed; cancelled 0 | Missing `jsonwebtoken`, `bcryptjs`, `better-sqlite3`, `archiver`, `unzipper`, and `@aws-sdk/client-s3` | `BLOCKED_ENVIRONMENT` |
| `npm.cmd run validate:dependencies` | 1 | No audit result | Advisory endpoint request failed | `BLOCKED_ENVIRONMENT_REGISTRY_AUDIT` |
| `npm.cmd run validate:artifacts` | 0 | Validator passed | None | `PASS` |
| `npm.cmd run validate` | 1 | Syntax stage 83/83; test stage stopped the chain | Dependency-loading failures in `npm test`; audit stage not reached | `BLOCKED_ENVIRONMENT` |
| `git diff --check` | 0 | No whitespace errors | Git emitted only existing LF/CRLF warnings | `PASS` |

No test failure above establishes a source defect because the first actionable causes are missing dependencies from the failed disposable installation. Live ClamAV, OS WebDAV mount, external S3/Google Drive, browser, CI, production deployment, and complete JSON/SQLite parity remain unvalidated.

## Fresh rootark-zk-1 security review

Review target: the current `docs/architecture/zero-knowledge-migration-contract.md`, including its asset inventory, trust boundaries, attacker model, `rootark-zk-1` recommendation, AES-256-GCM AEAD, HPKE X25519/HKDF-SHA-256, HKDF domain separation, Argon2id recovery protection, Ed25519 authorization, deterministic CBOR/COSE envelope, nonce/key separation, AAD/version registry, device/recovery/rotation, derived data, server-blind sharing, backup/erasure, local WebDAV bridge, sync, migration/rollback/downgrade, vectors/interoperability, and failure classes.

**Formal verdict: Approved with reservations.**

Confirmed findings:

1. The document is technically concrete and uses standard primitives without custom cryptography. It cleanly separates the Architect recommendation from implementation approval, owner policy, and the current server-readable legacy behavior.
2. The CEK/CER/device hierarchy, per-purpose HKDF contexts, distinct wrapping treatment, authenticated AAD, monotonic suite/version registry, and fail-closed nonce/replay/downgrade classes form a coherent target boundary.
3. Device authorization, recovery-package verification, compromise rotation, encrypted derived data, server-blind sharing, ciphertext-only backups, erasure inventory, local bridge, opaque sync, and migration checkpoints are all explicitly covered and do not claim current implementation.

Required fixes/gates before implementation:

1. Independent cryptographic review must validate the exact library provenance, platform backends, HPKE/Argon2id/Ed25519 support, reproducible artifacts, nonce-ledger durability, deterministic CBOR/COSE profile, and all suite/vector fixtures.
2. Owner decisions must explicitly settle sharing UX/expiry/recipient recovery, recovery authority, mixed-mode migration window, sync conflict authority, and authentication/2FA coupling.
3. Implementation acceptance must prove two-client or equivalent interoperability, negative/fuzz/property coverage, recovery/rotation/compromise behavior, bridge crash safety, migration rollback, backup/restore, and no plaintext/key leakage in logs or errors.

Residual risks:

- A compromised authorized endpoint or recipient can expose its own plaintext or exported keys; revocation cannot erase those copies.
- Metadata, size, timing, routing, quota, retention, and access-pattern leakage remains possible and needs a deployment register.
- Legacy server-readable objects, backups, previews, scanning, native WebDAV, and one-way sync remain outside the target claim until migrated or expired.

Unvalidated boundaries:

- No cryptographic implementation, dependency selection/installation, vector execution, client interoperability, migration, local bridge, bidirectional sync, provider, browser, CI, production, or OS-mount validation was performed.
- The architecture document's own recommendation remains pending independent security review; Phase 8 is therefore `PARTIAL`, and Phase 9 is `NOT_STARTED`.

## Phase and publication disposition

- Phase 8: `PARTIAL` — architecture technically specified; independent review, implementation, migration, and acceptance remain open.
- Phase 9: `NOT_STARTED` — no crypto implementation or migration scaffolding was added.
- Phase 15: `BLOCKED_ENVIRONMENT` — local release evidence is blocked by dependency/network/native/provider/CI gaps. Publication authorization remains a separate boundary.
- No local commit was created. No remote or publication action was performed.
- Cleanup of only the two named disposable directories was attempted but rejected by the execution sandbox before mutation; no user data was removed.

## Next action

Restore an approved disposable package/network path, rerun the exact dependency install and full ledger, then repeat independent security review and publication checks. Do not change ACLs broadly, implement cryptography, migrate data, or mutate remote state as part of that recovery.
