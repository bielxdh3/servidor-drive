# Root.ark Issue #7 Operational Validation — 2026-08-02

## 1. Executive Verdict

`PARTIAL — executable coverage completed with blockers or defects`

The disposable operational run completed with 21 `PASS`, 0 `FAIL`, 2 `BLOCKED`, and 0 `NOT TESTED` claims. The two blockers are environmental: no local disposable ClamAV daemon/CLI and no safe non-interactive OS WebDAV mount capability. No product remediation was attempted and no confirmed defect issue was created.

## Evidence Provenance and Reproducibility

This report separates three kinds of information:

- `RECOVERED EXECUTION EVIDENCE`: result and interface details retained in the original committed report and the associated PR/Issue records. The report preserves the claim matrix, observed status codes, selected entrypoint names, environment-variable names, safety boundary, and cleanup conclusions from the disposable operational run.
- `DERIVED REPRODUCTION GUIDE`: commands and request shapes in Appendix B, reconstructed from the repository interfaces at validated SHA `2e526406532e75052544e19aa73b3369f06d3100`, `package.json`, and the implemented routes and CLI. They are intended for a fresh disposable run and are not claimed to be the verbatim historical transcript.
- `UNRECOVERABLE ORIGINAL DETAIL`: the original raw command log, temporary operational harness, shell history, and disposable runtime are not available in the current environment. Exact historical quoting, payload ordering, generated identifiers, fixture bytes, process arguments, and per-command timing therefore cannot be reconstructed exactly.

The committed report is the surviving record of the original run; it is not a raw execution transcript. Appendix A records the report-backed observations without upgrading reconstructed commands into exact historical commands. Where an exact command or request is not directly recoverable from a trustworthy execution artifact, Appendix A says so explicitly. No command, payload, output, environment value, token, or timing has been fabricated. The derived procedures are independently reproducible instructions, not claims about what the original operator typed.

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

| Claims | Report-recorded interface / request (historical transcript not retained) | Disposable input and objective evidence | Cleanup / limitation |
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

## Automated and Operational Evidence

| Evidence type | What it proves | What it does not prove |
| --- | --- | --- |
| GitHub Actions validation | The report branch passed the repository's configured CI checks at the recorded commit. | It does not rerun or prove the original operational harness. |
| Repository automated tests | Syntax, test, dependency-audit, and runtime-artifact checks executed by the package scripts. | They do not replace the disposable operational checks. |
| Original operational harness | The report records the 21 PASS and 2 BLOCKED operational observations from the disposable run. | The raw harness, exact transcript, temporary fixtures, and shell history are not available for independent replay. |
| Post-report documentation verification | The amended report is internally consistent, documentation-only, and free of detected sensitive/runtime artifacts. | It does not retroactively prove an exact historical command. |
| Derived reproduction instructions | Another developer has a source-backed procedure for repeating the checks from a fresh disposable environment. | They are not represented as verbatim historical commands. |

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

## Appendix A — Recovered Executed Evidence

The following table records only details that remain in the committed report or the associated PR/Issue records. The absence of raw logs means that the historical command transcript is not independently recoverable.

| Claim IDs / subsystem | Evidence source | Exact recovered command/request | Relevant redacted environment | Exact observed result | Confidence | Missing original detail |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline validation | Committed report, baseline section, and PR checks | Original exact command unavailable; see Appendix B for a derived reproduction procedure. | Fresh disposable clone; private paths omitted. | `npm ci`, aggregate validation, artifact guard, and clean-worktree checks were recorded as passed. | Medium for the recorded result. | Original exact command order, shell, output, and timing. |
| C-01–C-03 JSON-to-SQLite migration | Committed report and claim matrix | Original exact command unavailable; see Appendix B for a derived reproduction procedure. | `DB_ENABLED=true`; absolute `<database-path>`; JSON fallback and legacy JSON writes disabled. | Two migration passes; representative entities imported; counts stable; SQLite integrity `ok`; source fixture hashes unchanged. | Medium for the recorded result. | Exact fixture bytes, command line, generated backup name, and raw output. |
| C-05–C-06 SQLite restart persistence | Committed report and Evidence Register | Original exact command unavailable; see Appendix B for a derived reproduction procedure. | Disposable SQLite database; fake users and data; credentials and tokens redacted. | Authenticated reads returned HTTP 200 after restart; share creation returned 201 and public read returned 200. | Medium for the recorded result. | Exact startup arguments, request headers, payloads, identifiers, and response bodies. |
| B-01–B-02 backup and restore | Committed report and claim matrix | Original exact command unavailable; see Appendix B for a derived reproduction procedure. | Authenticated disposable runtime; pre-restore safety snapshot outside runtime. | Backup returned 201; manifest/list returned 200; restore returned 200; mutation disappeared; known bytes and restart state matched. | Medium for the recorded result. | Exact backup ID, archive name, manifest body, mutation, and raw responses. |
| B-03–B-04 failure-injected restore recovery | Committed report and Evidence Register | Original exact command unavailable; see Appendix B for a derived reproduction procedure. | Existing hooks only: `ROOTARK_SQLITE_FAIL_AFTER=stage.validate` and `replacement.move.primary`. | Both injected restores returned 400; no journal remained; SQLite integrity was `ok`. | Medium for the recorded result. | Exact process environment, request body, journal paths, and raw error output. |
| T-01–T-02 trash lifecycle | Committed report and claim matrix | Original exact command unavailable; see Appendix B for a derived reproduction procedure. | Fake users, permissions, files, folders, and public-link token; all disposable. | Move, list, restore, and permanent delete passed; unauthorized permanent delete returned 403; trashed public link returned 404; folder restore passed. | Medium for the recorded result. | Exact identifiers, authorization headers, and response bodies. |
| U-01–U-04 upload and quarantine | Committed report and claim matrix | Original exact command unavailable; see Appendix B for a derived reproduction procedure. | `UPLOAD_FAIL_CLOSED=false`; ClamAV pointed at disposable closed port `39999`; no live scanner. | Benign/encrypted approval returned 200; harmless `.exe` fixture returned 415 and appeared in quarantine; unavailable-scanner fail-open upload passed. | Medium for the recorded result. | Exact multipart boundaries, fixture bytes, filenames, and response payloads. |
| U-05 ClamAV unavailable behavior | Committed report and environmental limitations | Original exact command unavailable; see Appendix B for a derived reproduction procedure. No live ClamAV command/request was executed. | No local `clamd`/`clamdscan`; no external scanner contacted. | Live ClamAV detection remained `BLOCKED`; this was not treated as a product defect. | High for the blocker status. | Any future daemon version, scan command, test vector, and output. |
| W-01 direct WebDAV protocol | Committed report and claim matrix | Original exact command unavailable; see Appendix B for a derived reproduction procedure. | Basic Auth with fake credentials; direct HTTP client; WebDAV mount disabled/unavailable. | `OPTIONS=204`; `PROPFIND=207` at depths 0/1; invalid depth/body `400`; GET/HEAD `200`; PUT/MKCOL `201`; oversized PUT `413`; traversal `400`; DELETE/MOVE `405`; LOCK/UNLOCK `501`. | Medium for the recorded result. | Exact URLs, headers, XML/body bytes, file names, and raw response headers. |
| W-02 OS WebDAV mount | Committed report and environmental limitations | Original exact command unavailable; see Appendix B for a derived reproduction procedure. No OS mount command was executed. | No usable `davfs` or safe non-interactive Windows mount capability. | OS mount remained `BLOCKED`; direct protocol validation passed. | High for the blocker status. | Platform, mount tool, privilege state, and mount transcript. |
| S-01–S-04 sync CLI | Committed report, Evidence Register, and claim matrix | Original exact command unavailable; see Appendix B for a derived reproduction procedure. | Disposable config/state directory; `ROOTARK_SYNC_PASSWORD` used as a placeholder-only secret source. | Pairing and one-shot sync exited 0; pending approval, restart propagation, token renewal, old-token observation, and 8 MiB + 1 byte rejection were recorded. | Medium for the recorded result. | Exact config JSON, token values, file bytes, CLI arguments, and raw output. |

In every row where the exact historical transcript is unavailable, the missing detail is intentionally left unresolved rather than replaced with a reconstructed command.

## Appendix B — Derived Reproduction Guide

Every subsection below is labeled with the same provenance boundary:

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

### Baseline

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

From a fresh checkout at the validated SHA, run the exact package scripts:

```text
cd <repo>
npm ci
npm run validate
npm run validate:artifacts
git diff --check
git status -sb
```

`npm run validate` is the repository aggregate for syntax validation, `npm test`, and the locked high-severity dependency audit. Do not treat this automated baseline as a substitute for the operational checks below.

### Disposable Runtime Boundary

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

Create `<runtime-root>` with the operating system's temporary-directory facility, outside `<repo>` and outside any existing user data tree. Resolve all runtime paths below it and verify containment before creating or removing data:

| Placeholder | Boundary |
| --- | --- |
| `<repo>` | Fresh disposable clone of the repository. |
| `<runtime-root>` | Temporary root for fake data and server runtime, not the publication checkout. |
| `<database-path>` | Absolute SQLite path inside `<runtime-root>`; `DATABASE_URL` points here. |
| `<backup-root>` | Disposable backup and restore staging area under `<runtime-root>`. |
| `<sync-state-root>` | External sync config, local folder, and `.rootark-sync-state.json` directory. |

The application resolves `data`, `uploads`, and `temp` from its working directory, while backup, quarantine, trash, SQLite sidecars, and restore journals must also remain disposable. Use a path-containment check before the run and before cleanup. Keep the pre-test safety snapshot outside `<runtime-root>`, never use production data or credentials, and remove only verified paths below the disposable roots after all processes have stopped.

### JSON-to-SQLite Migration

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

Prepare a disposable `data` tree with fake, non-secret fixtures for the categories consumed by `db/migrate-json-to-sqlite.js`: users, folders, pending uploads, public links, file permissions, expirations, file versions, encrypted-file metadata, analytics, audit logs, and action history. Preserve the source JSON files so their hashes can be compared after migration.

Set the migration boundary (PowerShell and POSIX shells may use their native environment-variable syntax):

```text
DB_ENABLED=true
DATABASE_URL=<database-path>
DB_READ_FALLBACK_JSON=false
DB_WRITE_LEGACY_JSON=false
```

Run the repository entrypoint twice:

```text
npm run db:migrate-json
npm run db:migrate-json
```

For each pass, record only disposable output. Compare semantic counts for users, folders, pending uploads, links, permissions, expirations, versions, encrypted metadata, analytics, audit, and history; run a read-only SQLite `PRAGMA integrity_check`; compare source JSON hashes; and confirm the migration backup directory stays below `<runtime-root>`. The second pass must leave semantic counts stable.

### SQLite Restart Persistence

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

Start the application against the same disposable database and a disposable working tree:

```text
DB_ENABLED=true
DATABASE_URL=<database-path>
DB_READ_FALLBACK_JSON=false
DB_WRITE_LEGACY_JSON=false
PORT=<port>
node server.js
```

Bootstrap authentication only with fake disposable users whose password fields contain bcrypt hashes generated for that run. Obtain a token through `POST /auth/login` with a placeholder username/password, then send `Authorization: Bearer <token>`; do not publish the token or password. Use the supported reads needed by the claim: `GET /auth/me`, `GET /users` where the fake user has `manageUsers`, `GET /folders`, `GET /list?folderId=root`, `GET /history`, `GET /analytics/summary`, `GET /audit/summary`, `GET /versions/<filename>`, and `GET /encrypted/<filename>/metadata`. Create a disposable public link with `POST /share` and verify its anonymous `GET /share/<token>` response.

Stop the server cleanly, restart it with the same environment, repeat the reads, and compare semantic rows, permissions, link state, audit/analytics/history entries, version metadata, and encrypted metadata. The restart comparison is operational evidence; it does not claim a particular historical process-manager command.

### Backup and Restore

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

Use an authenticated fake user authorized for backup access. With `Authorization: Bearer <token>`:

```text
POST <base>/backups
Content-Type: application/json

{"notes":"disposable validation"}

GET <base>/backups
GET <base>/backups/<backup-id>/manifest
```

Record known disposable file bytes and semantic database values, take a pre-restore safety snapshot outside `<runtime-root>`, and make a distinguishable post-backup mutation. Restore with:

```text
POST <base>/backups/<backup-id>/restore
Content-Type: application/json

{"confirmation":"RESTORE"}
```

Confirm the restore response, remove/observe the mutation, verify known file bytes and semantic database state, confirm restore staging is cleaned, restart the server when `restartRecommended` indicates it, and repeat the reads. Never restore against a non-disposable data tree.

### Restore Failure Injection

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

The validated source exposes only the `ROOTARK_SQLITE_FAIL_AFTER` failure hook used by `restoreService`:

```text
ROOTARK_SQLITE_FAIL_AFTER=stage.validate
ROOTARK_SQLITE_FAIL_AFTER=replacement.move.primary
```

For each value, use a fresh disposable backup and the same authenticated `POST /backups/<backup-id>/restore` request with `{"confirmation":"RESTORE"}`. Expect the injected operational error to be reported as HTTP 400, then verify that the SQLite restore journal is absent after recovery and that read-only SQLite `PRAGMA integrity_check` returns `ok`. Do not invent or use other failure-hook names.

### Trash Lifecycle

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

With fake users and fake files in the root or a disposable folder:

1. Move a file with `GET /delete/<file-name>?folderId=root`.
2. Verify it is absent from `GET /list?folderId=root` and visible to the owner/manager through `GET /trash`.
3. Verify its public link is blocked (`GET /share/<token>` returns the documented not-found boundary).
4. As an ordinary fake user, call `DELETE /trash/<trash-id>` and expect `403`; as an authorized manager, call the same route and expect permanent deletion.
5. Restore another item with `POST /trash/<trash-id>/restore` and verify its bytes and metadata.
6. Create a disposable non-root folder, move it with `DELETE /folders/<folder-id>`, list it in `/trash`, and restore it with the same restore route.

Use fake UUIDs only in examples, keep authorization headers and tokens as placeholders, and do not empty a non-disposable trash.

### Upload Scanning

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

Start the server with the disposable upload boundary. For unavailable-scanner behavior use `UPLOAD_SCAN_PROVIDER=clamav`, `CLAMAV_HOST=127.0.0.1`, a verified closed local `<closed-port>`, and `UPLOAD_FAIL_CLOSED=false`; keep `UPLOAD_QUARANTINE_DIR` inside `<runtime-root>`.

Use authenticated multipart `POST /upload?folderId=root` with a `file` part for a benign fixture and, separately, an encrypted-metadata flow using `encryptionLevel` and placeholder password fields. Verify pending state through `GET /pending?folderId=root`, approve with `GET /approve/<name>?folderId=root`, and compare final bytes/metadata. Upload a harmless file named with a suspicious extension such as `fixture.exe`; with executable blocking enabled it should be quarantined and return HTTP 415. Inspect `GET /quarantine` as an authorized manager and verify quarantine storage remains contained.

With the closed ClamAV port and `UPLOAD_FAIL_CLOSED=false`, a benign upload should exercise the documented fail-open path. Do not include a live malware vector: live ClamAV detection was `BLOCKED` in the original environment.

### WebDAV Direct Protocol

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

Enable WebDAV with `WEBDAV_ENABLED=true` and the default `/dav` path. Send Basic Auth using `Authorization: Basic <base64(fake-user:fake-password)>`; keep all credentials and file names disposable. The following is a direct HTTP matrix, not an OS mount procedure:

| Method | Normalized URL | Essential headers/body | Expected status |
| --- | --- | --- | --- |
| OPTIONS | `<base>/dav` | Basic Auth; empty body | 204 |
| PROPFIND | `<base>/dav` | Basic Auth; `Depth: 0`; empty body | 207 |
| PROPFIND | `<base>/dav` | Basic Auth; `Depth: 1`; empty body | 207 |
| PROPFIND | `<base>/dav` | Basic Auth; `Depth: infinity` | 400 |
| PROPFIND | `<base>/dav` | Basic Auth; non-empty or malformed body | 400 |
| GET | `<base>/dav/<file>` | Basic Auth | 200 |
| HEAD | `<base>/dav/<file>` | Basic Auth | 200 |
| PUT | `<base>/dav/<new-file>` | Basic Auth; `Content-Length`; disposable bytes | 201 |
| MKCOL | `<base>/dav/<new-folder>` | Basic Auth; empty body | 201 |
| PUT oversized | `<base>/dav/<oversize-file>` | Basic Auth; 8 MiB + 1 byte body | 413 |
| GET traversal | `<base>/dav/%2e%2e/<file>` | Basic Auth | 400 |
| DELETE | `<base>/dav/<file>` | Basic Auth | 405 |
| MOVE | `<base>/dav/<file>` | Basic Auth; same-origin `Destination` header | 405 |
| LOCK | `<base>/dav/<file>` | Basic Auth; optional lock body | 501 |
| UNLOCK | `<base>/dav/<file>` | Basic Auth; optional `Lock-Token` header | 501 |

Use `WEBDAV_ALLOW_DELETE=false` and `WEBDAV_ALLOW_MOVE=false` for the validated MVP boundaries. Keep the request body empty for the supported PROPFIND cases; a non-empty body is intentionally rejected. This matrix verifies the direct protocol only and does not claim OS mount behavior.

### Sync MVP

`Derived from repository interfaces at validated SHA 2e526406532e75052544e19aa73b3369f06d3100; not claimed as the verbatim original command transcript.`

Keep both the config and local folder outside `<repo>` and under `<sync-state-root>`:

```text
npm run sync:init -- --config <sync-state-root>/config.json --server <base> --username <fake-user> --folder <sync-state-root>/folder --folder-id root --auto-approve false
npm run sync:start -- --config <sync-state-root>/config.json --once
```

The CLI stores its state as `.rootark-sync-state.json` inside the configured local folder. Observe the server's `/pending?folderId=root` output, approve the pending item through the supported approval route, restart the one-shot client, and modify the same disposable local file to verify changed-file propagation. To exercise token renewal, replace the disposable config token with a placeholder stale value and provide the fake password only through `ROOTARK_SYNC_PASSWORD`; do not print or commit the resulting token. Confirm the observed old-token behavior without publishing any token.

Create an exact 8 MiB + 1 byte disposable file with the standard Node runtime, then run one-shot sync and verify the client records a failed upload without copying sync state into the repository:

```text
node -e "require('fs').writeFileSync('<sync-state-root>/folder/oversize.bin', Buffer.alloc(8 * 1024 * 1024 + 1))"
npm run sync:start -- --config <sync-state-root>/config.json --once
```

After the run, stop any watcher, verify `<repo>` has no `.rootark-sync.json` or `.rootark-sync-state.json`, and remove only the verified `<sync-state-root>`.

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
- Report-finalization snapshot: 1,402 seconds / 350,181 tokens, as exposed by the Codex runtime goal meter.
- Final session total: 1,462 seconds / 359,760 tokens, as reported by the final task handoff. The difference reflects work completed after the initial report-finalization snapshot.
- Global memory: unavailable; the requirement was enforced for this task and recorded here.
- Recommendation: no new session is required for human review of this documentation-only validation PR; start a new session only if a future remediation task is separately authorized.
