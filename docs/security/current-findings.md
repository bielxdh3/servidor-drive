# Root.ark Current Security Findings

## Browser-session threat model (2026-07-31)

`docs/security/browser-session-threat-model.md` records the implemented cookie, CSRF, current-user/session-version, bootstrap, and WebSocket boundaries. The Phase 2.2 closure audit reconciles permission removal, token expiry, active-WebSocket freshness, and deleted-identity recreation. Issue #2 is ready to close after the documentation-only closure-audit PR merges. The login-response token exposure remains a residual risk outside this closure.

## Deleted-identity session resurrection (2026-07-31)

Issue #2 previously allowed a deleted username to be recreated at `sessionVersion: 0`, which could revalidate an unexpired old JWT and active WebSocket. JSON now retains only a persistent, Git-ignored per-username generation ledger, while SQLite atomically increases the soft-deleted row's `session_version` during recreation. Real JSON HTTP/WebSocket regression coverage confirms old sessions remain revoked and new sessions work; restart persistence and repeated SQLite recreation are also covered. The Phase 2.2 closure audit found no distinct bypass.

## PR #17 validation reconciliation (2026-07-30)

The analytics-to-dashboard Playwright XSS proof completed for application SHA `7b270f91810e8e0d86e5998086e3d04ba1178744` (PR #18, run `30599233724`, `1 passed (3.5s)`): the real login, persistence, `/analytics/recent`, and literal dashboard-rendering flow produced no malicious element or `onerror` execution. Permanent `Security Regression` CI then succeeded on workflow-only SHA `666fcbe5aee30710b20a01e13b1a24c8c6313206` (run `30600354792`); that commit changed no runtime code. Issue #2's broader authorization coverage, and issue #3's broader regression coverage and unrelated dependency work, remain open.

## PR #17 reconciliation (2026-07-30)

Disposable validation on the PR branch confirmed that bearer authentication succeeds for the sync client without browser cookies or CSRF, while invalid and session-revoked tokens return `401`. Public-share routes accept no browser authentication or CSRF requirement; a valid link succeeds, malformed links return `404`, and expired links return `410`. `npm test` passed (8 tests) and `npm audit --package-lock-only` reported zero vulnerabilities.

The Archiver 8 upgrade initially broke the real backup path because CommonJS now exports `ZipArchive` rather than a callable factory. PR #17 now uses `ZipArchive`; an automated ZIP regression test and a disposable backup archive validation pass. Recorded browser and WebSocket smoke validation, plus sync-client and public-link validation, passed. Remaining owner-issue work includes broader authorization cases and regression coverage; the documented browser-session threat model identifies its focused validation gaps.

## Stabilization update (2026-07-29)

S-001 through S-005 were reconfirmed against the current authentication, dashboard, and realtime paths and are addressed on `agent/rootark-security-stabilization`. The implementation requires an explicit strong `JWT_SECRET`; browser authentication uses an HttpOnly, `SameSite=Lax` cookie with CSRF checks for cookie-authenticated writes; protected requests and WebSocket upgrades load the current user and compare a persisted session version. Browser pages use the current server identity and no longer persist authentication data or place a credential in a WebSocket URL. Dashboard activity and errors now use text DOM nodes. Focused automated checks cover these boundaries; disposable runtime/browser verification remains required before closing the issues.

Status: initial code-backed inventory; runtime exploitation and regression validation still required

Baseline branch: `codex/folders-acl`

Baseline SHA: `4062f4c67bfda9d144aceb6dbbed539b8a917e4a`

Related issues: #1, #2, #3, #7, #9, #11

## Status labels

- `[CONFIRMED-CODE]`: the risky behavior is directly present in code.
- `[NEEDS-RUNTIME-PROOF]`: code suggests risk, but the complete exploit or behavior needs a controlled runtime test.
- `[DESIGN-RISK]`: behavior may be acceptable only after an explicit product/threat-model decision.
- `[MITIGATED-PARTIALLY]`: meaningful protection exists, but limitations remain.
- `[FIXED]`: remediation merged and relevant validation passed.
- `[ACCEPTED]`: risk explicitly accepted with rationale and boundaries.

## Severity guide

- Critical: likely complete compromise or irreversible data loss under realistic exposure.
- High: serious unauthorized access, token/account compromise, or security-boundary bypass.
- Medium: meaningful exposure requiring additional preconditions or limited impact.
- Low: hardening, information exposure, or resilience weakness with narrow direct impact.

Severity must be revised when deployment exposure and runtime evidence are known.

## Executive summary

The application already includes meaningful defensive work: bcrypt password verification, dummy hashing for missing users, rate limiting, progressive login delays, generic login errors, audit events, suspicious upload blocking, optional scanning/quarantine, restore path validation, and permission-aware features.

The most urgent remaining chain is:

1. a public hard-coded JWT fallback can make token forgery possible when configuration is missing;
2. user-controlled dashboard event text is rendered through `innerHTML`;
3. browser tokens are stored in `localStorage`;
4. a successful XSS can therefore steal a bearer token with privileged permissions;
5. permission claims can remain valid for the token lifetime even after access changes;
6. WebSocket authentication additionally places the bearer token in a URL.

Fix this chain before adding new product features.

## S-001: Hard-coded JWT secret fallback

- Status: `[CONFIRMED-CODE]`
- Initial severity: Critical when remotely exposed with the fallback active; otherwise High configuration hazard.
- Owner issue: #1
- Surface: `server.js`, `JWT_SECRET` initialization.

### Evidence

The server uses `process.env.JWT_SECRET` and falls back to a public repository string when the variable is absent.

### Preconditions

- the application starts without an explicit secret;
- an attacker knows or can read the public source;
- protected routes trust tokens signed with that secret.

### Impact

An attacker can potentially forge JWTs containing an administrator identity, role, and permissions, bypassing login and server authorization that trusts the token.

### Required remediation

- remove the fallback;
- fail startup safely when required configuration is absent;
- define an explicit local-development path using uncommitted configuration;
- validate minimum entropy/length according to the selected design;
- never log the secret;
- add focused startup tests.

### Completion evidence

- startup fails without explicit required configuration;
- startup succeeds with a test secret supplied through the environment;
- forged tokens signed with the old public fallback are rejected;
- no real secret is committed.

## S-002: Stored/DOM XSS path in dashboard activity rendering

- Status: `[CONFIRMED-CODE]` sink; `[NEEDS-RUNTIME-PROOF]` complete source-to-sink exploit.
- Initial severity: High.
- Owner issue: #1
- Surface: `public/dashboard.html`, recent activity and error rendering.

### Evidence

Recent analytics events are converted into template strings and assigned to `recentActivity.innerHTML`. Event fields include username and filename. The event text is also inserted into an HTML attribute.

The dashboard error path inserts `error.message` through `innerHTML` as well.

### Preconditions

- an attacker can cause a malicious username, filename, event type, or propagated error string to reach the analytics response;
- a user with dashboard access loads the activity feed;
- browser protections do not otherwise neutralize the payload.

### Impact

Arbitrary JavaScript may execute in the Root.ark origin under the dashboard user's session. This can read browser storage, call authenticated APIs, alter UI, and exfiltrate bearer tokens.

### Required remediation

- construct DOM nodes and assign `textContent`/safe properties;
- never interpolate event data into HTML strings or attributes;
- render errors as text;
- add malicious username/filename/event regression cases;
- inspect only directly adjacent dashboard rendering helpers for equivalent sinks.

### Completion evidence

Payloads containing tags, quotes, event handlers, and script-like text display literally and do not execute.

## S-003: Browser bearer-token persistence

- Status: `[FIXED]` for shipped browser pages; residual login-response exposure remains.
- Initial severity: High as an impact amplifier; residual severity: Medium under same-origin XSS.
- Owner issue: #2
- Surface: `public/login.html` and authenticated pages.

### Evidence

Shipped browser pages load current identity from authenticated `/auth/session.js`, use same-origin cookie credentials, and do not persist JWTs in browser storage or put them in WebSocket URLs. The login JSON response still includes an unused token.

### Preconditions

- JavaScript executes in the application origin through XSS, a compromised dependency/CDN, malicious browser extension, or local compromise.

### Impact

Same-origin JavaScript can read the unused login response token; it cannot directly read the HttpOnly session cookie. Server authorization remains authoritative.

### Required remediation

Keep the current cookie/CSRF/Origin/session-version model. Route removal of the unused login-response token to a later bounded finding; do not treat it as an issue #2 closure blocker.

### Completion evidence

- browser pages contain no persisted auth keys or WebSocket URL token;
- cookie, CSRF, Origin, current-user, expiry, and generation checks are covered by Phase 2.2 evidence;
- logout clears the current browser cookies but is not represented as global copied-JWT revocation.

## S-004: JWT included in WebSocket URL query string

- Status: `[FIXED]`.
- Initial severity: Medium to High depending on proxy/logging exposure; final severity: addressed in issue #2.
- Owner issue: #2
- Surface: dashboard WebSocket connection and realtime authentication.

### Evidence

The browser connects to `/ws` without a credential in the URL; upgrade authentication uses only the session cookie and validates Origin.

### Preconditions

An attacker would need a separate browser/session compromise; URL logging no longer receives a bearer token from this path.

### Impact

This path no longer creates URL-based bearer-token retention or replay exposure.

### Required remediation

Preserve cookie-only upgrade authentication, expected-Origin validation, and current-user/session-version/expiry rechecks before active-WebSocket authenticated activity.

### Completion evidence

- no credential appears in the connection URL;
- unauthenticated sockets cannot receive protected events;
- permission revocation, deleted-identity recreation, and JWT-expiry regressions pass.

## S-005: Stale role and permission claims remain valid for token lifetime

- Status: `[FIXED]` within the documented next-request/next-authenticated-realtime-activity bound.
- Initial severity: High for permission revocation and disabled-user scenarios; final severity: addressed in issue #2.
- Owner issue: #2
- Surface: login token creation, HTTP authentication middleware, realtime authentication.

### Evidence

The login route signs username and `sessionVersion`; each HTTP request and WebSocket upgrade reloads the active user and compares the persisted generation, while permission checks use current server-side data. Active WebSockets repeat this freshness check before their next authenticated message or send.

### Preconditions

- a user presents a stale JWT after a role/permission/password/disabled/deletion change;
- the relevant request or active WebSocket reaches its next authenticated enforcement boundary.

### Impact

The stale token is rejected at the documented HTTP or active-WebSocket boundary. An idle socket is not polled and is closed only when its next authenticated message/send triggers revalidation.

### Required remediation

Preserve the shared update-path generation increment, JSON generation ledger, SQLite soft-delete/reactivation increment, and HTTP/realtime freshness checks.

### Completion evidence

Focused tests prove each distinct enforcement and persistence boundary; shared-path analysis establishes identical treatment for password, role, permissions, and disabled-state updates without redundant per-field tests.

## S-006: Login protection is process-local and reset on restart

- Status: `[MITIGATED-PARTIALLY]`.
- Initial severity: Medium resilience limitation; lower for a private single-instance deployment.
- Owner issue: #3 or a later dedicated issue after product deployment is decided.
- Surface: `src/routes/auth.js`.

### Existing defenses

- per-IP and per-username state;
- rate limit window;
- progressive delay;
- block threshold and duration;
- generic errors;
- dummy password hash for missing users;
- audit events;
- pruning of inactive state.

### Limitation

State is held in memory. Restarting the process clears it. Multiple instances would not share state. Correct client IP behavior also depends on trusted proxy configuration and deployment topology.

### Required decision/remediation

- for personal single-instance/private deployment, document and potentially accept the limitation;
- for public or multi-instance deployment, use a shared bounded store and validated proxy trust configuration;
- test IPv4/IPv6 normalization and reverse-proxy behavior.

## S-007: Dependency and automated security regression baseline is incomplete

- Status: `[CONFIRMED-CODE]` project configuration; specific CVEs require a current package audit.
- Initial severity: High program risk; individual dependency findings vary.
- Owner issue: #3
- Surface: `package.json`, lockfile, absent/limited test and CI scripts.

### Evidence

The package scripts focus on start, migration, backup, and synchronization. A repeatable project-level test/lint/security CI baseline is not present. Multer and Express versions require current compatibility and vulnerability review.

### Impact

Security fixes and large existing features can regress silently. Unsupported or vulnerable dependencies may remain deployed.

### Required remediation

- add a useful vertical slice of tests first;
- run a current dependency audit using the actual lockfile;
- upgrade in bounded compatibility-preserving steps;
- add CI that never includes real data or secrets;
- distinguish runtime, development, transitive, exploitable, and non-exploitable findings.

### Completion evidence

A clean checkout can run documented checks, and CI verifies the exact final commit.

## S-008: Upload scanning defaults may fail open

- Status: `[DESIGN-RISK]` and `[NEEDS-RUNTIME-PROOF]`.
- Initial severity: Medium to High depending on exposure and the product promise.
- Owner issues: #7 for validation and a future scoped defect issue if behavior violates the approved model.
- Surface: upload scanning configuration and flows.

### Evidence

Upload scanning is enabled by default with optional ClamAV and `UPLOAD_FAIL_CLOSED=false`. Suspicious extensions remain blocked independently.

### Risk

When ClamAV is unavailable, non-blocklisted malicious content may be accepted under fail-open behavior. This may be acceptable for a personal/private product that treats stored files as untrusted blobs, but not for a product promising antivirus enforcement or automatic content processing.

### Required action

- validate actual simple, chunked, pending, cloud, preview, download, and share behavior;
- decide the deployment-specific default;
- expose truthful status to administrators without leaking paths or sensitive details;
- never claim live malware scanning works unless ClamAV was actually tested.

## S-009: 2FA is not implemented merely because QR generation exists

- Status: `[CONFIRMED-CODE]` absence in current login flow; final full-repository confirmation remains in issue #11.
- Initial severity: Not a vulnerability by itself; missing hardening feature.
- Owner issue: #9

### Evidence

The login page submits only username/password, and the auth route emits a JWT immediately after password verification. The `qrcode` dependency is used elsewhere or reserved; it is not evidence of TOTP.

### Required action

Do not bolt 2FA onto the current session model before issues #1–#3 and product scope decisions are complete.

## S-010: Public/default branch and documentation drift increase operational error risk

- Status: `[CONFIRMED-CODE]` repository state/documentation mismatch.
- Initial severity: Low direct security severity, Medium operational risk.
- Owner issues: #8, #12, #14

### Evidence

The default branch name appears temporary, and the README describes a smaller/outdated stack. Security-relevant features and limitations are distributed across separate files and commits.

### Impact

Operators and agents may deploy, validate, or modify the wrong assumptions or branch. This can cause unreviewed changes, missed configuration, and false completion claims.

### Required remediation

Adopt the plan tree, branch/PR discipline, accurate README, exact SHA reporting, and documented validation gates.

## Existing protections to preserve

The following should not be accidentally removed during fixes:

- bcrypt password comparison;
- dummy password hash for unknown users;
- generic login failures;
- IP and username rate limiting;
- progressive delays and temporary blocking;
- authentication audit events;
- server-side permission middleware;
- filename/path sanitization where already present;
- suspicious extension blocklist;
- quarantine access restrictions;
- backup restore manifest/checksum/path validation;
- trash authorization and public-link invalidation;
- storage-provider separation;
- secrets and local data exclusions in `.gitignore`.

## Immediate remediation order

1. Confirm this inventory in issue #11 without editing runtime code.
2. Fix S-001 and S-002 in separate bounded commits under issue #1.
3. Establish the initial automated regression slice under issue #3.
4. Design and fix S-004 and S-005 under issue #2.
5. Decide and implement the long-term browser session model for S-003.
6. Expand dependency, CI, and operational validation.
7. Address S-006, S-008, and 2FA based on the approved deployment/product model.

## Update rule

For every finding, record:

- final severity;
- exact affected code path;
- exploit or failure preconditions;
- remediation commit/PR;
- tests and runtime validation;
- remaining limitations;
- status change.

Do not mark a finding fixed solely because the code looks different.
