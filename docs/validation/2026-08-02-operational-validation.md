# Root.ark Issue #7 Operational Validation — 2026-08-02

## 1. Executive Verdict

`PARTIAL — executable coverage completed with blockers or defects`

The disposable operational run completed with 21 `PASS`, 0 `FAIL`, 2 `BLOCKED`, and 0 `NOT TESTED` claims. The two blockers are environmental: no local disposable ClamAV daemon/CLI and no safe non-interactive OS WebDAV mount capability. No product remediation was attempted and no confirmed defect issue was created.

## 2. Revision and Environment

- Repository: `bielxdh3/root.ark`
- Default branch: `codex/folders-acl`
- Validated SHA: `2e526406532e75052544e19aa73b3369f06d3100`
- Phase 2.3 closure anchor: present in ancestry; the validated default branch is exactly at the anchor.
- Execution date/timezone: 2026-08-02, America/Cuiaba.
- OS/filesystem: Microsoft Windows 10 Pro build 19045, NTFS.
- Node/npm: Node `v24.14.1`, npm `11.11.0`.
- Git/GitHub CLI: Git `2.54.0.windows.1`, `gh 2.95.0`.
- SQLite CLI: `3.50.6`; application SQLite used `better-sqlite3` from the locked install.
- ClamAV: unavailable (`clamdscan` and `clamd` not present).
- WebDAV: direct HTTP protocol client was available through Node fetch; no usable `davfs` or safe non-interactive Windows mount capability was available.
- Sync: the repository's `sync-client/rootark-sync.js` CLI was exercised.

Private machine paths, credentials, tokens, and raw runtime logs are intentionally omitted.

## 3. Safety Boundary

- A fresh disposable clone was used for the runtime; the publication checkout remained separate and clean until this report was added.
- All fake users, passwords, tokens, files, database rows, backups, quarantine entries, trash entries, and sync state were created below a disposable temporary root.
- `DATABASE_URL` was an absolute path inside the disposable runtime. JSON migration and server working-directory paths resolved inside the disposable clone.
- A pre-test sentinel snapshot was created outside the disposable runtime. Its SHA-256 remained `4d2a134b174730ddda75898e00cfa7db2997a86e2b20845655868c6b09bd1c85`.
- A path-containment guard rejected paths escaping the disposable root before runtime creation and destructive-style tests.
- No production data, accounts, cloud credentials, real uploads, external scanner, or live database was used.

## 4. Baseline Validation

On the clean publication checkout:

- `npm ci` — passed; 378 packages audited, no vulnerabilities.
- `npm run validate` — passed: syntax validation checked 81 JavaScript files; `npm test` passed 594 tests; locked high-severity audit found 0 vulnerabilities.
- `npm run validate:artifacts` — passed.
- `git status -sb` — clean before report creation.

## 5. Claim Matrix

| ID | Subsystem | Claim | Status | Evidence / limitation |
| --- | --- | --- | --- | --- |
| C-01 | SQLite | JSON-to-SQLite migration imports representative entities with integrity | PASS | Exit 0; 3 users, 2 folders, and populated rows in pending uploads, links, permissions, expirations, versions, encrypted metadata, analytics, audit, and history; integrity `ok`. |
| C-02 | SQLite | Second migration is idempotent | PASS | Exit 0; all table counts stable; integrity `ok`. |
| C-03 | SQLite | Source JSON is preserved | PASS | Source fixture hashes unchanged; migration backup directories created under disposable data. |
| C-04 | SQLite | External safety snapshot is outside runtime and unchanged | PASS | Sentinel containment and hash check passed. |
| C-05 | SQLite | Restart reads users, folders, links, audit, analytics, versions, and encrypted metadata | PASS | Real API reads all returned HTTP 200 after restart. |
| C-06 | SQLite | Public link creation/read persists through the API | PASS | `POST /share` returned 201; public read returned 200. |
| B-01 | Backup/restore | Backup completes with a valid manifest | PASS | `POST /backups` returned 201; manifest and list returned 200. |
| B-02 | Backup/restore | Normal restore returns the backup state after restart | PASS | Restore returned 200; restore temp was removed; post-backup mutation disappeared; known file bytes were restored; restart read passed. |
| B-03 | Backup/restore | Failure before destructive SQLite replacement recovers | PASS | Injected `stage.validate`; restore returned 400; journal absent; SQLite integrity `ok`. |
| B-04 | Backup/restore | Failure after replacement begins rolls back | PASS | Injected `replacement.move.primary`; restore returned 400; journal absent; SQLite integrity `ok`. |
| T-01 | Trash | File move, visibility, restore, permanent delete, denial, and public-link blocking | PASS | Move/restore/permanent delete returned 200; unauthorized permanent delete 403; trashed public link 404; other user could not see the item. |
| T-02 | Trash | Folder move and restore remain contained | PASS | Folder delete and restore returned 200 in the disposable runtime. |
| U-01 | Upload scanning | Benign multipart upload preserves bytes and can be approved | PASS | Real upload and approval returned 200; final bytes matched the fixture. |
| U-02 | Upload scanning | Encrypted metadata survives upload/approval | PASS | Encrypted upload, approval, and metadata read returned 200. |
| U-03 | Upload scanning | Suspicious extension is quarantined before publication | PASS | `.exe` upload returned 415; quarantine listing exposed the item; quarantine file was contained. |
| U-04 | Upload scanning | ClamAV-unavailable configured fail-open behavior | PASS | ClamAV provider was pointed at disposable closed port 39999 with `UPLOAD_FAIL_CLOSED=false`; benign upload passed without external scanner access. |
| U-05 | Upload scanning | Live ClamAV detection | BLOCKED | No local disposable ClamAV daemon or CLI was available; no external service was contacted. |
| W-01 | WebDAV | Supported methods and blocked/invalid boundaries | PASS | `OPTIONS=204`, `PROPFIND=207` at depths 0/1, invalid depth/body 400, GET/HEAD 200, PUT/MKCOL 201, DELETE/MOVE 405, LOCK/UNLOCK 501, traversal 400, oversized PUT 413. |
| W-02 | WebDAV | Actual OS mount workflow | BLOCKED | Direct protocol validation passed; mount tooling/privileges were unavailable. |
| S-01 | Sync | Initial pairing, state, upload, pending approval | PASS | `sync:init` and `sync:start --once` exited 0; state was `uploaded`; server pending item was approved. |
| S-02 | Sync | Restart state and changed-file propagation | PASS | A second CLI run updated the same local file and produced an approved remote version. |
| S-03 | Sync | Token renewal and old-token behavior | PASS | Invalid stored token renewed through `ROOTARK_SYNC_PASSWORD`; stored token changed; old token remained accepted by `/auth/me`, which is the observed no-revocation-on-renewal behavior. |
| S-04 | Sync | Documented 8 MiB limit and repository hygiene | PASS | 8 MiB + 1 byte file recorded client state `failed`; no sync config/state leaked into the repository. |

## 6. Evidence Register

| Claims | Exact interface / request | Disposable input and objective evidence | Cleanup / limitation |
| --- | --- | --- | --- |
| C-01–C-04 | `node db/migrate-json-to-sqlite.js` twice; read-only `better-sqlite3` queries for counts and `integrity_check` | Fake JSON fixture covering the listed entities; 3 users, 2 folders, populated tables, stable second-run counts, unchanged source hashes | Disposable clone and data tree; external sentinel retained unchanged. |
| C-05 | `node server.js`; authenticated `GET /users`, `/folders`, `/list`, `/analytics/summary`, `/audit/summary`, `/history`, `/encrypted/secret.bin/metadata`, `/versions/seed.txt` before/after restart | Seeded fake rows and file bytes; all reads returned 200 after restart | Runtime stopped and removed after capture. |
| C-06 | Authenticated `POST /share`, anonymous `GET /share/:token` | Disposable `safe.txt`; responses 201 and 200 | Share data remained disposable and was removed with runtime. |
| B-01–B-02 | Authenticated `POST /backups`, `GET /backups/:id/manifest`, `POST /backups/:id/restore` with `{confirmation:"RESTORE"}` | Known file hashes plus an added post-backup mutation; manifest returned 200 and restore removed mutation after restart | Archive, restore staging, and pre-restore material stayed disposable. |
| B-03 | Same restore API with `ROOTARK_SQLITE_FAIL_AFTER=stage.validate` | Bounded failure injection before destructive SQLite replacement; response 400, journal absent, integrity `ok` | Existing failure hook only; no product code changes. |
| B-04 | Same restore API with `ROOTARK_SQLITE_FAIL_AFTER=replacement.move.primary` | Bounded failure injection after replacement begins; response 400, journal absent, integrity `ok` | Existing failure hook only; no product code changes. |
| T-01–T-02 | `GET /delete/:name`, `GET /list`, `GET /trash`, `DELETE /trash/:id`, `POST /trash/:id/restore`, `DELETE /folders/:id` | Fake users with different permissions, fake file/folder bytes, and fake public link; observed 200/403/404 boundaries in matrix | Trash payloads and metadata removed with runtime. |
| U-01–U-04 | Multipart `POST /upload`; `GET /approve/:name`; `GET /quarantine`; scanner at `127.0.0.1:39999` | Benign, encrypted, and harmless `.exe`-named fixtures; 200 approval, 415 quarantine, fail-open unavailable-scanner behavior | Quarantine and upload files removed; no external scanner used. |
| U-05 | Live ClamAV scan was not invoked | No local `clamd`/`clamdscan` capability | `BLOCKED`, not a product failure. |
| W-01 | Basic Auth HTTP `OPTIONS`, `PROPFIND`, `GET`, `HEAD`, `PUT`, `MKCOL`, `DELETE`, `MOVE`, `LOCK`, `UNLOCK` against `/dav` | Fake files plus invalid depth/body, traversal, and 8 MiB + 1 byte PUT; exact HTTP statuses recorded in matrix | Direct protocol only; no mount created. |
| W-02 | OS mount attempt omitted | `davfs` and usable non-interactive Windows mount capability unavailable | `BLOCKED`, not a product failure. |
| S-01–S-04 | `sync-client/rootark-sync.js init/start --once` plus server `/pending` and `/approve/:name` | Fake local files, changed versions, invalid stored token, `ROOTARK_SYNC_PASSWORD`, and 8 MiB + 1 byte file | Config/state stayed outside repository and was removed. |

Each row used only disposable inputs; raw logs and secret-bearing runtime artifacts were not published.

## 7. Detailed Results

### SQLite migration and restart

The representative disposable JSON fixture included users, roles/permissions, root and non-root folders, a pending upload, a public link, file permissions and expiration, version history, encrypted metadata, analytics, audit, and action history. The real `db/migrate-json-to-sqlite.js` entrypoint ran twice with `DB_ENABLED=true`, absolute disposable `DATABASE_URL`, JSON fallback disabled, and legacy JSON writes disabled. Read-only SQLite snapshots confirmed expected semantic rows and stable counts. The server was started with `node server.js`, SQLite enabled, and the same disposable database; authenticated API reads returned 200 before and after restart.

### Backup, restore, and recovery

The real authenticated backup API created an archive and exposed its manifest. A known file manifest and SHA-256 bytes were checked after a distinguishable mutation, restore, cleanup, and server restart. The supported restore confirmation was required. Existing SQLite restore failure injection was used at `stage.validate` and `replacement.move.primary`; both runs returned the expected operational error while leaving no restore journal and an integrity-checked database.

### Trash

An approved file was moved through `/delete/:name`, checked for normal-list disappearance, checked for author/manager visibility, denied to an ordinary user for permanent deletion, blocked through its public link, restored through `/trash/:id/restore`, and permanently removed through the manager route. A folder was also moved and restored. All data was disposable.

### Upload scanning and quarantine

The real multipart upload route was used for benign, encrypted, and suspicious-extension files. Benign and encrypted files entered the normal pending/approval flow. A harmless `.exe`-named fixture was rejected with 415 and moved to contained quarantine storage. ClamAV-unavailable behavior was exercised against a closed local disposable port. Live malware-vector validation was not attempted because no local daemon/CLI existed.

### WebDAV

Basic Auth was used against the enabled `/dav` endpoint. Direct requests covered capability discovery, PROPFIND depth 0/1, invalid depth, malformed body, GET, HEAD, PUT, MKCOL, oversized PUT, traversal, and blocked DELETE/MOVE/LOCK/UNLOCK. No OS mount was attempted because the environment lacked a safe non-interactive mount capability.

### Sync MVP

The actual sync CLI initialized a disposable local folder, uploaded a new file, observed pending state, approved it, restarted the client, propagated a changed file, renewed an invalid stored token using `ROOTARK_SYNC_PASSWORD`, recorded old-token behavior, and rejected an 8 MiB + 1 byte file at the documented client limit. Config and state stayed outside the repository.

## 8. Defects

None confirmed. No defect issue was created and no remediation was attempted.

## 9. Environmental Limitations

- Live ClamAV detection is `BLOCKED` because no local disposable `clamd`/`clamdscan` was available.
- Actual OS WebDAV mounting is `BLOCKED` because no usable `davfs` or safe non-interactive Windows mount capability was available. Direct HTTP WebDAV coverage is complete for the documented MVP matrix.
- Cloud-provider backup/trash behavior, production HTTPS/reverse-proxy behavior, and platform-specific mount semantics were not claimed by this local-only run.

## 10. Residual Risks

- Live ClamAV integration and malware-vector quarantine remain unproven until a disposable local daemon is available.
- OS mount behavior remains unproven until a disposable mount-capable environment is available.
- External S3/Google Drive behavior and production filesystem/deployment semantics were outside scope.

## 11. Artifact Hygiene

The publication checkout contains documentation only. Disposable databases, WAL/SHM files, JSON fixtures, backups, uploads, quarantine files, trash payloads, sync state, tokens, credentials, and raw logs were kept outside the checkout and were not staged. Sensitive-content and runtime-artifact checks passed.

## 12. Final Cleanup

After evidence capture, the disposable runtime and sync data were removed only after their absolute paths were verified below the disposable temporary root. Server processes were stopped, no mount was created, and the external safety sentinel remained unchanged. The publication worktree contains only this report as an intended change.

## 13. Usage Metrics

- Operational harness wall time: 16.2 seconds as reported by the command runner.
- Baseline aggregate validation wall time: 46.1 seconds as reported by the command runner.
- Codex task elapsed time at report finalization: 1,402 seconds, as exposed by the Codex runtime goal meter.
- Codex tokens used at report finalization: 350,181, as exposed by the Codex runtime goal meter.
- Global memory: unavailable; the requirement was enforced for this task and recorded here.
- Recommendation: no new session is required for human review of this documentation-only validation PR; start a new session only if a future remediation task is separately authorized.
