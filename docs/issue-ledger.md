# Root.ark Issue Ledger

## Fresh control evidence addendum — 2026-08-13

Fresh exact-attachment evidence is linked at `docs/validation/2026-08-13-rootark-fresh-control-evidence.md`. The attachment is verified as 468 lines with SHA-256 `31822A11CACDC5B2693861F2CA945F0A895673F08E925EF1E66CBF4BE73B56DB`. Control-plane provenance is App Server thread `019ffb95-e675-76e1-ae22-a3129af79b5a`, latest fresh completed bounded turn `019ffcfa-d41d-7fc2-a80b-f8790578b6c1`, request `rootark-exact-attachment-20260813-fresh-c`; prior turn `019ffcf0-0977-7e43-a8a8-70065bb1f937` was an incomplete timed-out attempt only.

The linked artifact preserves the exact network diagnostics, per-command focused/full test-failure ledger, and independent rootark-zk-1 review. The formal verdict is **Approved with reservations**. Phase 8 is `PARTIAL`, Phase 9 is `NOT_STARTED`, and Phase 15 is `BLOCKED_ENVIRONMENT` with `RELEASE_GATE_BLOCKED_ENVIRONMENT` wording preserved; publication authorization is separately bounded. The two named `.codex-fresh-cache-20260813-b` and `.codex-fresh-install-20260813-b` directories were exact-scope inspected, removed, and verified absent without targeting user data or unrelated dirty changes.

Reconciled locally on 2026-08-13 against the verified canonical baseline `Root/main` at `28747c6ebdac873650e2d5a3c6193824e7cc9985`. This is local evidence only; no issue, PR, branch, or remote setting was changed.

| Issue | State | Evidence / remaining boundary |
|---:|---|---|
| #1 | `historical-complete` | JWT/startup/XSS stabilization remains covered by current focused tests and security documents; no reimplementation. |
| #2 | `historical-complete` | Cookie sessions, CSRF, realtime Origin/freshness, revocation, and expiry remain covered; current auth suite passed 13/13. |
| #3 | `historical-complete` | Validation/CI/dependency baseline is preserved; exact current local test evidence is recorded per phase. |
| #4 | `open-current` | Product discovery decisions D-001–D-009 are recorded, but branding and remaining product-policy questions still require owner confirmation. |
| #5 | `open-current` | Realtime and upload scanning boundaries are now bounded locally, and the zero-knowledge architecture/migration contract is drafted as a bounded design; WebDAV, full persistence parity, implementation, acceptance, and remote closure remain open. |
| #6 | `open-current` | Feature backlog remains gated by product, security, and architecture decisions; no feature was silently approved. |
| #7 | `historical-complete` | Operational report is preserved with PASS/BLOCKED distinctions; live ClamAV, OS mount, external providers, and production behavior remain environmental limits. |
| #8 | `historical-complete` | Governance/source-of-truth documents are preserved and synchronized locally where stale branch claims affected execution. |
| #9 | `blocked-by-owner-decision` | 2FA/TOTP remains gated by explicit scope and the zero-knowledge/account-recovery model; no implementation was invented. |
| #10 | `closure-ready-local` | D-001's current independent Root.ark/BielOS boundary and technical relationship contract are documented and closure-ready locally; future integration, migration, identity, and key relationships remain a separate owner-dependent project. Remote issue closure remains unclaimed because remote mutation is prohibited in this packet; no remote state is inferred. |
| #11 | `historical-complete` | Bounded security inventory is historical evidence; changed-boundary reviews were focused rather than broad rescans. |
| #12 | `historical-complete` | Release discipline and evidence-before-DONE rules remain active; this mission made no publication. |
| #13 | `discarded` | Historical placeholder; no implementation required. |
| #14 | `closure-ready-local` | Root/main and canonical SHA are verified locally and stale local references were corrected. The technical branch/default-state work is closure-ready locally; remote issue closure remains unclaimed because remote mutation is prohibited in this packet, and no remote state is inferred. |
| #15 | `historical-complete` | Governance review is historical evidence; review/correction discipline remains active. |

## Current local gate

The worktree contains uncommitted implementation/test/documentation changes from the bounded phases. Fresh Phase A-C recovery preserved branch `cdx/rootark-roadmap` and HEAD `28747c6ebdac873650e2d5a3c6193824e7cc9985`. No push, merge, pull request, issue mutation, release, tag, deploy, or remote setting change was performed. Remaining work is gated by dependency/network recovery, zero-knowledge implementation and owner decisions, WebDAV and full persistence parity, native/provider/production evidence, and deliberate publication authorization.

## Master phase ledger (original Phase 0-16 numbering)

The continuation governing this correction supplies the authoritative original meanings for Phases 0-16. Statuses below classify only the local evidence and remaining work; they do not convert historical, local, or design evidence into product acceptance.

Primary Phase 0-16 statuses use only `ACCEPTED`, `PARTIAL`, `BLOCKED_OWNER_DECISION`, `BLOCKED_ENVIRONMENT`, `BLOCKED_PUBLICATION_AUTHORIZATION`, `FAIL_CLOSED`, or `NOT_STARTED`. Detailed evidence and descriptive qualifiers remain secondary text.

| Phase | Original meaning | Status | Evidence | Remaining dependency | Next action |
|---:|---|---|---|---|---|
| 0 | Orientation/baseline | `ACCEPTED` | Starting SHA `28747c6ebdac873650e2d5a3c6193824e7cc9985`, verified `Root/main`, current dirty worktree preserved | No reset/clean or baseline rewrite; provenance must remain explicit | Keep every continuation report anchored to the verified SHA and dirty-state map |
| 1 | Historical evidence | `PARTIAL` | Issue #7 report records 21 `PASS`, 0 `FAIL`, 2 environmental `BLOCKED`; Issue #7 ledger state is historical-complete | Fresh rerun, live ClamAV, OS mount, providers, production behavior remain unclaimed | Preserve historical evidence and rerun only with disposable capabilities |
| 2 | Issue #14 | `ACCEPTED` | `Root/main`, `origin/HEAD`, and canonical SHA are locally verified; stale branch references were corrected | Remote issue state cannot be changed in this packet and is not inferred | Leave remote Issue #14 untouched; report technical closure separately |
| 3 | Realtime contract tests | `BLOCKED_ENVIRONMENT` | Fresh focused run reached 33 tests: 19 passed and 14 failed on dependency-loading `MODULE_NOT_FOUND` errors; prior 7/7 evidence remains historical/local only | Complete disposable dependency install; buffered-client closure remains unverified | Re-run the focused suite after registry and dependency recovery |
| 4 | Realtime auth/notifications extraction | `BLOCKED_ENVIRONMENT` | Source boundary remains bounded, but fresh realtime/auth execution could not load `bcryptjs`; no fresh runtime acceptance is claimed | Complete dependencies, browser, CI, buffered-client, and production evidence remain open | Re-run runtime boundary tests after dependency recovery |
| 5 | Bounded architecture extraction | `BLOCKED_ENVIRONMENT` | Source and prior local contracts remain preserved; fresh focused execution was blocked by missing `@aws-sdk/client-s3` and `better-sqlite3` | Complete dependencies, chunked/WebDAV/provider parity, live ClamAV, OS mount, and lifecycle proof remain open | Re-run bounded suites after dependency recovery |
| 6 | JSON/SQLite parity | `BLOCKED_ENVIRONMENT` | Targeted prior 70/70 evidence remains historical; fresh SQLite tests could not load `better-sqlite3`, and disposable install did not complete | Complete native dependency, full semantic parity, migration/restart, rollback, and production SQLite policy remain open | Run the disposable parity matrix after native dependency recovery |
| 7 | Product discovery and Root.ark/BielOS contract | `PARTIAL` | `docs/architecture/rootark-bielos-relationship-contract.md` records independent systems and no automatic sharing; Issue #10 is closure-ready-local | Future integration, migration, identity, and key relationships require owner approval; remote issue untouched | Keep Root.ark and BielOS independent until separately approved |
| 8 | Zero-knowledge architecture/migration | `PARTIAL` | `docs/architecture/zero-knowledge-migration-contract.md` now records an Architect recommendation for suite, audited module boundary, key hierarchy, envelope/AAD, lifecycle, migration, interoperability, and failure classes | Independent security review, metadata/recovery/bridge review, owner product decisions, implementation, migration, and acceptance remain open | Review or revise the recommendation; resolve genuine owner gates separately |
| 9 | Zero-knowledge implementation program | `NOT_STARTED` | Current server-readable encryption, previews, scanning, WebDAV, sync, and backup remain legacy behavior; no crypto implementation or implementation-only scaffolding was added | Independent review acceptance, owner migration policy, and implementation authorization | Do not implement crypto or migration until the architecture gate is approved |
| 10 | Issue #9 2FA/TOTP | `BLOCKED_OWNER_DECISION` | Plan tree and issue ledger preserve 2FA as gated; no implementation was invented | Scope, recovery coupling, enrollment, reset, and migration policy require owner direction | Keep Issue #9 gated |
| 11 | Issue #6 backlog reconciliation | `PARTIAL` | `docs/plan-tree.md` §6 lists deferred features and explicitly rejects casual implementation | Stabilization, product decisions, security review, and scoped issues remain prerequisites | Approve features individually only after gates close |
| 12 | Bidirectional sync/WebDAV bridge | `NOT_STARTED` | Current evidence covers one-way sync MVP and direct server WebDAV only; D-009 requires client/local-bridge boundaries | Bridge, conflict authority, bidirectional protocol, metadata, recovery, and acceptance remain open | Design as a separate D-009 project; do not infer it from current MVPs |
| 13 | Search/previews/PWA/clients/groups/admin UX | `NOT_STARTED` | Existing search/preview/admin surfaces are current implementation; plan backlog marks PWA, clients, groups, FTS, and redesign as not-yet-approved | Product scope, trust model, client architecture, and UX decisions remain open | Keep backlog deferred |
| 14 | Deployment/adapters/resilience | `BLOCKED_ENVIRONMENT` | Fresh artifact and syntax checks passed, but dependency, native-binding, provider, and production gates remain unavailable; no deployment acceptance is claimed | Provider, deployment, TLS, production, native dependency, and resilience evidence remain open; remote Issue #14 mutation prohibited | Recover dependencies, then repeat environment-specific validation |
| 15 | Documentation/release gate | `BLOCKED_ENVIRONMENT` | The local release gate is blocked by incomplete dependency/network, native-binding, provider, and CI evidence; documentation and secret-scan checks passed locally | Exact-SHA CI, deployment exposure, product approval, and publication authorization remain separate open boundaries | Recover the environment and complete release evidence; seek publication authorization separately |
| 16 | Independent security/quality review | `BLOCKED_ENVIRONMENT` | Architect review found no concrete source defect; residual runtime/provider/production risks remain unvalidated because the fresh dependency gate is blocked | Independent final review, complete validation, and quality gate evidence remain outstanding | Repeat final security/quality review after dependency recovery |

## Phase 8 technical status addendum (2026-08-13)

Phase 8 remains `PARTIAL`: the zero-knowledge contract now contains a concrete Architect recommendation pending independent security review, covering standards-based primitives, the audited client crypto-module boundary, key hierarchy, envelope/AAD/version registry, device/recovery lifecycle, derived data, sharing, backup/erasure, local WebDAV bridge, sync, migration/rollback, fixtures, and failure classification. This resolves implementation-only design questions without claiming implementation or owner approval. Phase 9 remains `NOT_STARTED`; no crypto implementation, migration, dependency, runtime, test, or package change was made. Current server-readable behavior remains legacy and is not zero-knowledge evidence.

## Local diagnostic classifications (2026-08-13)

These are independent local execution classifications. None is a publication authorization decision, and none authorizes remote mutation.

| Boundary | Classification | Safe evidence | Meaning and next action |
|---|---|---|---|
| Linked-worktree Git metadata | `BLOCKED_ENVIRONMENT_LOCAL_GIT_ACL` | `E:\servidor-roadmap\.git` points to `E:\servidor\.git\worktrees\servidor-roadmap`; the common object store is `E:\servidor\.git`. `git worktree list --porcelain` shows no live lock files; `git cat-file -e HEAD` succeeds. Read-only ACL inspection found no deny entry for the active `codexsandboxoffline` account, but metadata/object write behavior remains unsafe to change. | No safe ACL repair was applied because no active-account deny was proven and broad ownership/permission changes are prohibited. Preserve the worktree and classify the write boundary as environment-blocked. |
| npm install/toolchain | `BLOCKED_TOOLCHAIN_DEPENDENCY_INSTALL` | Node `v24.14.1`, npm `11.11.0`, lockfile version 3 with 378 locked packages, absent `node_modules`, and missing `bcryptjs`, `@aws-sdk/client-s3`, and `better-sqlite3`. DNS resolves `registry.npmjs.org`, but TCP/HTTPS 443 connectivity fails. A disposable cache/install was attempted; `npm.cmd ci` timed out after 120 seconds and did not produce usable dependencies. | The dependency tree is incomplete. This is an environment/network boundary, not a source regression; retry only with a functioning disposable install path. |
| Native SQLite dependency | `BLOCKED_NATIVE_DEPENDENCY` | The existing continuation evidence records `npm.cmd rebuild better-sqlite3` exiting 0 while package contents remained incomplete and `require()` still failed. | A successful rebuild exit code is insufficient evidence of a usable native binding; do not claim SQLite runtime validation. |
| npm audit endpoint | `BLOCKED_REGISTRY_AUDIT_ENDPOINT` | Fresh `npm.cmd audit --package-lock-only --audit-level=high` and `npm.cmd run validate:dependencies` failed at the npm advisory endpoint after registry connectivity failure. | Audit evidence is unavailable; this is separate from install completeness. |
| Product/architecture decisions | `BLOCKED_OWNER_DECISION` | D-003/D-006/D-007/D-009 and the zero-knowledge contract leave product policy, migration scope, recovery authority, sharing UX, and sync conflict authority open. | Owner-visible decisions remain separate from technical primitive selection and local tool failures. |
| Publication and remote mutation | `NOT_A_PUBLICATION_BLOCKER` | This packet explicitly prohibits commit, push, PR, merge, release, deploy, and issue/remote mutation. | Publication is an authorization boundary, not the cause of the local npm or Git failures. Handle it only under a later explicit authorization. |

## Continuation authorization addendum — 2026-08-13

The documentation-only continuation report is `docs/validation/2026-08-13-rootark-continuation-master-report.md`. Trusted-wrapper provenance records executor `biel4`, backend `app_server`, branch `cdx/rootark-roadmap`, base SHA `28747c6ebdac873650e2d5a3c6193824e7cc9985`, App Server thread `019ffb95-e675-76e1-ae22-a3129af79b5a`, current provenance turn `019ffd1b-057f-73a3-a53b-1619612ff2e8`, process `21208`, `reuse_existing=false`, and `app_server` task transport; this is wrapper provenance, not model text. The current mission supersedes the prior packet's no-publication boundary only for this mission's authorized local commits, scoped branches, pushes, and PR creation/update within `bielxdh3/root.ark`; no merge, release, tag, deploy, destructive remote, issue-state, or settings action is authorized, and no such publication action has occurred yet.

Rootark-zk-1 remains **Approved with reservations**. The three reservations are: independent cryptographic review blocking Phase 8, including library/provenance/vector checks; genuine owner decisions for sharing UX/expiry/recipient recovery, recovery authority, mixed-mode migration window, sync conflict authority, and authentication/2FA coupling; and implementation acceptance for interoperability, negative/fuzz/property coverage, recovery/rotation/compromise, bridge crash safety, migration rollback, backup/restore, and no plaintext/key leakage. Environment-dependent validation remains separately blocked.

Phase 8 remains `PARTIAL`, Phase 9 `NOT_STARTED`, and Phase 15 `RELEASE_GATE_BLOCKED_ENVIRONMENT`. No new zero-knowledge runtime implementation is claimed. Static checks remain recorded as passed (`node --check` on seven changed/new JavaScript files, `git diff --check`, and scoped secret scan with zero matches); dependency-backed tests remain blocked as documented in the fresh-control artifact. Current semantic commit families are proposal-only. No commit, push, scoped branch, or PR action has occurred in this continuation; commit is permitted only after semantic diff review and focused validation. `RELEASE_GATE_BLOCKED_ENVIRONMENT` is independent of publication authorization. The direct `npm.cmd audit --package-lock-only --audit-level=high` returned exit 1; the current audit result identifies one high transitive brace-expansion 5.0.8 advisory (`GHSA-rgw5-rvv9-x895`, CVE-class DoS) through `archiver -> readdir-glob -> minimatch` 10.2.6. The fixed repair target is brace-expansion 5.0.9 with official integrity `sha512-ScQ4IuvIEF1TMlP7Zt+vjJ//9zlPb2SDcxWxM3bk8s6t6GGdJ7KO1dCcTidOPJKePW30LE/2cT7wCyPho9/Wxg==`. The online audit-fix attempt failed with registry/cache EPERM; the required offline lockfile-only attempt returned exit 0 without changing `package-lock.json`. Classify this as `SECURITY_DEPENDENCY_ADVISORY` plus `BLOCKED_ENVIRONMENT_TOOLCHAIN_REPAIR`, not as a clean audit or a generic advisory-endpoint absence.

## ARCHITECT DIFF REVIEW

Independent review of the current dirty diff found no concrete source defect requiring a correction packet. The bounded realtime/upload changes retain their documented adapters and security boundaries; documentation and architecture changes preserve the independent Root.ark/BielOS and zero-knowledge limitations. Residual risks are limited to unproven dependency-backed runtime behavior, native SQLite, providers, browser/CI/production behavior, full parity, and zero-knowledge implementation/migration acceptance.

## LOCAL COMMITS

None created. HEAD remains `28747c6ebdac873650e2d5a3c6193824e7cc9985`; the linked-worktree Git write boundary remains environment-blocked and no commit readiness is claimed.

## FRESH VALIDATION MATRIX

| Command | Result | Exact evidence |
|---|---|---|
| `node scripts/validate-syntax.js` | PASS | 83 checked, 0 failed; exit 0. |
| `node scripts/validate-runtime-artifacts.js` | PASS | Protected artifact guard passed; exit 0. |
| Scoped secret scan | PASS | 9 scoped source/test/ledger/validation targets scanned; 0 sensitive-pattern matches. |
| Focused realtime/auth/upload/cloud/WebDAV/SQLite run | ENVIRONMENT_BLOCKED | 33 tests: 19 passed, 14 failed on dependency-loading `MODULE_NOT_FOUND` errors for `bcryptjs`, `@aws-sdk/client-s3`, and `better-sqlite3`. |
| `npm.cmd test -- --test-reporter=tap` | ENVIRONMENT_BLOCKED | 106 tests: 34 passed, 72 failed; repository `node_modules` was absent and failures were dependency-loading failures. |
| `npm.cmd audit --package-lock-only --audit-level=high` | ENVIRONMENT_BLOCKED | Exit 1; advisory endpoint failed. |
| `npm.cmd run validate` | ENVIRONMENT_BLOCKED | Exit 1 after syntax passed and dependency-missing test stage failed. |
| `git diff --check` | PASS | Exit 0. |

No concrete source defect was identified in the fresh failures.

## RELEASE GATE

`RELEASE_GATE_BLOCKED_ENVIRONMENT`: syntax, artifacts, secret scan, and whitespace checks pass, but dependency installation, native SQLite, focused/runtime acceptance, audit, CI, provider, production, and exact release authorization are incomplete. No commit or publication has occurred yet; scoped commits, branches, pushes, and PRs are authorized only after semantic diff review and focused validation.

## FINAL SECURITY/QUALITY REVIEW

Security/quality verdict: **Approved with reservations** for local documentation and evidence reconciliation only. Authentication, authorization, path containment, quarantine, WebDAV journaling, storage isolation, audit exclusions, and independent Root.ark/BielOS boundaries remain preserved in the reviewed diff. No concrete source defect was found. Residual risks are the environment-blocked dependency/runtime gate, native/provider/production boundaries, full parity, browser/CI evidence, and zero-knowledge implementation/migration acceptance.

## NEXT EXECUTABLE ACTION

Restore TCP/HTTPS access to `registry.npmjs.org` or provide an approved equivalent disposable package source, then rerun `npm.cmd ci` in a disposable cache/install root. If installation completes, run the focused matrix, `npm.cmd test`, `npm.cmd audit --package-lock-only --audit-level=high`, `npm.cmd run validate`, and `git diff --check`; only then reassess commit/release readiness. Do not change ACLs broadly or mutate remote state.
