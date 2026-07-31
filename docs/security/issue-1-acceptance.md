# Issue #1 acceptance evidence

Status: incomplete as of 2026-07-30.

## Startup acceptance harness

Run `node --test test/startup-acceptance.test.js`.

The reusable harness starts the real `server.js` in isolated temporary directories and disposable dynamic ports. It verifies that a missing `JWT_SECRET` and an explicit weak placeholder both exit non-zero with the sanitized configuration error, while a generated strong secret serves `GET /login.html` with `200` before clean termination. The harness removes every temporary directory and terminates every child process on both success and failure; it uses no real secret or user data.

For isolated startup, the data directory is the temporary child working directory (`data`, `uploads`, and `temp` are created there); `DATABASE_URL` is supported only for SQLite when `DB_ENABLED=true`. The server port is supplied through `PORT`.

## Remaining blocker

The required disposable, end-to-end browser proof has not yet injected the harmless payload through the actual analytics persistence path and asserted literal dashboard rendering. Do not close issue #1 until that record exists.

## Adjacent-surface source review

Reviewed `public/dashboard.html`:

- Recent activity creates elements and assigns user-controlled event values with `textContent`.
- Dashboard load errors are assigned with `textContent`.
- `renderCard` uses `innerHTML` only with computed numeric values and constant labels.

## Session decision

Browser authentication uses HttpOnly cookies with `SameSite=Lax` and CSRF checks for cookie-authenticated writes. The remaining issue #2 work is its documented browser-session threat model.
