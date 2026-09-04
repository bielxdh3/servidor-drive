# Owner-approved feature backlog — 2026-09-03

This document records product decisions approved by the repository owner on 2026-09-03.

It is a planning record only. An item appearing here does **not** mean it is implemented, security-reviewed, validated, or released. Existing Root.ark security/architecture gates remain authoritative.

## Approved features

- [#63 — Advanced protected search / SQLite FTS5](https://github.com/bielxdh3/root.ark/issues/63)
- [#64 — Native Android app](https://github.com/bielxdh3/root.ark/issues/64)
- [#65 — Zero-Knowledge v1](https://github.com/bielxdh3/root.ark/issues/65)
- [#66 — Files On-Demand and Selective Sync](https://github.com/bielxdh3/root.ark/issues/66)
- [#67 — Ransomware Shield and protected recovery snapshots](https://github.com/bielxdh3/root.ark/issues/67)
- [#68 — Capability-based share links](https://github.com/bielxdh3/root.ark/issues/68)

## Architectural ordering

1. Zero-Knowledge v1 is the foundational trust-model work for protected content.
2. Protected Search must remain server-blind for protected plaintext/search material and fit the Zero-Knowledge v1 design.
3. Capability-based share links must preserve the selected zero-knowledge key and metadata boundaries.
4. Ransomware Shield must integrate with existing versioning/trash/retention and preserve recoverability without server plaintext inspection.
5. Files On-Demand/Selective Sync must preserve protected metadata/content rules across device-local placeholder/cache behavior.
6. Android must reuse the canonical Root.ark protocol, device authorization, recovery, and cryptographic model rather than creating a separate mobile trust model.

## Security truth

The current implementation predates the approved Zero-Knowledge direction. Do not describe Root.ark as zero-knowledge until #65 is implemented, reviewed, migrated, and validated with explicit security evidence.
