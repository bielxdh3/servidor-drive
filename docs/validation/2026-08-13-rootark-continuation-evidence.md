# Root.ark continuation evidence — 2026-08-13

## Scope and verdict

This is a source-backed local validation record for the bounded continuation of Issue #5 at repository `bielxdh3/root.ark`, branch `cdx/rootark-roadmap`, starting and final SHA `28747c6ebdac873650e2d5a3c6193824e7cc9985`. The worktree was intentionally dirty before this packet. This packet adds this document only; it does not correct runtime code, tests, dependencies, documentation, workflow, or issue-ledger content.

Verdict: **Approved with reservations for local evidence; full validation is environment-blocked.** Existing focused phase results recorded in `docs/plan-tree.md` provide prior local evidence for the realtime, upload, cloud-inventory, WebDAV, and SQLite/trash slices. The fresh gate in this packet could not reproduce those results because the current dependency tree is incomplete. No live provider, OS mount, browser, CI, or production claim is made.

## Worktree scope map

All entries below were present before this packet and were preserved. They are mapped here so the continuation does not silently absorb unrelated work.

| Current changed/untracked path | Bounded phase or issue served | Treatment in this packet |
|---|---|---|
| `.github/workflows/security-regression.yml` | Branch reconciliation and Issue #14 governance baseline | Preserved; not edited |
| `docs/architecture/current-server-responsibility-map.md` | Issue #5 architecture baseline and prior extraction evidence | Preserved; not edited |
| `docs/plan-tree.md` | Phase 4/5 status and local validation history for Issue #5 | Preserved; not edited |
| `docs/issue-ledger.md` | Local governance and issue-state reconciliation | Preserved; not edited |
| `server.js` | Phase 4 realtime adapter and Phase 5 upload-scanning adapter for Issue #5 | Preserved; not edited |
| `src/realtime/server.js` | Phase 4 realtime transport extraction for Issue #5 | Preserved; not edited |
| `src/upload-scanning.js` | Phase 5 upload scanning/quarantine extraction for Issue #5 | Preserved; not edited |
| `test/realtime-transport-boundaries.test.js` | Phase 4 realtime public-contract coverage | Preserved; not edited |
| `test/realtime-webdav-meta-remediation.test.js` | Phase 4 realtime/WebDAV compatibility matrix | Preserved; not edited |
| `test/upload-security.test.js` | Phase 4 upload scanning contracts supporting Phase 5 extraction | Preserved; not edited |
| `test/cloud-storage.test.js` | Phase 5 cloud inventory trust-boundary contracts | Preserved; not edited |
| `docs/validation/2026-08-13-rootark-continuation-evidence.md` | This Phase A evidence closure | Added by this packet |

The runtime extraction files remain CommonJS. No route, event, response, authentication, storage, encryption, cloud, WebDAV, or product behavior was changed here.

## Realtime contract matrix

Classification means the kind of evidence that exists in the repository, not a claim that the fresh dependency-blocked rerun passed.

| Contract | Classification and exact evidence | Current gate state |
|---|---|---|
| Rejected upgrade never emits `connected` | **Executable behavior test** — `test/realtime-transport-boundaries.test.js`, `WebSocket HTTP upgrade enforces cookie, Origin, message, and binary boundaries`; rejected sockets assert no `connected` event and close with 1008 | Fresh rerun blocked by missing `bcryptjs`; prior focused result in `docs/plan-tree.md` reports realtime 7/7 twice |
| `connected` is the first event and envelope is exact | **Executable behavior test** — `realtime emits connected first and preserves exact notification envelopes`; first message keys are exactly `event`, `payload`, `timestamp`, with `{ username }` payload | Same dependency blocker |
| Representative notification source and timestamp semantics | **Executable behavior test** — same test creates a folder and checks `data:changed`, `{ source: "folders" }`, exact envelope keys, and non-decreasing timestamp | Same dependency blocker |
| Stale/revoked session is rejected before protected realtime work | **Executable behavior test** — `test/auth-security.test.js`, `permission removal closes an active WebSocket before its next authenticated message` and `deleted usernames cannot resurrect old HTTP or WebSocket sessions` | Same dependency blocker |
| Expired session is rejected before protected realtime work | **Executable behavior test** — `test/auth-security.test.js`, `an expired active WebSocket closes before processing its next message` | Same dependency blocker |
| Origin, current-user, session-version, and expiry freshness | **Executable behavior tests** — Origin is exercised by `WebSocket HTTP upgrade enforces cookie, Origin, message, and binary boundaries`; current-user/session-version by the permission-removal and deleted-user tests; expiry by the expired active WebSocket test | Same dependency blocker |
| Heartbeat termination | **Executable behavior test** — `heartbeat terminates an unresponsive idle client and shutdown leaves no child process` performs a raw authenticated upgrade without responding to heartbeat traffic | Same dependency blocker |
| Idle termination | **Executable behavior test** — the same heartbeat test configures one-second heartbeat/idle limits and asserts the unresponsive client closes | Same dependency blocker |
| Buffered-client closure | **Source-backed only; public behavior unverified** — `test/realtime-transport-boundaries.test.js`, `realtime transport declares bounded payload, compression, binary, and burst handling`, and `test/realtime-webdav-meta-remediation.test.js`, matrix row `09 buffered amount is bounded`, inspect the source guard; neither test forces public `bufferedAmount` backpressure | Not covered as executable public behavior; no brittle source-only expansion added |
| Message-rate window reset | **Executable behavior test** — `realtime message-rate window resets after the configured interval` sends two messages, waits for the configured window, then sends two more without closure | Same dependency blocker |
| Heartbeat timer cleanup on shutdown | **Executable lifecycle evidence plus source-backed detail** — the heartbeat test asserts the child exits after shutdown; `test/realtime-webdav-meta-remediation.test.js`, row `06 heartbeat interval is cleared`, checks `clearInterval(realtimeHeartbeat)` | Fresh rerun blocked; no live child was intentionally left by this packet |
| Credential-free browser/WebSocket URL | **Source-backed test evidence, not live browser behavior** — `test/auth-security.test.js`, `browser pages contain no persisted auth keys or WebSocket token URLs`, is a static page/source assertion and does not validate a browser session | Same dependency blocker |

The realtime source also preserves cookie-only authentication, expected Origin comparison, current-user/session-version refresh, expiry checks, payload and binary limits, message-rate limits, heartbeat/idle cleanup, and `{ event, payload, timestamp }` envelopes. Source-string checks are recorded as source-backed only and are not substituted for runtime behavior.

## Upload scanning and quarantine matrix

| Contract | Classification and exact evidence | Current gate state |
|---|---|---|
| Suspicious extension is rejected with quarantine before pending publication | **Executable behavior test** — `test/upload-security.test.js`, `suspicious executable extensions are quarantined before pending upload registration`; asserts 415, empty pending state, quarantine reason, contained path, and payload bytes | Fresh rerun blocked by missing `bcryptjs`; prior plan-tree evidence reports upload 16/16 twice |
| Filename/path containment | **Executable behavior test** — `traversal-style multipart filenames stay contained in the selected folder`; fail-closed and infected tests also assert quarantine path containment | Same dependency blocker |
| Quarantine metadata and payload coordinate | **Executable behavior tests** — `unavailable ClamAV fail-closed upload is quarantined before pending registration` and `local fake ClamAV infected INSTREAM response quarantines before pending registration`; assert reason, scan status/virus, payload bytes, no pending record, and no temp publication | Same dependency blocker |
| ClamAV INSTREAM clean/infected parsing | **Executable behavior tests** — `local fake ClamAV accepts a clean INSTREAM response into pending state` and `local fake ClamAV infected INSTREAM response quarantines before pending registration`; the daemon is local and disposable | Same dependency blocker |
| Scanner unavailable, fail-open | **Executable behavior test** — `unavailable ClamAV remains fail-open into pending state when fail-closed is disabled`; asserts pending entry and no quarantine | Same dependency blocker |
| Scanner unavailable, fail-closed | **Executable behavior test** — `unavailable ClamAV fail-closed upload is quarantined before pending registration`; asserts 503, no pending entry, quarantine metadata, containment, and bytes | Same dependency blocker |
| Cleanup after denied/invalid upload | **Executable behavior tests** — `users without upload permission are rejected before Multer creates artifacts` and nested tests under `Multer rejects malformed or disallowed multipart bodies without artifacts`; fail-closed/infected tests assert the scanned temp file is absent | Same dependency blocker |
| Upload authorization | **Executable behavior test** — `users without upload permission are rejected before Multer creates artifacts` | Same dependency blocker |
| Simple upload entry point and pending registration | **Executable behavior tests** — `authorized harmless multipart upload enters the selected folder pending area` plus the fail-open/clean scanner tests | Same dependency blocker |
| Chunked upload entry point | **Source-backed only** — `server.js` `/upload-chunk` assembles the final temp file and calls the unchanged `scanUploadBeforePending` adapter before encryption and pending registration; no focused chunked scanner integration test is present | Unverified in this gate |
| WebDAV PUT entry point | **Source-backed only** — `server.js` `handleWebDavPut` stages the PUT, calls the same adapter, removes the final temp file on denial, and registers pending only after allowance; direct WebDAV PUT tests cover staging/limits but not scan-provider parity | Unverified in this gate |
| Audit events and quarantine metadata | **Source-backed only** — `src/upload-scanning.js` preserves `upload.scan.suspicious`, `upload.scan.infected`, `upload.scan.failed`, `upload.scan.clean`, and `upload.quarantined` calls; current upload tests inspect quarantine metadata but not persisted audit rows | Unverified as an end-to-end audit assertion |
| D-009 client-side scanning and unverified quarantine policy | **Unverified/architecturally open** — `docs/product-discovery.md` D-003/D-009 require client-side zero-knowledge protection and quarantine for unverified external uploads. Existing server-side ClamAV and server-readable upload behavior remain legacy implementation evidence, not product approval; no client-side scanning or automatic release was implemented | Explicitly outside this packet |

## Cloud inventory boundary

`services/cloudStorage.js` source evidence shows S3 inventory requires the configured prefix and exactly `area/folder/name` with `uploads` or `temp`, while Drive inventory requires the configured parent, parses `rootArkKey`, matches `rootArkFolderId` and `rootArkArea`, requires an identity, and rejects duplicate provider identities.

The executable contract names are in `test/cloud-storage.test.js`: `S3 inventory rejects foreign prefixes and malformed area, folder, or name keys`, `Google Drive inventory rejects objects outside the parent or with mismatched rootArk metadata`, and `cloud inventory rejects duplicate provider identities`. In the mixed focused rerun, the Drive parent/metadata test passed, while S3-dependent portions were blocked by the missing `@aws-sdk/client-s3`; the duplicate-identity test failed at its S3 half before reaching its Drive half. Earlier local phase evidence recorded in `docs/plan-tree.md` reports the complete cloud suite as 27/27 twice. No S3/Drive credentials, network call, or provider behavior is claimed here.

## WebDAV, SQLite, and trash boundaries

Direct-protocol WebDAV evidence is split between executable tests and source-backed matrix checks:

- `test/realtime-webdav-executable.test.js` covers malformed PROPFIND bodies, oversize PUT cleanup, aborted PUT cleanup, restart recovery, metadata checksum failure, and the configured WebSocket rate boundary.
- `test/realtime-webdav-completed-recovery.test.js` covers completed/uncertain journal recovery and cleanup retry behavior.
- `test/realtime-webdav-crash-consistency.test.js` covers remote intent persistence, idempotent provider effects, crash-after-replacement recovery, and competing journal claims with fake providers.
- `test/realtime-webdav-meta-remediation.test.js`, `realtime and WebDAV meta-remediation matrix`, includes executable transactional replacement coverage and source-backed WebDAV route, Origin, staging, permission, path, and journal rows. Its source rows are not behavior proof.

SQLite/trash evidence is similarly bounded:

- `test/sqlite-recovery.test.js` exercises disposable integrity, rollback, WAL, foreign-key, and restart/reopen behavior when `better-sqlite3` is available.
- `test/sqlite-stage-cleanup.test.js` exercises observable stage cleanup and archive-output failures in disposable child processes.
- `test/trash-route-persistence.test.js`, `test/trash-local-completion.test.js`, `test/trash-meta-remediation.test.js`, `test/trash-remote-state.test.js`, `test/trash-runtime-root.test.js`, and `test/trash-security.test.js` cover route persistence, local completion, metadata, remote state, runtime-root confinement, and security boundaries in focused fixtures.
- The current gate could not execute these suites because `better-sqlite3` and/or `bcryptjs` remained unavailable after the disposable install/rebuild attempts. Prior plan-tree evidence reports a disposable combined SQLite/trash run at 70/70 after a native binding rebuild; that is historical local evidence, not a fresh result from this packet.

These tests do not validate an OS WebDAV mount, ClamAV daemon, S3, Google Drive, SQLite production deployment, or full JSON/SQLite parity.

## Validation record

Commands were run from `E:\servidor-roadmap` on Node.js `v24.14.1`.

| Command | Result |
|---|---|
| `npm.cmd ci --ignore-scripts --no-audit --no-fund --cache .tmp-npm-cache` | **BLOCKED twice** — each attempt ran for about 73 seconds and ended with npm `Exit handler never called`; no package files were changed. |
| `npm.cmd rebuild better-sqlite3 --no-audit --no-fund --cache .tmp-npm-cache` | **EXIT 0 twice** — npm reported `rebuilt dependencies successfully`, but post-command inspection showed empty/incomplete package directories and `require()` still failed for `bcryptjs`, `@aws-sdk/client-s3`, and `better-sqlite3`. The rebuild exit code is not treated as a usable dependency installation. |
| `node --test test/realtime-transport-boundaries.test.js test/realtime-webdav-completed-recovery.test.js test/realtime-webdav-crash-consistency.test.js test/realtime-webdav-executable.test.js test/realtime-webdav-meta-remediation.test.js test/auth-security.test.js test/upload-security.test.js test/cloud-storage.test.js test/sqlite-recovery.test.js test/sqlite-stage-cleanup.test.js test/trash-route-persistence.test.js test/trash-local-completion.test.js test/trash-meta-remediation.test.js test/trash-remote-state.test.js test/trash-runtime-root.test.js test/trash-security.test.js` | **BLOCKED** — 43 tests discovered, 19 passed, 24 failed; missing `bcryptjs`, `@aws-sdk/client-s3`, and `better-sqlite3` prevented complete focused validation. |
| `npm run validate` | **NOT INVOKED** — PowerShell blocked `npm.ps1` by execution policy. |
| `npm.cmd run validate:syntax` | **PASS** — 83 JavaScript files checked, 0 failed. |
| `npm.cmd run validate:artifacts` | **PASS** — runtime-artifact validator exited 0. |
| `npm.cmd run validate` | **BLOCKED** — syntax stage passed 83/83, then `npm test` failed on missing dependencies; dependency audit stage was not reached. |
| `npm.cmd run validate:dependencies` | **BLOCKED** — `npm audit --package-lock-only --audit-level=high` failed because the registry advisory endpoint returned an error; no audit result was claimed. |
| `git diff --check` | **PASS** — no whitespace errors; Git emitted existing LF-to-CRLF warnings. |
| Scoped sensitive-content scan over current source/test/ledger/validation files | **PASS** — 9 files scanned; 0 matches for AWS key, private-key header, service-account assignment, or JWT-shaped token patterns. |
| Generated/runtime artifact inspection before cleanup | **PASS with limitation** — during validation, only disposable `node_modules` and `.tmp-npm-cache` were created/owned by this packet; `data` existed with one top-level entry and was not enumerated or modified. |
| Exact cleanup and post-cleanup inspection | **PASS** — after all child processes exited, the packet removed only `E:\servidor-roadmap\node_modules` and `E:\servidor-roadmap\.tmp-npm-cache`; both were verified absent. `uploads`, `temp`, `backups`, and `quarantine` were not removed or modified. |

No credentials or external provider calls were used. No package files, runtime code, tests, workflow, plan-tree, architecture, issue-ledger, or other documentation files were changed. No commit or publication was performed. Remote CI was not confirmed.

## Remaining limitations

- The fresh complete local gate is environment-blocked by npm installation failure, incomplete dependency contents/native binding availability, and an unavailable registry audit endpoint; this record does not convert those failures into source success.
- Buffered-client WebSocket close remains source-backed only and publicly unverified because deterministic backpressure forcing would be brittle.
- Upload scan parity for chunked and WebDAV PUT entry points, persisted audit-row assertions, live ClamAV, external cloud providers, OS WebDAV mounts, and full JSON/SQLite parity remain unverified.
- D-003/D-009 zero-knowledge client-side scanning, encrypted derived data, server-blind sharing, and local-bridge WebDAV remain product/architecture work, not implemented behavior.
- Browser, CI, provider, production, and remote-closure behavior are not claimed.
