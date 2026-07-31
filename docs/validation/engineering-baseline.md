# Engineering validation baseline

## Clean checkout

```text
npm ci
npm run validate
```

## Individual commands

- `npm run validate:syntax` uses Git's tracked-plus-unignored inventory to run `node --check` on every first-party JavaScript file. Explicit file arguments are checked only when supplied, and missing files or directories fail.
- `npm test` runs the current Node test suite using disposable fixtures.
- `npm run validate:dependencies` performs the locked dependency audit at high severity.
- `npm run validate` runs syntax validation, tests, and the locked dependency audit in that order. CI keeps those commands in separate steps so failures remain easy to identify.

## Included

- First-party JavaScript syntax.
- Current automated Node tests, including disposable real-server simple-upload coverage for authorization-before-Multer, suspicious-extension quarantine, filename/path containment, and trash runtime-root isolation. The trash regression confirms that a child server writes JSON metadata and physical trash files under its active working directory, not its module checkout.
- Locked production and development dependency audit at high severity.
- Disposable test data only.

## Environment-dependent validation

This baseline does not automatically validate live ClamAV, S3, Google Drive, Windows WebDAV mounting, browser-driven flows, or long-running migration, backup/restore, full trash lifecycle authorization/containment, chunked-upload, and synchronization exercises. The simple `POST /upload` multipart boundary is covered with a disabled scan provider while retaining the extension block; production HTTPS, reverse-proxy, Host, and Origin configuration also requires a real deployment environment. Those checks require disposable data and the relevant real prerequisites. Backup/restore runtime-root behavior is not changed or claimed by the trash regression.

## Data safety

The default command and CI do not upload or retain databases, backups, quarantine contents, credentials, JWTs, cookies, user files, or generated runtime ledgers. This baseline is not evidence that every Root.ark feature is validated.
