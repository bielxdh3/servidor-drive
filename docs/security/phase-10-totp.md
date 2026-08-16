# Root.ark Phase 10 TOTP/2FA Security Record

Status: `PHASE_10_TOTP_IMPLEMENTED_AND_SECURITY_REVIEW_APPROVED`; this is the local engineering verdict only. It is not release readiness, production approval, remote Issue #9 closure, or publication acceptance.

## Scope and trust boundaries

The primary credential remains the existing password login. For an enrolled user, `/auth/login` issues only a short-lived, opaque in-memory challenge. `/auth/login/2fa` must prove the same username and `sessionVersion` with a current RFC 6238 TOTP or an unused recovery code before the existing eight-hour JWT, HttpOnly session cookie, CSRF cookie, analytics event, audit event, and WebSocket freshness path are used.

Enrollment is authenticated, stores only an encrypted pending seed, and does not activate 2FA until confirmation. Confirmation atomically replaces the pending record with the encrypted active seed, stores only recovery-code hashes, increments `sessionVersion`, and returns recovery codes once. The seed and recovery material are never included in user-list or update responses.

The seed is encrypted with AES-256-GCM using a dedicated HKDF-SHA256 subkey derived from the existing `SERVER_MASTER_KEY` application-key boundary, with the stable info label `Root.ark/TOTP/seed-encryption/v1`; the raw master key is never passed to AES-GCM. The truthful unmerged-branch record format is version 2 with `keyDerivation: hkdf-sha256` and the recorded key-info label, plus username-bound AAD. TOTP-sensitive paths fail closed when that key is absent, malformed, or the record cannot be authenticated. JSON mode replaces the user file through a temporary file and rename; SQLite uses the existing transactional user repository.

Disable requires the current password and a current TOTP or unused recovery code. Administrative reset preserves the existing `manageUsers` authorization check: an unenrolled acting administrator must reauthenticate with the current password, while an enrolled acting administrator must provide that password plus a current TOTP or unused recovery code. Reset clears all target material, increments the target `sessionVersion`, and never returns old material. Both paths audit only the method/result and revoke the affected target session.

## Policy boundary

`TOTP_POLICY` accepts `optional` (default), `role-required`, or `global-required`. `TOTP_REQUIRED_ROLES` is a comma-separated role list and defaults to `admin` when role-required is selected. Existing users remain inactive by default; policy changes do not silently enroll or activate every account. A required but unenrolled login receives a 15-minute enrollment-only JWT and no full session. The middleware allows only the enrollment/status/policy/logout paths for that token and rejects it for HTTP application routes and realtime authentication.

`TOTP_CHALLENGE_TTL_MS` is bounded to 60 seconds–10 minutes, the per-challenge proof budget is five attempts, and `TOTP_CHALLENGE_MAX_ATTEMPTS` bounds IP and username attempts in a five-minute window. The same bounded verifier budget applies to login challenge, enrollment confirmation, disable, and administrative reset proof paths. Challenge records are cleaned on login/challenge activity and carry the original `sessionVersion`; password, role, permission, disable, reset, and deletion changes therefore continue to revoke stale sessions and realtime access.

The policy evaluator is shared by password login, HTTP authentication, and realtime authentication and reads the current policy on every check. A full token for a newly required but unenrolled user is denied on application routes and realtime; only the explicit enrollment, status, policy, and logout paths remain available. Optional mode, enrolled required users, disabled/deleted-user rejection, session-version checks, CSRF, and enrollment-only tokens remain unchanged. Sensitive enrollment, confirmation, challenge, and token responses set `Cache-Control: no-store` and `Pragma: no-cache`.

## Persistence and migration

Migration 5 adds `totp_enabled`, encrypted active/pending secret JSON, recovery hashes, last-used TOTP step, and enrollment timestamp to SQLite. The JSON user representation uses the same fields. Legacy users with absent fields resolve to disabled/no pending material. The focused SQLite test applies migrations 1–5 and round-trips the encrypted fields and hashes without exposing plaintext.

## Validation evidence

Final focused evidence recorded for this local verdict is 50 tests passing across RFC 6238 SHA-1 vectors, AES-GCM/AAD failure, CSPRNG recovery generation and one-way verification, pending confirmation, login challenge, single-use recovery, replay fencing, disable/reset revocation, admin reauthentication, global policy, missing-key failure, enrollment-only HTTP/realtime boundaries, CSRF preservation, SQLite migration/persistence, Phase 9 crypto vectors, and auth/session regressions. Syntax validation, artifact validation, lockfile/install consistency, `git diff --check`, and the targeted secret scan gates also passed. A bounded disposable HTTP integration flow covered primary login, the 2FA challenge, full session issuance, and CSRF rejection on a cookie-authenticated sensitive request.

The final hardening correction suite passed 43/43 focused tests, including optional/role/global policy cases, policy changes binding existing HTTP and realtime sessions, enrollment-only paths, HKDF domain separation and raw-key failure, AAD substitution, malformed/no-key failure, no key leakage, no-store headers, and generic error non-disclosure. Syntax validation passed again with 88 files checked.

The package-lock dependency audit remains non-clean because the starting branch contains the pre-existing high `brace-expansion` advisory; the separate dependency-hardening branch has the 5.0.9 repair. Browser automation, external providers, production deployment, remote CI for this SHA, and release/publication acceptance remain unvalidated.

## Residual handoffs

- Complete the remaining browser, provider, production, remote-CI, and release gates in their appropriate environments.
- Keep this local Phase 9/10 engineering verdict separate from remote issue state, draft PR state, production readiness, publication, and the future Phase 11 work.
