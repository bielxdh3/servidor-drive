# Root.ark Product Discovery

Status: discovery open; Round 1 and Round 2 decisions recorded

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
- `[DECIDED]` D-001 keeps Root.ark active in this repository while allowing only a future, explicitly designed and approved migration or selective reuse with BielOS.
- `[DECIDED]` D-002 defines Root.ark as a private administrator-controlled storage and transfer service with rigorously isolated compartments and no normal public registration.
- `[DECIDED]` D-003 selects client-side, zero-knowledge encryption; the server and administrator must not normally read plaintext user content.
- `[DECIDED]` D-004 permits bounded, least-privilege administrator operations and auditable support access while keeping content and unnecessary metadata hidden.
- `[DECIDED]` D-005 defines administrator-controlled accounts, revocable invitations, user-controlled recovery, and audited deletion with default retention.
- `[DECIDED]` D-006 defines client-side key lifecycle, compartment-isolated keys, trusted-device recovery, rotation for future content, and authorized offline access.
- `[CONFLICT]` Existing server-readable, metadata-dependent, preview, scanning, WebDAV, sync, and backup behaviors require reconciliation with D-003; implementation is not itself product approval.
- `[OPEN]` The final product name and spelling are not confirmed.
- `[OPEN]` Exact integration contracts, cryptographic protocols, key envelopes, recovery-package format, retention periods, and client behavior remain unresolved.

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

## Approved Round 1 decisions

The product owner approved these records on 2026-08-02. They are durable product decisions; unresolved implementation and architecture details remain open.

### D-001: Root.ark and BielOS relationship

- Status: `[DECIDED]`
- Date: 2026-08-02
- Decision: Option D. Root.ark remains actively developed in this repository. The long-term possibility is a controlled migration or selective reuse into BielOS after a dedicated architecture, security, and contract-definition phase. Root.ark runtime, data, and authentication remain isolated until an integration is explicitly designed and approved.
- Reason: BielOS may centralize accounts in the future, but integration must not happen automatically.
- Consequences:
  - Analysis: The current canonical runtime and data boundary remains this repository.
  - Analysis: Future identity sharing requires an explicit integration contract, threat model, and migration plan.
  - Analysis: Existing stabilization work remains valid without making this repository a legacy product.
- Explicitly prohibited automatic actions:
  - Copying or merging code with BielOS.
  - Sharing databases, sessions, or authentication.
  - Migrating user files.
  - Changing the encryption model.
  - Reclassifying this repository as legacy.
- Rejected alternatives:
  - Options A, B, and C were not selected for the current direction; they are not recorded as permanently impossible future states.
- Affected plan-tree phases:
  - Phase 5.0: Product identity and repository relationship.
  - Phase 5.4: Approved product brief.
- Required follow-up issues:
  - #10 remains open until the decision is reconciled in merged documentation and all required consequences are satisfied.
  - #4 remains open for the rest of product discovery.

### D-002: Intended users and tenancy

- Status: `[DECIDED]`
- Date: 2026-08-02
- Decision: Option E with owner-specific bounds. Root.ark is a private storage and transfer service administered by BielOS or an authorized administrator. The administrator creates or approves accounts, compartments, and access. Public requests such as `/apply` may exist as isolated requests but never grant access automatically. Unrelated users may coexist only in rigorously isolated compartments. External recipients may use links or access keys without becoming normal system users.
- Reason: Unrelated users must not see one another's data, names, metadata, or activity.
- Consequences:
  - Analysis: Account, compartment, permission, and activity isolation are tenant-boundary requirements.
  - Analysis: External links and keys require a separate access principal and revocation model from ordinary accounts.
  - Analysis: Public registration, abuse handling, and support remain bounded private-service concerns rather than SaaS defaults.
- Explicitly prohibited automatic actions:
  - Normal public registration.
  - Automatic access from a public application request.
  - Cross-compartment visibility of data, names, metadata, or activity.
- Rejected alternatives:
  - Public hosted SaaS registration is not the selected audience model.
  - Other public sharing surfaces remain possible only when separately designed and approved.
- Affected plan-tree phases:
  - Phase 5.1: Users and trust model.
  - Phase 5.2: File and storage behavior.
- Required follow-up issues:
  - #4 remains open for account, invitation, sharing, and scope-boundary discovery.

### D-003: Server, administrator, and metadata visibility

- Status: `[DECIDED]`
- Date: 2026-08-02
- Decision: Option B. User content uses client-side, zero-knowledge encryption. The server and administrator must not normally decrypt or read plaintext content. Filenames and folder names should preferably be encrypted; only the minimum operational metadata may remain visible. Previews and search indexes should be client-generated or unavailable for zero-knowledge files. Upload scanning should occur before client encryption when possible. Administrators may back up and restore encrypted blobs and required metadata, manage accounts, compartments, permissions, blocks, backups, and deletion, but may not silently access decrypted content.
- Reason: The server and administrator must not be able to read user content normally, and lost encryption keys may make files unrecoverable.
- Consequences:
  - Analysis: Key generation, storage, rotation, revocation, sharing, and recovery become client-side or user-controlled security boundaries.
  - Analysis: Server-side previews, full-text search, and decryption-based scanning cannot be assumed for zero-knowledge files.
  - Analysis: Backup and restore preserve encrypted material without creating an administrator plaintext-recovery path.
- Explicitly prohibited automatic actions:
  - Server decryption for ordinary administrator inspection.
  - Automatic recovery of encrypted files after key loss.
  - Treating password reset as encryption-key recovery.
- Rejected alternatives:
  - Normal server-readable encryption is not the selected final trust model.
  - A mixed model was not approved in this round, although future compartment-specific exceptions were not permanently ruled out.
- Affected plan-tree phases:
  - Phase 5.1: Users and trust model.
  - Phase 5.2: File and storage behavior.
  - Phase 5.3: Privacy and operations.
- Required follow-up issues:
  - #4 remains open for the exact metadata, key-recovery, sharing, scanning, preview, search, and client requirements.
  - #10 remains open until the BielOS relationship and its trust-model consequences are reconciled after documentation merge.

## Approved Round 2 decisions

The product owner approved these records on 2026-08-02. They define policy boundaries only; all deferred architecture and implementation details remain explicitly open.

### D-004: Administrator authority and metadata visibility

- Status: `[DECIDED]`
- Date: 2026-08-02
- Decision: Administrators may create, invite, approve, disable, and delete accounts; create and manage isolated compartments; grant and revoke permissions; revoke sessions and access links; manage quotas, operational blocks, quarantine decisions, backup jobs, restores of encrypted material, retention, and permanent deletion; and view security and operational audit events required to administer the service. Support impersonation is never silent: it requires explicit user authorization, limited duration, and complete audit logging. Filenames and folder names remain encrypted and invisible to administrators whenever technically possible. MIME and extensions derived from content remain hidden, except for strictly necessary operational categories. Audit logs may identify the acting user, IP, device, time, and action, but must not contain content, keys, decrypted names, or unnecessary sensitive data.
- Reason: No separate reason was supplied; the owner approved least-privilege administration, explicit support access, and minimization of content-derived metadata.
- Consequences:
  - Analysis: Support impersonation requires a consent, expiry, authorization, and audit workflow.
  - Analysis: Logs become a protected personal-data surface with separate retention and access requirements.
  - Analysis: Operational features must use opaque identifiers and minimum metadata where possible.
- Explicitly prohibited automatic actions:
  - Silent user impersonation.
  - Plaintext content access or reconstruction of encryption keys.
  - Password reset as content-key recovery.
  - Bypassing compartment boundaries.
  - Server-generated plaintext previews or search indexes.
- Rejected alternatives:
  - Silent support impersonation and indiscriminate administrator visibility of names, MIME details, or content-derived metadata.
- Deferred details that remain `[OPEN]`:
  - Consent and maximum duration for support impersonation.
  - Audit retention, access, export, and deletion rules.
  - Exact operational MIME categories and metadata inventory.
- Affected plan-tree phases:
  - Phase 5.1: Users and trust model.
  - Phase 5.3: Privacy and operations.
- Required follow-up issues:
  - #4 remains open for the exact authority, metadata, and audit requirements.
  - #10 remains open; D-004 does not resolve the BielOS integration gate.

### D-005: Accounts, invitations, and recovery

- Status: `[DECIDED]`
- Date: 2026-08-02
- Decision: Administrators may create accounts directly or issue revocable, expiring invitations. No normal public registration exists, and an `/apply` request never grants access automatically. Username is sufficient; email is optional for notifications and recovery. A user-controlled recovery package is mandatory during encryption setup, with a clear warning that losing all recovery methods may make files unrecoverable. Trusted devices and, optionally, a person or device explicitly chosen by the user may participate in recovery. No universal administrator decryption key exists. Account deletion revokes access immediately, while permanent deletion follows a default retention period; immediate permanent deletion requires explicit administrative action, reinforced confirmation, and audit.
- Reason: No separate reason was supplied; the owner explicitly requires clear warning of unrecoverability when all recovery methods are lost.
- Consequences:
  - Analysis: Login recovery and content-key recovery are separate operations.
  - Analysis: Invitation and application flows require revocation, expiry, non-automatic access, and audit boundaries.
  - Analysis: Account deletion must distinguish immediate access revocation from later data destruction.
- Explicitly prohibited automatic actions:
  - Public account registration.
  - Automatic access from an application request.
  - A universal administrator recovery key.
  - Password reset that silently decrypts zero-knowledge content.
  - Immediate permanent deletion without reinforced confirmation and audit.
- Rejected alternatives:
  - Mandatory email identity, administrator-only recovery of encrypted content, and unconfirmed immediate deletion.
- Deferred details that remain `[OPEN]`:
  - Invitation token format and exact expiry.
  - Recovery-package structure and storage.
  - Rules for a trusted recovery person or device.
  - Default retention duration and restoration during retention.
- Affected plan-tree phases:
  - Phase 5.1: Users and trust model.
  - Phase 5.3: Privacy and operations.
- Required follow-up issues:
  - #4 remains open for authentication, invitation, recovery, retention, and deletion details.
  - #10 remains open; D-005 does not authorize shared BielOS identity or recovery.

### D-006: Client-side key lifecycle and device access

- Status: `[DECIDED]`
- Date: 2026-08-02
- Decision: Encryption keys are generated client-side. A trusted device may approve a new device, and a valid recovery package may authorize one without an existing device. Each compartment has its own key or isolated key set. When a user or device loses access, keys rotate for new content; content already downloaded or previously decrypted cannot be revoked retroactively. Authorized devices must support offline access, storing only indispensable cryptographic material protected by the operating system and local authentication.
- Reason: No separate reason was supplied; the owner explicitly requires compartment isolation and authorized offline access.
- Consequences:
  - Analysis: Key hierarchy and authorization must be isolated per compartment.
  - Analysis: Device authorization, removal, and rotation must be auditable and affect future content without claiming retroactive revocation.
  - Analysis: Offline clients create a local key-material and device-security boundary.
- Explicitly prohibited automatic actions:
  - Reusing one key across compartments.
  - Storing unnecessary local key material.
  - Claiming that previously downloaded ciphertext or plaintext can be revoked retroactively.
  - Creating a universal administrator key.
- Rejected alternatives:
  - No-offline-access as the default and a shared key model across compartments.
- Deferred details that remain `[OPEN]`:
  - Cryptographic protocol and key-envelope format.
  - Rotation schedule and membership-change procedure.
  - Lost-device handling and offline retention.
  - Interactions with scanning, previews, search, sharing, WebDAV, synchronization, and backups.
- Affected plan-tree phases:
  - Phase 5.1: Users and trust model.
  - Phase 5.2: File and storage behavior.
  - Phase 5.3: Privacy and operations.
- Required follow-up issues:
  - #4 remains open for the client-side architecture and key lifecycle details.
  - #10 remains open; D-006 does not authorize BielOS key sharing or migration.

## Discovery sequence

The orchestrator should normally follow this order because later answers depend on earlier trust and user decisions.

## Round 1: Product identity and relationship

### Q1. Canonical product

- Status: `[DECIDED]` — recorded in D-001.
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

- Status: `[DECIDED]` — recorded in D-002.
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

- Status: `[DECIDED]` — recorded in D-003.
- Question: Under the intended security model, can the administrator/server decrypt and inspect user files?

Concrete models:

1. Yes, normal server-managed encryption and access controls.
2. No, zero-knowledge/client-side encryption for all user content.
3. Mixed: some compartments are zero-knowledge and some are server-readable.
4. Personal-only deployment where this distinction is intentionally less strict.

This decision must be made before redesigning encryption, recovery, previews, scanning, search, WebDAV, or sharing.

### Q5. Administrator authority

- Status: `[DECIDED]` — recorded in D-004; exact consent, retention, and operational metadata details remain open.
- Question: Which actions may an administrator perform?

D-003 establishes that account, compartment, permission, block, backup, and deletion management does not grant plaintext content access. The complete authority matrix remains open.

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

- Status: `[DECIDED]` at policy level in D-005 and D-006; exact recovery-package, trusted-recovery, and key-protocol details remain open.
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

- Status: `[DECIDED]` — D-002 and D-005 require administrator creation or approval, direct creation or revocable expiring invitations, and no automatic `/apply` access.
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
- D-005 fixes username sufficiency, optional email, and separation of login recovery from content-key recovery. Password policy, 2FA, session duration, device lists, and lockout details remain open.
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

- Status: `[DECIDED]` — D-003 selects client-side zero-knowledge content protection; exact protocol and compatibility design remain open.
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

- Status: `[DECIDED]` at the policy level in D-003 and D-004; exact operational categories, retention, access, and export rules remain open.
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

- Status: `[DECIDED]` at policy level in D-005; the default retention period, restore window, and backup-deletion semantics remain open.
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

- Status: `[DECIDED]` at policy level in D-004; exact retention, access, export, deletion, and privacy rules remain open.
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

## Round 1 checkpoint

Round 1 is complete. D-001, D-002, and D-003 are approved and recorded. Issue #4 remains open. Issue #10 remains open and must not be closed until its required relationship consequences are documented, merged, and reconciled.

## Round 2 checkpoint

Round 2 is complete at the policy-decision level. D-004, D-005, and D-006 are approved and prepared for publication. All deferred architecture, protocol, retention, recovery, and client-behavior details remain explicitly `[OPEN]`. Issues #4 and #10 remain open.

## Current discovery queue

Recommended Round 3 questions:

1. Define the cryptographic protocol, compartment key hierarchy, key envelopes, rotation, and recovery-package format.
2. Define audit/log retention, deletion retention, restore windows, and the exact treatment of offline and previously downloaded data.
3. Define client-side scanning, previews, search, sharing, WebDAV, synchronization, and backup compatibility under the approved key model.

Do not ask all remaining questions at once. Each round must preserve explicit decisions, inferred consequences, and unresolved details separately.
