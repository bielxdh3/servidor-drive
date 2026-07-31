# Local development setup

Root.ark requires `JWT_SECRET` in the process environment. `.env.example` is only a template: the application does not load `.env` automatically, and local secrets must never be committed.

Generate a fresh secret and start the application:

```powershell
$env:JWT_SECRET = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

```sh
JWT_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')" npm start
```

Set `PORT` separately if a port other than the default is needed.
