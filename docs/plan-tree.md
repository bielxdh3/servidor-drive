# Root.ark Plan Tree

Last reconstructed: 2026-07-25

Repository: `bielxdh3/root.ark`

Current default branch observed: `codex/folders-acl`

Baseline HEAD used for this reconstruction: `4062f4c67bfda9d144aceb6dbbed539b8a917e4a`

## Status labels

- `[DONE]`: implemented and supported by relevant validation evidence.
- `[IMPLEMENTED-UNVERIFIED]`: code/documentation exists, but operational or regression proof is incomplete.
- `[CURRENT]`: active phase. New execution should stay within this phase.
- `[NEXT]`: next approved phase after the current gate.
- `[PARALLEL-DISCOVERY]`: product questions may proceed without runtime implementation.
- `[LATER]`: valid future work after prerequisites.
- `[BLOCKED]`: must not start until named prerequisites are complete.
- `[DECISION REQUIRED]`: requires an explicit product or architecture decision.
- `[DO NOT IMPLEMENT YET]`: recorded idea, not approved execution work.

A feature is not `[DONE]` merely because files, routes, UI, or documentation exist. Completion requires relevant tests, disposable-data validation, or an explicit manual validation record.

## Source-of-truth order

1. Current code and tests on the actual branch.
2. This plan tree for phase order and state.
3. Dedicated security, architecture, operations, and validation documents.
4. GitHub issues for executable scope.
5. Historical chat context only as input, never as proof.

## 0. Current product snapshot

### Application identity

- `[IMPLEMENTED-UNVERIFIED]` Independent Node.js/Express file-management application currently exists in this repository.
- `[DECISION REQUIRED]` Confirm whether this repository remains the canonical independent Root.ark product or becomes a legacy prototype relative to a future BielOS module. Track in issue #10.
- `[DECISION REQUIRED]` Confirm final spelling and branding: `Root.ark`, `root.ark`, `root.arc`, or another approved name. Track in issue #4.
- `[DECISION REQUIRED]` Resolve whether `codex/folders-acl` remains the canonical branch or history should move safely to a permanent branch such as `main`. Track in issue #14.

### Verified code-level capabilities

The following are present in code or project documentation, but several require operational validation:

- `[IMPLEMENTED-UNVERIFIED]` User login with bcrypt and JWT.
- `[IMPLEMENTED-UNVERIFIED]` Login rate limiting, progressive delay, IP/username blocking, generic errors, analytics, and audit events.
- `[IMPLEMENTED-UNVERIFIED]` Role and granular permission handling.
- `[IMPLEMENTED-UNVERIFIED]` Logical folders and file-level permissions.
- `[IMPLEMENTED-UNVERIFIED]` Simple and chunked upload flows with pending approval.
- `[IMPLEMENTED-UNVERIFIED]` File versions, expiration, previews, downloads, public links, and access limits.
- `[IMPLEMENTED-UNVERIFIED]` Encryption modes and encrypted-file metadata.
- `[IMPLEMENTED-UNVERIFIED]` Analytics, dashboard, audit logs, CSV export, and WebSocket refresh.
- `[IMPLEMENTED-UNVERIFIED]` Local, S3, and Google Drive storage compatibility.
- `[IMPLEMENTED-UNVERIFIED]` SQLite repositories and JSON-to-SQLite migration with legacy fallback.
- `[IMPLEMENTED-UNVERIFIED]` Backup, automatic backup, restore validation, and pre-restore backup.
- `[IMPLEMENTED-UNVERIFIED]` Trash for files and folders with restore and permanent deletion.
- `[IMPLEMENTED-UNVERIFIED]` Suspicious extension blocking, optional ClamAV integration, and quarantine.
- `[IMPLEMENTED-UNVERIFIED]` WebDAV MVP.
- `[IMPLEMENTED-UNVERIFIED]` One-way local-to-server synchronization CLI MVP.
- `[IMPLEMENTED-UNVERIFIED]` Partial modularization into repositories, services, routes, middleware, and database modules.

### Known architectural condition

- `[IMPLEMENTED-UNVERIFIED]` `server.js` remains the central integration file and is several thousand lines long.
- `[BLOCKED]` Broad modularization is blocked until critical security fixes and automated regression coverage exist. Track in issue #5.
- `[IMPLEMENTED-UNVERIFIED]` JSON and SQLite modes coexist; rollback flexibility exists, but behavioral parity and drift require proof.
- `[IMPLEMENTED-UNVERIFIED]` The main README does not accurately describe the current product surface.

## 1. Governance recovery

### Phase 1.0: Repository control layer

- `[CURRENT]` Create a short root `AGENTS.md` defining scope, safety, token economy, reasoning, validation, Git, and output rules. Issue #8.
- `[CURRENT]` Create this `docs/plan-tree.md` as the phase source of truth. Issue #8.
- `[CURRENT]` Create `docs/codex-workflow.md` with planner, executor, reviewer, and orchestrator boundaries. Issues #8 and #12.
- `[CURRENT]` Create `docs/product-discovery.md` for explicit future product decisions. Issues #4 and #8.
- `[CURRENT]` Create an initial code-backed security findings record. Issue #11.
- `[NEXT]` Open and review the governance PR.
- `[NEXT]` Merge only after confirming the documents do not claim unverified runtime behavior as completed.
- `[NEXT]` Close issue #8 after the governance PR merges.

### Phase 1.1: Release discipline

- `[NEXT]` Require one coherent goal per branch and PR. Issue #12.
- `[NEXT]` Require starting/final SHA, changed files, validations, unvalidated items, and remaining limitations in completion reports.
- `[NEXT]` Require plan-tree updates only after evidence.
- `[NEXT]` Prohibit force-pushes, history rewrites, and accidental removal of newer user work.
- `[NEXT]` Record CI status for the exact final SHA once CI exists.

## 2. Security stabilization

No new product feature should begin before the minimum security gate in phases 2.0 through 2.3 is completed.

### Phase 2.0: Bounded security inventory

Issue: #11

- `[NEXT]` Confirm the exact current code paths for the known findings below.
- `[NEXT]` Inspect only adjacent auth, realtime, and rendering helpers for equivalent defects.
- `[NEXT]` Assign severity, preconditions, impact, remediation issue, and validation requirement.
- `[NEXT]` Do not change runtime code during the inventory.
- `[NEXT]` Update `docs/security/current-findings.md` with confirmed evidence.

Known starting findings:

- hard-coded fallback for `JWT_SECRET`;
- bearer token and permission metadata in browser `localStorage`;
- user-controlled dashboard event text rendered through `innerHTML`;
- JWT passed in the WebSocket URL query string;
- role and permission claims embedded for an eight-hour token lifetime;
- no confirmed functional 2FA despite the QR dependency;
- dependency and regression-test baseline incomplete.

### Phase 2.1: Critical configuration and XSS fixes

Issue: #1

Prerequisite: phase 2.0 inventory confirms exact surfaces.

- `[IMPLEMENTED-UNVERIFIED]` Remove the hard-coded JWT secret fallback and replace dashboard user-controlled activity/error rendering with text DOM nodes; focused checks and browser smoke validation are recorded, while direct startup and malicious-payload acceptance evidence remains incomplete.
- `[BLOCKED]` Fail startup safely when a required production secret is absent or unacceptably weak.
- `[BLOCKED]` Preserve a safe local-development setup using placeholders and explicit configuration, not committed secrets.
- `[IMPLEMENTED-UNVERIFIED]` Replace unsafe dashboard activity rendering with DOM/text rendering; source-level regression coverage exists, while malicious-payload browser proof remains incomplete.
- `[BLOCKED]` Check only directly adjacent changed surfaces for equivalent injection sinks.
- `[IMPLEMENTED-UNVERIFIED]` Add focused startup and rendering regression tests; rendering and session-bootstrap checks exist, while direct startup coverage is still missing.
- `[DONE]` Verify login and dashboard behavior after the fixes with the recorded disposable browser validation.

Completion evidence:

- missing/unsafe production secret prevents startup;
- explicit safe configuration starts correctly;
- malicious event fields display as text;
- no real secret is committed or logged;
- relevant tests or manual validation are recorded.

### Phase 2.2: Session, token transport, and authorization freshness

Issue: #2

Prerequisites: phase 2.1 complete and initial auth tests available.

- `[DONE]` Stop placing JWTs in WebSocket query strings; cookie-authenticated upgrades validate Origin and the current session user before events are sent. Focused checks and recorded disposable browser/WebSocket validation passed.
- `[DONE]` Design and implement one bounded cookie-authenticated WebSocket handshake.
- `[IMPLEMENTED-UNVERIFIED]` Revalidate the current user and permissions on the server rather than trusting stale permission claims for the full token lifetime; HTTP revocation validation passed, but the full authorization matrix remains incomplete.
- `[IMPLEMENTED-UNVERIFIED]` Implement token/session revocation or versioning for password, role, permission, disable, and deletion changes; session-version revocation is validated, while every change path is not.
- `[DONE]` Browser sessions use secure HttpOnly cookies (`SameSite=Lax`) with CSRF checks for cookie-authenticated writes; the transport decision is made and implemented. The documented session threat model remains unresolved, so issue #2 stays open.
- `[IMPLEMENTED-UNVERIFIED]` Add tests for disabled users, removed permissions, expiry, revocation, and realtime authentication; disabled/revoked and WebSocket checks exist, while permission-removal and expiry coverage is incomplete.

Completion evidence:

- no bearer token in realtime URLs;
- removed access stops within the approved bound;
- disabled/deleted users cannot retain indefinite access;
- existing authorized HTTP and realtime behavior still works.

### Phase 2.3: Engineering and dependency baseline

Issue: #3

- `[IMPLEMENTED-UNVERIFIED]` Add repeatable `test` and static-validation scripts; `npm test` exists and syntax checks are documented, but no dedicated static-validation script exists.
- `[DONE]` Establish one meaningful vertical slice of automated security regression tests; eight focused tests now cover session, browser-token, WebSocket, WebDAV, rendering, and Archiver compatibility boundaries.
- `[IMPLEMENTED-UNVERIFIED]` Add tests for authentication, authorization, path handling, upload safety, trash, and backup/restore boundaries in small steps; authentication and backup compatibility are covered, while broader boundaries are not.
- `[IMPLEMENTED-UNVERIFIED]` Upgrade Multer and Express through compatibility-preserving changes; Express is upgraded and validated, while Multer remains a separate bounded follow-up.
- `[IMPLEMENTED-UNVERIFIED]` Review remaining dependencies in bounded groups rather than one mass upgrade; the current lockfile audit is clean, while continuing dependency review remains open.
- `[BLOCKED]` Add GitHub Actions CI for clean install, tests, static checks, and secret-safe dependency checks.
- `[BLOCKED]` Ensure fixtures and CI never include real databases, uploads, backups, quarantine contents, tokens, or credentials.

Completion evidence:

- clean checkout has a documented validation command;
- tests fail when protected behavior is intentionally broken;
- CI reports against the exact commit;
- dependency changes preserve existing behavior.

### Phase 2.4: 2FA design and implementation

Issue: #9

Prerequisites: phases 2.1 through 2.3 and a product decision about 2FA scope.

- `[DO NOT IMPLEMENT YET]` Decide admin-only versus all-user 2FA.
- `[DO NOT IMPLEMENT YET]` Design TOTP enrollment, confirmation, recovery, disable, reset, and migration.
- `[DO NOT IMPLEMENT YET]` Encrypt per-user TOTP secrets.
- `[DO NOT IMPLEMENT YET]` Hash one-time recovery codes.
- `[DO NOT IMPLEMENT YET]` Require strong reauthentication for sensitive 2FA changes.
- `[DO NOT IMPLEMENT YET]` Add generic challenge errors, rate limiting, and safe audit events.
- `[DO NOT IMPLEMENT YET]` Implement and validate in multiple bounded tasks.

## 3. Operational validation of existing features

Issue: #7

Prerequisites: critical security fixes complete and disposable local workspace available.

### Phase 3.0: SQLite migration and persistence

- `[BLOCKED]` Run migrations in a disposable workspace.
- `[BLOCKED]` Run JSON-to-SQLite import twice and prove idempotence.
- `[BLOCKED]` Verify users, permissions, folders, links, versions, audit, analytics, pending uploads, and encrypted metadata.
- `[BLOCKED]` Restart and confirm persistence.
- `[BLOCKED]` Record JSON fallback and dual-write limitations.

### Phase 3.1: Backup and restore

- `[BLOCKED]` Create a disposable backup containing controlled metadata and files.
- `[BLOCKED]` Verify manifest, checksum, exclusion of secrets, and retention behavior.
- `[BLOCKED]` Execute a restore only against disposable data.
- `[BLOCKED]` Verify pre-restore backup and restart requirements.
- `[BLOCKED]` Test traversal, absolute-path, and symlink rejection with safe fixtures.

### Phase 3.2: Trash and file lifecycle

- `[BLOCKED]` Verify file and folder move to trash.
- `[BLOCKED]` Verify restore conflicts and metadata preservation.
- `[BLOCKED]` Verify permanent-delete authorization.
- `[BLOCKED]` Verify public links, preview, download, versions, and cloud references do not bypass trash state.
- `[BLOCKED]` Verify cleanup behavior and restart persistence.

### Phase 3.3: Upload scanning and quarantine

- `[BLOCKED]` Verify safe file upload.
- `[BLOCKED]` Verify suspicious extension handling.
- `[BLOCKED]` Verify quarantine invisibility and access denial.
- `[BLOCKED]` Verify ClamAV-unavailable fail-open/fail-closed behavior.
- `[BLOCKED]` Run live ClamAV validation only when the daemon is actually available.
- `[BLOCKED]` Verify simple, chunked, pending, preview, download, share, cloud-sync, and audit boundaries.

### Phase 3.4: WebDAV MVP

- `[BLOCKED]` Verify OPTIONS, PROPFIND, GET, HEAD, PUT, and MKCOL.
- `[BLOCKED]` Verify authorization and permission filtering.
- `[BLOCKED]` Verify expired, trashed, encrypted, version-internal, and unauthorized files remain hidden.
- `[BLOCKED]` Verify traversal rejection.
- `[BLOCKED]` Verify DELETE, MOVE, LOCK, and UNLOCK remain blocked as documented.
- `[BLOCKED]` Test an actual Windows mount where feasible.

### Phase 3.5: Synchronization MVP

- `[BLOCKED]` Verify initialization without saving passwords.
- `[BLOCKED]` Verify state, hash, mtime, and ignored-file handling.
- `[BLOCKED]` Verify new and changed uploads, pending approval, optional auto-approval, and token renewal.
- `[BLOCKED]` Verify the documented 8 MB limit.
- `[BLOCKED]` Confirm that download, deletion sync, conflict resolution, background service, and bidirectional sync remain unsupported.

### Phase 3.6: Validation report

- `[BLOCKED]` Create a dated report under `docs/validation/`.
- `[BLOCKED]` Mark each claim passed, failed, blocked, or not tested.
- `[BLOCKED]` Convert confirmed defects into separate scoped issues.
- `[BLOCKED]` Do not repair unrelated defects opportunistically inside the validation run.

## 4. Architecture stabilization

Issue: #5

Prerequisites: phases 2.1 through 2.3 complete and relevant tests covering each extraction target.

### Phase 4.0: Responsibility map

- `[BLOCKED]` Map routes, repositories, services, persistence paths, and shared helpers.
- `[BLOCKED]` Identify duplicated authorization, path, JSON/SQLite, audit, and storage logic.
- `[BLOCKED]` Define extraction order based on risk and test coverage.
- `[BLOCKED]` Do not move code during the mapping task.

### Phase 4.1: Bounded extractions

- `[BLOCKED]` Extract one domain at a time.
- `[BLOCKED]` Prefer existing partial boundaries rather than inventing a new framework.
- `[BLOCKED]` Preserve CommonJS, route names, response shapes, storage behavior, and UI contracts.
- `[BLOCKED]` Use one coherent commit per extraction.
- `[BLOCKED]` Compare behavior before and after with focused tests.

Potential extraction order after coverage exists:

1. realtime authentication and notifications;
2. upload scanning and quarantine;
3. cloud storage;
4. WebDAV;
5. file versions and lifecycle;
6. encryption;
7. remaining route families;
8. persistence-mode simplification.

### Phase 4.2: Persistence convergence

- `[BLOCKED]` Measure JSON/SQLite behavioral parity.
- `[DECISION REQUIRED]` Decide whether SQLite becomes mandatory for production.
- `[BLOCKED]` Preserve safe migration and rollback documentation.
- `[BLOCKED]` Remove legacy paths only after data migration and rollback strategy are proven.

## 5. Product discovery track

Issues: #4 and #10

This track may proceed conversationally in parallel with stabilization. Runtime implementation remains blocked until decisions are recorded and approved.

### Phase 5.0: Product identity and repository relationship

- `[PARALLEL-DISCOVERY]` Final product name and branding.
- `[PARALLEL-DISCOVERY]` Independent Root.ark versus BielOS module/legacy prototype relationship.
- `[PARALLEL-DISCOVERY]` Canonical repository and migration policy.
- `[PARALLEL-DISCOVERY]` Shared versus independent identity/authentication.
- `[PARALLEL-DISCOVERY]` Existing features to preserve, redesign, or retire.

### Phase 5.1: Users and trust model

- `[PARALLEL-DISCOVERY]` Intended users and invitation model.
- `[PARALLEL-DISCOVERY]` Administrator powers and visibility.
- `[PARALLEL-DISCOVERY]` Normal server encryption, client-side encryption, zero-knowledge compartments, or mixed design.
- `[PARALLEL-DISCOVERY]` Account recovery, key recovery, revocation, and deletion consequences.
- `[PARALLEL-DISCOVERY]` Public exposure versus private deployment.

### Phase 5.2: File and storage behavior

- `[PARALLEL-DISCOVERY]` Local, S3, Google Drive, or hybrid canonical storage.
- `[PARALLEL-DISCOVERY]` Approval workflow and intended purpose.
- `[PARALLEL-DISCOVERY]` Sharing, recipient identity, public links, expiration, and limits.
- `[PARALLEL-DISCOVERY]` Versions, retention, trash, backup, restore, and permanent deletion.
- `[PARALLEL-DISCOVERY]` Synchronization direction, conflict policy, offline behavior, WebDAV, desktop, mobile, and PWA expectations.

### Phase 5.3: Privacy and operations

- `[PARALLEL-DISCOVERY]` Audit and analytics visibility.
- `[PARALLEL-DISCOVERY]` Data export and portability.
- `[PARALLEL-DISCOVERY]` Operational ownership, deployment, updates, and recovery.
- `[PARALLEL-DISCOVERY]` Features explicitly rejected or deferred.

### Phase 5.4: Approved product brief

- `[BLOCKED]` Convert answers into explicit decisions with consequences.
- `[BLOCKED]` Create architecture documents for high-risk boundaries.
- `[BLOCKED]` Reconcile this plan tree and feature backlog with the approved direction.
- `[BLOCKED]` Do not silently reinterpret old implementation as the final product contract.

## 6. Feature backlog

Issue: #6

All items below are candidates, not commitments.

### Authentication and administration

- `[DO NOT IMPLEMENT YET]` 2FA/TOTP. Dedicated gated issue #9.
- `[DO NOT IMPLEMENT YET]` Recovery and session-management UI.
- `[DO NOT IMPLEMENT YET]` User groups and group permissions.

### Search and previews

- `[DO NOT IMPLEMENT YET]` SQLite FTS5 content indexing.
- `[DO NOT IMPLEMENT YET]` Advanced filters.
- `[DO NOT IMPLEMENT YET]` Better image, PDF, office, media, and code previews.
- `[DO NOT IMPLEMENT YET]` Thumbnail generation and lifecycle.

### Clients and protocols

- `[DO NOT IMPLEMENT YET]` Installable PWA.
- `[DO NOT IMPLEMENT YET]` Bidirectional desktop synchronization.
- `[DO NOT IMPLEMENT YET]` Conflict resolution and deletion sync.
- `[DO NOT IMPLEMENT YET]` Background/startup service.
- `[DO NOT IMPLEMENT YET]` WebDAV MOVE/DELETE integrated with trash and versions.
- `[DO NOT IMPLEMENT YET]` Mobile client or mobile-specific strategy.

### Product and interface

- `[DO NOT IMPLEMENT YET]` Final rename and branding migration.
- `[DO NOT IMPLEMENT YET]` Major UI redesign.
- `[DO NOT IMPLEMENT YET]` New product features proposed casually in chat without discovery and issue creation.

## 7. Documentation and release readiness

### Phase 7.0: Documentation synchronization

- `[LATER]` Rewrite README to match the actual stack and capabilities.
- `[LATER]` Add safe setup and environment-variable documentation.
- `[LATER]` Link backup, migration, trash, WebDAV, sync, scanning, and security documents.
- `[LATER]` Clearly label MVP limitations and unvalidated claims.
- `[LATER]` Remove references to dependencies or architecture that no longer exist.

### Phase 7.1: Release gate

- `[BLOCKED]` Critical security findings closed or explicitly accepted.
- `[BLOCKED]` Repeatable tests and CI pass for the exact release SHA.
- `[BLOCKED]` Disposable operational validation completed.
- `[BLOCKED]` Backup and restore procedure proven.
- `[BLOCKED]` Secrets and generated data excluded.
- `[BLOCKED]` Deployment exposure and TLS/reverse-proxy configuration documented and verified.
- `[BLOCKED]` Product trust model and intended audience explicitly approved.
- `[BLOCKED]` Known limitations published honestly.

## 8. Immediate execution order

1. `[CURRENT]` Finish and review the governance documentation PR. Issues #8 and #12.
2. `[NEXT]` Run the bounded security inventory. Issue #11.
3. `[NEXT]` Execute critical JWT configuration and XSS fixes. Issue #1.
4. `[NEXT]` Establish the first automated security regression slice and dependency-safe baseline. Issue #3, limited initial scope.
5. `[NEXT]` Harden sessions, authorization freshness, and WebSocket token transport. Issue #2.
6. `[NEXT]` Expand automated tests and CI. Issue #3 remaining scope.
7. `[NEXT]` Validate existing SQLite, backup, trash, scanning, WebDAV, and sync MVPs with disposable data. Issue #7.
8. `[LATER]` Modularize high-risk domains after coverage exists. Issue #5.
9. `[PARALLEL-DISCOVERY]` Conduct structured product discovery and resolve the BielOS relationship. Issues #4 and #10.
10. `[BLOCKED]` Approve individual future features only after stabilization and discovery. Issues #6 and #9.

## 9. Plan-tree update rule

When completing a task:

1. verify the actual final commit and branch;
2. record the exact validations performed;
3. distinguish passed, failed, blocked, and not run;
4. update only the affected plan-tree items;
5. do not erase historical limitations;
6. link the PR, issue, validation report, or architecture decision;
7. select the next item based on remaining risk, not novelty;
8. stop instead of inventing filler phases.
