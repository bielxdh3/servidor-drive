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
- Current automated Node tests, including disposable real-server simple-upload coverage for authorization-before-Multer, suspicious-extension quarantine, filename/path containment, file-trash lifecycle safety, and JSON-mode backup/restore isolation. Backup regressions additionally reject checksum failures, traversal and absolute paths, disallowed or sensitive entries, Unix symlink metadata, invalid or duplicate manifests, and normalized destination collisions without extraction or runtime side effects. A disposable SQLite test proves the configured database path is archived and restored without changing `db.ROOT_DIR` or default database semantics.
- Locked production and development dependency audit at high severity.
- Disposable test data only.

## Environment-dependent validation

This baseline does not automatically validate live ClamAV, S3, Google Drive, Windows WebDAV mounting, browser-driven flows, long-running migration, cloud backup storage, scheduler behavior, retention under time/count pressure, full production SQLite recovery, folder-trash, empty-trash, automatic cleanup, cloud trash deletion, chunked-upload, or synchronization exercises. The simple `POST /upload` multipart boundary is covered with a disabled scan provider while retaining the extension block; production HTTPS, reverse-proxy, Host, and Origin configuration also requires a real deployment environment. Those checks require disposable data and the relevant real prerequisites.

## Data safety

The default command and CI do not upload or retain databases, backups, quarantine contents, credentials, JWTs, cookies, user files, or generated runtime ledgers. This baseline is not evidence that every Root.ark feature is validated.
