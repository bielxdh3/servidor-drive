# Phase 2.2 closure audit

Repository: `bielxdh3/root.ark`

Audited baseline: `9c6de34187163700015fe04a61880ca85e9600df`
Issue: #2 (remain open until this audit PR merges)

## Decision

Phase 2.2 is complete. The audit traced every session-affecting account condition to a persisted identity generation and to the HTTP and active-WebSocket enforcement boundaries. No alternate active-user create/reactivate write path bypasses the shared persistence flow. Issue #2 is ready for closure after this documentation-only PR merges.

`POST /users`, the shared `PUT /users/:username`, `DELETE /users/:username`, initialization, and JSON-to-SQLite migration all reach `saveUsers`. Password, role, permissions, and disabled state share the `PUT` route's `sessionChanged` decision, persisted `sessionVersion` increment, HTTP claim comparison, and active-WebSocket freshness comparison. Permission-removal integration coverage is representative for that shared path; separate regressions cover distinct deletion/recreation, JSON restart, SQLite repetition, and expiry boundaries.

| Mutation or condition | Entry route/function | Persistence path | Generation/revocation mechanism | HTTP enforcement bound | Active-WebSocket enforcement bound | Existing regression/source evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| First-ever user creation | `POST /users` | `saveUsers` to JSON or SQLite | Version `0` when no ledger/row exists | Next authenticated request loads current user | Upgrade and next authenticated activity compare current user | `server.js` create flow; valid controls in auth regressions | Covered |
| Password, role, permission, disabled change | `PUT /users/:username` | shared `saveUsers` | one `sessionChanged` increment of persisted `sessionVersion` | `createAuthenticate` reloads identity and compares claim | `refreshRealtimeUser` reloads identity and compares version | Permission-removal HTTP/WS regressions; shared-path source trace | Covered |
| User deletion while absent | `DELETE /users/:username` | JSON removes active record; SQLite soft-deletes row | no active identity; JSON retains prior generation before save | Current-user load fails | Current-user load fails and closes `1008 / Sessao revogada` | Delete/recreate HTTP/WS regression | Covered |
| JSON same-username recreation | `POST /users` | `user-generations.local.json` plus users JSON | persistent per-username maximum plus one | Old claim mismatches recreated identity | Old socket closes before next authenticated activity | Real JSON HTTP/WS regression | Covered |
| JSON restart persistence | startup and `POST /users` | Git-ignored JSON generation ledger, non-secret version metadata only | ledger survives restart and supplies next version | recreated old credential rejected | same shared realtime check | JSON restart regression; `.gitignore` excludes `data/*.json` | Covered |
| SQLite recreation and repetition | `POST /users` through repository upsert | retained `users` soft-deleted row | atomic upsert uses `MAX(users.session_version + 1, excluded.session_version)` | current row has greater version | same shared realtime check | SQLite repository regression proves `0` → `1` → `2` | Covered |
| Explicit version mismatch | HTTP middleware / realtime authenticator | current user from JSON or SQLite | mismatch rejects token | before protected handler | upgrade rejects; active socket closes on next authenticated activity | middleware source test for revoked user | Covered |
| JWT expiry | JWT verify / `refreshRealtimeUser` | verified JWT `exp` metadata | expiry is not a generation but is required session validity | before protected handler, `401` | closes `1008 / Sessao expirada` before next activity | HTTP and real-WebSocket expiry regressions | Covered |
| WebSocket upgrade and Origin | `/ws` connection | current user lookup | cookie-only JWT verification, current user/version, expected Origin | not applicable | before `connected` event | Origin helper and real-WebSocket tests | Covered |
| Logout | `POST /auth/logout` | browser cookies only | no global copied-JWT revocation without identity change | current browser loses cookies | no existing independent token is revoked merely by logout | auth route source trace | Documented residual, not an issue #2 blocker |

## Evidence reconciliation

- PRs #17, #19, #20, #21, #22, and #23 are merged. Their cited `Security Regression` runs `30603421268`, `30640683830`, `30645100846`, `30648076302`, `30648830873`, and `30650435892` completed successfully.
- `test/auth-security.test.js` covers browser storage/URL absence, disabled/version mismatch, permission-removal HTTP and realtime revocation, deletion/recreation HTTP and realtime revocation, JSON restart persistence, and HTTP/realtime expiry. `test/users-repository.test.js` covers repeated SQLite recreation.
- `src/middlewares/auth.js` reloads the active user and derives current permissions for each authenticated HTTP request. `server.js` rechecks active WebSocket expiry and current identity/version before authenticated messages and sends.
- The JSON ledger is Git-ignored and contains only username-to-generation metadata. SQLite keeps the prior generation in the soft-deleted row; it does not reset on recreation.

## Residual risks outside Phase 2.2

- The login JSON response still includes an unused token; same-origin XSS could read it.
- HttpOnly cookies do not stop same-origin XSS from issuing credentialed, CSRF-authorized requests.
- Real cross-origin CSRF integration coverage, HTTPS/proxy/Host/Origin deployment configuration, 2FA, and broader authorization-product design remain outside issue #2.

The exact next plan-tree item is Phase 2.3: **Add repeatable `test` and static-validation scripts** (issue #3).
