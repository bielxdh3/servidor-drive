# Security Policy

## Project status

Root.ark is under active development and is not presented as production-ready. Security depends on deployment configuration, network exposure, enabled integrations, operating-system controls, and the exact revision being used.

## Reporting a vulnerability

Do not publish exploit details, credentials, private paths, personal data, or reproduction artifacts in a public issue or pull request.

Use GitHub's private vulnerability-reporting or Security Advisory flow for this repository when available. Otherwise contact the maintainer privately through the GitHub profile before disclosing technical details.

Include only the information needed to reproduce and assess the issue:

- affected revision or commit;
- affected component;
- impact and required preconditions;
- minimal reproduction steps using disposable data;
- suggested remediation, when known.

Never test against real user data, live credentials, third-party accounts, or systems you do not own or have explicit permission to assess.

## Secrets and private data

Real secrets must never be committed. Local `.env` files, databases, keys, credentials, backups, uploads, synchronization state, and generated runtime data are excluded from Git and must remain private.

If a real credential is ever committed, removing it from the latest revision is not enough. Revoke or rotate it immediately and assess whether repository history must be rewritten.