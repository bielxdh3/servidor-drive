# Root.ark

Root.ark is a private, administrator-controlled storage and file-transfer service under active development.

The repository currently contains a working Node.js application with authentication, permissions, uploads, file versions, public links, trash, quarantine, backup and restore, WebDAV, cloud-storage adapters, and a local synchronization client. The approved long-term direction includes client-side zero-knowledge encryption, but the current implementation predates that architecture and must not be treated as the final security model.

> **Status:** active development. Root.ark is not ready for unreviewed public deployment or production use.

## Main capabilities

- user, role, and permission management;
- file and folder upload, download, versioning, and sharing;
- trash, quarantine, and suspicious-file handling;
- SQLite persistence with backup and restore tooling;
- WebDAV and cloud-storage integration boundaries;
- local synchronization client;
- automated syntax, test, dependency, and artifact validation.

## Requirements

- Node.js 22 or newer;
- npm;
- a private, randomly generated `JWT_SECRET`;
- optional external services only for the integrations you enable.

## Local development

```bash
npm ci
```

Copy `.env.example` to a private `.env` file and replace every placeholder. Never commit the resulting file.

```bash
npm run db:migrate
npm start
```

The development server uses port `3000` unless `PORT` is configured.

## Validation

```bash
npm run validate
npm run validate:artifacts
```

The validation suite checks JavaScript syntax, automated tests, the lockfile-backed dependency audit, and repository contamination by runtime artifacts.

## Security

Keep Root.ark on a trusted private network unless the deployment has been explicitly reviewed and hardened. Do not expose local data directories, credentials, database files, backups, uploads, or environment files.

See [SECURITY.md](SECURITY.md) for responsible vulnerability reporting. Historical engineering records may describe past security work, but they are not deployment instructions or a guarantee that every environment is safe.

## Documentation

- [Development setup](docs/development-setup.md)
- [Product discovery](docs/product-discovery.md)
- [Plan tree](docs/plan-tree.md)
- [Backup and restore](BACKUP.md)
- [Synchronization](SYNC.md)

## Project direction

Root.ark remains an independent project. Any future integration or selective reuse with BielOS requires a separate approved architecture, security review, migration plan, and explicit authorization.