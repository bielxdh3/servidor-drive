# Root.ark Product Discovery

Status: discovery open

Related issues: #4 and #10

## Purpose

This document records explicit product decisions before they become implementation tasks. Root.ark previously evolved through spontaneous feature requests sent directly to an executor. That produced useful capabilities, but no stable product contract, trust model, or ordered roadmap.

Future discovery should work like the AIP planning process: ask a small number of concrete questions per round, record exact answers and consequences, and implement only after the decision is approved and added to `docs/plan-tree.md`.

## Decision status labels

- `[DECIDED]`: explicitly approved by the product owner.
- `[PROVISIONAL]`: current assumption, not yet approved as permanent.
- `[OPEN]`: unresolved and requires a concrete answer.
- `[REJECTED]`: explicitly not wanted.
- `[DEFERRED]`: valid question intentionally postponed.
- `[CONFLICT]`: existing code or older plans disagree and require reconciliation.

## Rules

1. Do not infer product decisions from existing code alone.
2. Do not treat an old chat idea as approved merely because it was discussed.
3. Record the exact answer, date, consequences, and affected plan-tree items.
4. Ask at most a small number of high-value questions per round.
5. Prefer concrete choices and scenarios over abstract preference questions.
6. Do not implement while a material trust, data, recovery, or identity decision remains open.
7. When an answer changes, preserve the superseded decision and explain the migration consequence.
8. Product discovery may run in parallel with bounded stabilization, but it must not interrupt critical security work.

## Current known facts

- `[PROVISIONAL]` A working Node.js/Express file-management product exists in `bielxdh3/root.ark`.
- `[PROVISIONAL]` The existing application supports users, permissions, folders, uploads, approval, versions, public links, encryption, analytics, audit, SQLite, backups, trash, scanning/quarantine, WebDAV, cloud storage, and a one-way sync MVP.
- `[CONFLICT]` Root.ark has also been discussed as a future BielOS module with potentially different security and encryption requirements.
- `[OPEN]` It is not yet decided whether the current repository is the final independent product, a prototype, or a source for a future migration.
- `[OPEN]` The final product name and spelling are not confirmed.
- `[OPEN]` The current feature set does not itself define what the final product should promise.

## Decision record format

Use this template for every approved decision:

```md
### D-XXX: Decision title

- Status: `[DECIDED]`
- Date: YYYY-MM-DD
- Decision: <exact approved behavior>
- Reason: <why>
- Consequences:
  - <security/architecture consequence>
  - <data/migration consequence>
  - <UX/operations consequence>
- Rejected alternatives:
  - <alternative and reason>
- Affected plan-tree phases:
  - <phase>
- Required follow-up issues:
  - #<issue>
```

## Discovery sequence

The orchestrator should normally follow this order because later answers depend on earlier trust and user decisions.

## Round 1: Product identity and relationship

### Q1. Canonical product

- Status: `[OPEN]`
- Question: Is this repository the final independent Root.ark product, a legacy prototype, or a code source for a future BielOS module?
- Why it matters:
  - determines canonical repository and roadmap;
  - prevents accidental merging of incompatible trust models;
  - determines whether stabilization is an end state or migration preparation.

Concrete answer options:

1. Keep this repository as an independent product.
2. Treat it as a legacy prototype and design a separate BielOS module.
3. Keep both, with independent purposes and no shared runtime.
4. Plan a controlled migration/reuse after a dedicated architecture phase.
5. Another explicitly described relationship.

### Q2. Final name

- Status: `[OPEN]`
- Question: What is the exact canonical spelling and capitalization?
- Existing variants:
  - `Root.ark`
  - `root.ark`
  - `root.arc`
  - another name
- Consequences:
  - repository naming;
  - UI branding;
  - domains and documentation;
  - migration/compatibility labels;
  - package and executable names.

### Q3. Intended audience

- Status: `[OPEN]`
- Question: Who is expected to use the final product?

Concrete models:

1. Biel only.
2. Biel plus explicitly invited family/partner/team.
3. Private self-hosted product for technical users.
4. Public hosted SaaS with customer accounts.
5. Public sharing surface with private administrator-created compartments.
6. Another bounded audience.

The answer determines registration, invitations, abuse handling, support, tenant isolation, and legal/privacy obligations.

## Round 2: Trust and administrator powers

### Q4. Can the server administrator read files?

- Status: `[OPEN]`
- Question: Under the intended security model, can the administrator/server decrypt and inspect user files?

Concrete models:

1. Yes, normal server-managed encryption and access controls.
2. No, zero-knowledge/client-side encryption for all user content.
3. Mixed: some compartments are zero-knowledge and some are server-readable.
4. Personal-only deployment where this distinction is intentionally less strict.

This decision must be made before redesigning encryption, recovery, previews, scanning, search, WebDAV, or sharing.

### Q5. Administrator authority

- Status: `[OPEN]`
- Question: Which actions may an administrator perform?

Decide separately:

- create/disable/delete accounts;
- reset passwords;
- reset or revoke encryption access;
- view filenames and metadata;
- read file contents;
- restore backups;
- release quarantined files;
- view audit logs and analytics;
- impersonate users;
- transfer ownership;
- permanently delete data.

Avoid a vague `admin can do everything` rule. Every power has recovery and abuse consequences.

### Q6. Lost password or key

- Status: `[OPEN]`
- Question: What should happen when a user loses a password, second factor, recovery code, or encryption key?

Possible policies:

- administrator resets access and files remain readable;
- account access resets but zero-knowledge files remain unrecoverable;
- designated recovery key/person;
- recovery package exported by the user;
- no recovery by design;
- mixed policy by compartment.

## Round 3: Accounts, identity, and sessions

### Q7. Account creation

- Status: `[OPEN]`
- Question: Who may create accounts?

Models:

- administrator only;
- invitation only;
- public registration with verification;
- no accounts, only compartments/share links;
- external identity provider;
- shared identity with BielOS after a dedicated integration phase.

### Q8. Authentication requirements

- Status: `[OPEN]`
- Decide:
  - username versus email;
  - password requirements;
  - 2FA scope: administrator only, optional, or mandatory;
  - session duration;
  - device/session list and revocation;
  - trusted devices;
  - passwordless or external identity later;
  - recovery and lockout policy.

### Q9. Identity relationship with BielOS

- Status: `[OPEN]`
- Question: If Root.ark and BielOS coexist, should authentication be independent, federated, or shared?
- Rule: no direct integration until issue #10 is resolved and a dedicated threat model exists.

## Round 4: Storage and encryption

### Q10. Canonical storage

- Status: `[OPEN]`
- Choose the source of truth:
  - local disk;
  - S3-compatible storage;
  - Google Drive;
  - hybrid local cache plus cloud authority;
  - user-selected backend;
  - encrypted blobs in one backend with replicated backup.

Clarify whether changing providers is migration, replication, or live multi-backend operation.

### Q11. Encryption levels

- Status: `[OPEN]`
- Decide whether the current multiple encryption modes remain product behavior or are simplified.
- Required consequences:
  - preview/search support;
  - backup/restore;
  - key rotation;
  - sharing;
  - WebDAV;
  - scanning;
  - synchronization;
  - recovery.

### Q12. Metadata privacy

- Status: `[OPEN]`
- Decide whether the server may see:
  - filenames;
  - folder names;
  - sizes;
  - MIME/extensions;
  - timestamps;
  - owners/recipients;
  - activity;
  - search index;
  - thumbnail/preview data.

Zero-knowledge content does not automatically mean zero-knowledge metadata.

## Round 5: File lifecycle

### Q13. Upload approval

- Status: `[OPEN]`
- Question: Why does upload approval exist in the final product?

Possible purposes:

- administrator moderation;
- protection for shared/inbox folders;
- all uploads require approval;
- only external uploads require approval;
- legacy behavior to remove.

### Q14. Versions

- Status: `[OPEN]`
- Decide:
  - automatic versions versus overwrite;
  - maximum count or age;
  - user/admin deletion rights;
  - encrypted-version handling;
  - backup and storage billing consequences.

### Q15. Trash and permanent deletion

- Status: `[OPEN]`
- Decide:
  - default retention period;
  - who can restore;
  - who can permanently delete;
  - whether backup copies survive deletion;
  - legal/operational meaning of `permanent`;
  - zero-knowledge key deletion as cryptographic erasure.

### Q16. Backup and restore promise

- Status: `[OPEN]`
- Decide:
  - what is backed up;
  - schedule and retention;
  - off-device copies;
  - encrypted key handling;
  - restoration authority;
  - recovery point and recovery time expectations;
  - how restore is tested.

## Round 6: Sharing and external access

### Q17. Share recipients

- Status: `[OPEN]`
- Choose supported models:
  - authenticated internal users;
  - public bearer links;
  - password-protected links;
  - recipient email/identity binding;
  - one-time links;
  - upload-only inbox links;
  - zero-knowledge recipient encryption.

### Q18. Share controls

- Status: `[OPEN]`
- Decide:
  - expiration;
  - view/download limits;
  - revocation;
  - preview versus download;
  - watermarking;
  - audit visibility;
  - whether public links survive file moves/restores;
  - whether recipients can redistribute access.

## Round 7: Clients and protocols

### Q19. Synchronization

- Status: `[OPEN]`
- Decide:
  - upload-only versus bidirectional;
  - deletion synchronization;
  - rename/move synchronization;
  - conflicts;
  - offline edits;
  - selective folders;
  - background startup/service;
  - maximum file size;
  - encryption location;
  - multi-device state.

### Q20. WebDAV

- Status: `[OPEN]`
- Decide whether WebDAV is:
  - a supported core interface;
  - an optional advanced feature;
  - local/private only;
  - deprecated in favor of a sync client.

Clarify MOVE, DELETE, locking, encrypted files, nested folders, and client compatibility.

### Q21. Web, PWA, desktop, and mobile

- Status: `[OPEN]`
- Decide required clients and their priority.
- Do not build every client because it sounds complete. Each client creates authentication, offline, update, storage, and security obligations.

## Round 8: Privacy, audit, analytics, and operations

### Q22. Audit visibility

- Status: `[OPEN]`
- Decide who sees which events and how long they are retained.
- Separate security audit from product analytics.
- Decide export, deletion, IP/user-agent treatment, and privacy limits.

### Q23. Product analytics

- Status: `[OPEN]`
- Decide whether analytics are needed for a personal/private product.
- If retained, define minimum necessary metrics and whether users can see or disable them.

### Q24. Deployment and ownership

- Status: `[OPEN]`
- Decide:
  - personal machine, home server, VPS, managed service, or BielOS host;
  - operating system support;
  - domain and reverse proxy;
  - TLS and remote access;
  - updates and rollback;
  - monitoring;
  - storage capacity alerts;
  - disaster recovery responsibility.

## Round 9: Scope boundaries

### Q25. Explicitly rejected features

- Status: `[OPEN]`
- Record features that should not be built, even if technically possible.
- Examples to decide rather than assume:
  - public registration;
  - social feed;
  - collaborative document editing;
  - arbitrary server shell;
  - broad file execution;
  - public anonymous upload;
  - permanent admin impersonation;
  - third-party tracking;
  - cryptocurrency/storage marketplace nonsense, because apparently every product is eventually threatened by this idea.

### Q26. Success criteria

- Status: `[OPEN]`
- Question: What observable state would make the product successful for its intended users?
- Define a small set of product outcomes, reliability targets, and safety guarantees.

## How answers become work

After a discovery answer:

1. create/update a decision record;
2. identify affected existing behavior;
3. identify migration/data consequences;
4. identify security/architecture work;
5. update only relevant plan-tree sections;
6. create one or more scoped GitHub issues;
7. keep implementation blocked until dependencies and acceptance criteria are explicit;
8. give Codex one coherent issue step, not the entire product brief.

## Current discovery queue

Recommended first conversation round:

1. Is this repository independent, legacy, or intended to migrate into/alongside BielOS?
2. Who are the intended users?
3. Can the administrator/server read user files?

These three answers determine most later architecture. Do not ask all remaining questions at once. Humans respond poorly to 26-question forms, despite repeatedly inventing them for everyone else.
