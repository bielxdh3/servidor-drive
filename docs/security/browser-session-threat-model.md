# Browser session threat model

## Scope and non-scope

This document covers Root.ark browser login/logout, the `rootark_session` HttpOnly cookie, CSRF handling, authenticated HTTP requests, `/auth/session.js` browser bootstrap, authenticated WebSocket upgrades, current-user/session-version revalidation, disabled or deleted users, and permission freshness. It excludes WebDAV Basic Auth, sync-client bearer authentication (a separate trust boundary), public-share routes, 2FA, password-reset design, and unrelated application features.

## Protected assets

- Session confidentiality and account identity.
- Current authorization state and administrative privileges.
- Integrity of cookie-authenticated state changes and realtime events.
- User files and metadata reachable through authenticated routes.

## Actors and attacker capabilities

- A normal user or administrator holds a browser session.
- An unauthenticated remote attacker can submit login requests and send cross-site requests from a malicious website.
- An attacker with JavaScript execution in the Root.ark origin can read non-HttpOnly browser state and issue same-origin requests.
- An attacker may possess a stolen session cookie or separate bearer credential.
- A reverse proxy or deployment can misstate protocol, Host, or forwarded headers.

## Trust boundaries and data flows

1. `POST /auth/login` checks the current enabled user and password, signs an eight-hour JWT containing username and `sessionVersion`, sets `rootark_session` as HttpOnly/Lax (Secure in production), and sets a readable `rootark_csrf` token. The shipped login page redirects after success and does not persist the JSON response, although that response currently includes a token.
2. `createAuthenticate` verifies a bearer token or session cookie, then loads the current non-deleted user from the repository, rejects disabled users and mismatched session versions, and derives role and permissions from that current user. Cookie-authenticated non-safe requests additionally require a matching CSRF cookie/header and, when present, a matching Origin.
3. `/auth/session.js` is authenticated, no-store JavaScript that exports only current username, role, and permissions after escaping `<`. Browser pages load it before `auth-bootstrap.js`; bootstrap sends same-origin credentials, adds the CSRF header to state-changing fetches, and strips `Authorization` headers.
4. `POST /auth/logout` is authenticated and clears both cookies. User updates increment `sessionVersion` when password, role, permissions, or disabled state changes; deleted users are absent from `loadUsers()`.
5. A `/ws` upgrade obtains `rootark_session` only from cookies, requires `Origin` to equal the expected request origin, then verifies the token and current user/session version before attaching `socket.user`. No bearer credential is used in the WebSocket URL.

## Security invariants and assumptions

- Shipped browser pages must not store session credentials in browser storage or place them in URLs. The login response token must likewise not be retained or sent by browser code.
- Cookie-authenticated state-changing HTTP requests require matching CSRF evidence; bearer authentication is a separate API-client boundary.
- Each authenticated HTTP request resolves the current server-side user, so disabled, deleted, and session-revoked users fail on their next request. WebSocket authentication has the same check at upgrade time.
- Server-side permissions, not `ROOTARK_AUTH` UI state, decide authorization. Permission changes should take effect on the next authenticated request and be covered by a focused test; an already-upgraded WebSocket has no documented revalidation bound.
- WebSocket upgrades must validate the expected Origin and current session before any protected realtime event is sent.
- `JWT_SECRET`, session cookies, CSRF values, and credentials must not be logged or tracked. `JWT_SECRET` must remain protected and at least 32 characters.
- Production relies on HTTPS termination and correct `NODE_ENV=production` for Secure cookies. Because the server enables `trust proxy`, the deployment must accept forwarded headers only from trusted proxies and preserve the intended Host and Origin. Browser same-origin behavior and server/database availability are also assumed.

## Residual risks and validation gaps

- The login JSON response still contains a token even though browser pages do not persist it; same-origin JavaScript could read that response.
- HttpOnly prevents direct cookie reads but does not prevent same-origin XSS from sending CSRF-authorized actions with the readable CSRF token.
- Focused HTTP regression tests prove that removing `manageUsers` through `PUT /users/:username` increments `sessionVersion`, and that an expired `rootark_session` JWT is rejected with `401` by `GET /storage/status` before protected behavior runs. The command is `node --test test/auth-security.test.js`; other session-version mutation paths still lack focused coverage.
- HTTP revalidation is tested for disabled and session-version-mismatched users; active WebSocket revocation/permission freshness after upgrade is not established here.
- HTTPS, proxy-header, Host, Origin, or `JWT_SECRET` deployment mistakes can weaken the model. 2FA remains outside this issue #2 scope.

## Validation matrix

| Invariant | Existing evidence | Missing evidence | Smallest next test |
| --- | --- | --- | --- |
| Cookie state changes need CSRF | `test/auth-security.test.js` checks missing/matching CSRF | Cross-origin rejection through the real route | Submit one cookie-authenticated write with a foreign Origin |
| Current users revoke stale HTTP sessions | Focused tests reject disabled/version-mismatched users, an old browser cookie after `manageUsers` removal, and an expired browser cookie with `401` from `GET /storage/status` | Other mutation paths | Change another session-affecting field, then call its protected HTTP route with the old cookie |
| Browser pages avoid persisted credentials and WS URL tokens | Focused source test covers browser pages | Login-response token exposure is not tested | Assert the login response omits the unused token before changing behavior |
| WebSocket upgrade uses current cookie session and Origin | Origin helper test and recorded browser/WebSocket validation | Expiry, revocation, and active-connection behavior | Open a socket, revoke its session, then verify the required post-revocation behavior |
| Bootstrap identity is safe UI state only | `/auth/session.js` escapes `<`; server authorization reloads user | Permission freshness across page bootstrap | Change permission and reload the protected page/request |

Repository: bielxdh3/root.ark
Version: c0ab7c497918b48ea6f5c01964e196c7157c18a1
