# Issue #1 acceptance evidence

Status: acceptance evidence complete as of 2026-07-30; issue #1 remains open pending explicit user authorization to close it.

## Startup acceptance harness

Run `node --test test/startup-acceptance.test.js`.

The reusable harness starts the real `server.js` in isolated temporary directories and disposable dynamic ports. It verifies that a missing `JWT_SECRET` and an explicit weak placeholder both exit non-zero with the sanitized configuration error, while a generated strong secret serves `GET /login.html` with `200` before clean termination. The harness removes every temporary directory and terminates every child process on both success and failure; it uses no real secret or user data.

For isolated startup, the data directory is the temporary child working directory (`data`, `uploads`, and `temp` are created there); `DATABASE_URL` is supported only for SQLite when `DB_ENABLED=true`. The server port is supplied through `PORT`.

## Playwright analytics-to-dashboard XSS proof

The disposable end-to-end browser proof is complete for application SHA `7b270f91810e8e0d86e5998086e3d04ba1178744` (PR #18, workflow run `30599233724`, `1 passed (3.5s)`). It logged in through `POST /auth/login`, persisted the exact harmless payload in `data/analytics.json`, confirmed the exact payload returned from `/analytics/recent`, and verified literal `.event-text` rendering without a malicious element or `onerror` execution.

Current HEAD `666fcbe5aee30710b20a01e13b1a24c8c6313206` adds only the permanent CI workflow; no runtime code changed after the Playwright-tested application SHA.

## Issue state

Issue #1 remains open only because closing it requires explicit user authorization.

## Adjacent-surface source review

Reviewed `public/dashboard.html`:

- Recent activity creates elements and assigns user-controlled event values with `textContent`.
- Dashboard load errors are assigned with `textContent`.
- `renderCard` uses `innerHTML` only with computed numeric values and constant labels.

## Session decision

Browser authentication uses HttpOnly cookies with `SameSite=Lax` and CSRF checks for cookie-authenticated writes. The remaining issue #2 work is its documented browser-session threat model.
