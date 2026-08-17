# Root.ark/BielOS relationship contract

Status: local closure-ready contract for Issue #10; future integration remains owner-approved work.

Repository: `bielxdh3/root.ark`
Branch: `cdx/rootark-roadmap`
Local baseline: `28747c6ebdac873650e2d5a3c6193824e7cc9985`
Decision basis: D-001 through D-009 in `docs/product-discovery.md`

## 1. Current relationship

Root.ark remains an independent product and independently developed runtime in this repository. No automatic integration, selective reuse, migration, synchronization, account federation, or administrative access with BielOS is authorized by this contract.

The current closure position is intentionally narrow: Root.ark can continue independent operation under its existing local runtime, data, authentication, and security boundaries. A future BielOS relationship may be designed later, but it is a separate owner-approved architecture, security, and contract project. It is not a prerequisite for current independent Root.ark operation and does not authorize changes to either system now.

This contract records D-001's consequences and closes the local relationship-definition gap. It does not close unresolved product decisions in D-002 through D-009, approve implementation, or claim that current server-readable behavior satisfies the future zero-knowledge product direction.

## 2. Non-sharing boundaries

The following boundaries apply by default and remain separate unless a later, versioned, explicitly approved contract says otherwise:

| Boundary | Current contract | Security consequence |
|---|---|---|
| Identity | Root.ark and BielOS use separate accounts and principals. There is no shared login, automatic account linking, implicit federation, or assumption that equal usernames represent the same person. | Authentication in one system does not authenticate a request in the other. Any future account mapping must be explicit, reviewed, revocable, and auditable. |
| Data | Root.ark keeps separate runtime roots, databases, files, metadata, backups, trash/quarantine state, and cloud-storage namespaces. BielOS has no default read or write path into them. | A path, database handle, provider object, backup archive, or metadata record from one system is not trusted merely because it is presented by the other. |
| Sessions | Cookies, tokens, session stores, session generations, expiry, revocation, CSRF state, and WebSocket authentication are separate. Root.ark sessions are not accepted by BielOS and vice versa. | Logout, disable, deletion, password change, or revocation in one system has no silent cross-system effect. |
| Migration | Any export/import is an explicit, reviewed operation with a declared direction, data inventory, authorization, validation, rollback plan, and audit record. It is never a startup task, background convenience, or implicit compatibility fallback. | No user files, metadata, accounts, or history move without owner-approved scope and evidence that confidentiality, integrity, retention, and recovery boundaries remain valid. |
| Keys | Root.ark and BielOS do not share encryption keys, key-encryption keys, recovery packages, device trust, recovery authorities, or key-rotation state. | Possession of a BielOS administrator credential or recovery package must not decrypt Root.ark content; D-006/D-007/D-009 remain authoritative for future client-side key design. |
| Trust and administration | BielOS is not an implicit Root.ark administrator, and Root.ark administrators are not implicit BielOS administrators. Access to Root.ark content, metadata, audit, backups, or recovery material requires Root.ark's own authorization and the applicable product policy. | Administrative identity, network location, process ancestry, or repository relationship is not sufficient authorization. Cross-system access must fail closed when identity, capability, consent, scope, freshness, or audit requirements are missing. |

The same separation applies to cloud credentials, provider parents/prefixes, local filesystem roots, runtime environment variables, audit destinations, retention schedules, and operational workers. A shared host or deployment is not a shared trust domain.

## 3. Explicitly prohibited automatic sharing

No code, module, route, library, configuration, database, table, session, cookie, token, account, principal, file, folder, filename, object key, encryption key, recovery package, device trust record, audit log, backup, trash item, quarantine item, retention policy, scheduler, worker, route behavior, response format, or runtime setting may be copied, reused, synchronized, mounted, imported, federated, or otherwise shared automatically between Root.ark and BielOS.

In particular, the following are prohibited without a later approved contract and implementation review:

- merging or silently reusing Root.ark code as a BielOS runtime component;
- accepting a BielOS bearer token, cookie, session, administrator claim, or database identity in Root.ark;
- accepting a Root.ark bearer token, cookie, session, administrator claim, or database identity in BielOS;
- sharing databases, migrations, ORM/repository state, user-generation ledgers, or transaction/rollback journals;
- copying or synchronizing user files, uploads, quarantine payloads, trash contents, backups, cloud objects, or derived metadata;
- sharing server, compartment, recovery, encryption, device, or backup keys and packages;
- treating one system's audit, retention, deletion, backup, or restore decision as the other's decision;
- changing current Root.ark routes, events, authentication, storage, WebDAV, upload, scan, persistence, or realtime behavior merely to anticipate BielOS;
- creating hidden replication, startup import, background sync, shared filesystem mounts, or provider-level access that bypasses an explicit user-visible contract.

## 4. Future API or IPC possibility

An approved future integration may use a versioned API or IPC contract, but this document does not create endpoints, sockets, queues, adapters, credentials, or implementation permission.

Any such contract must be separately approved by the owner and security-reviewed before implementation. At minimum it must define:

1. protocol and contract version, supported operations, direction, compatibility window, and deprecation behavior;
2. a distinct capability-scoped credential that is not a user session or administrator credential;
3. least-privilege resource, field, action, and time scope, with explicit consent where user data is involved;
4. independent authentication and authorization at the receiving boundary, including current principal, capability, expiry, revocation, and audience checks;
5. replay protection, request uniqueness, freshness, nonce or equivalent mechanism, bounded payloads, and rate limits;
6. fail-closed behavior for unknown versions, missing consent, invalid scope, stale/replayed requests, unavailable authorization state, ambiguous identity mapping, and partial migration state;
7. audit events on both sides that record actor/capability, scope, operation, result, time, and opaque resource identifiers without secrets, keys, plaintext, or unnecessary content;
8. explicit data classification, export/import format, integrity/authenticity checks, retention, deletion, rollback, retry, and disaster-recovery semantics;
9. key and recovery handling that preserves compartment isolation and never grants server-side plaintext access contrary to D-003, D-006, D-007, or D-009;
10. operational isolation, provider boundaries, kill switch/revocation, monitoring, incident handling, and a tested rollback path.

No API or IPC proposal may infer broad access from a narrow capability, substitute network reachability for authorization, or turn a failed/uncertain response into successful migration or publication.

## 5. Current-state acceptance table

| Consequence or choice | Current state | Classification | Closure condition |
|---|---|---|---|
| Root.ark remains independent | Recorded by D-001 and preserved by the current repository/runtime boundary | **Closed by decision; locally closure-ready** | No integration is required for independent operation |
| Automatic code reuse or runtime integration | Explicitly prohibited above; no runtime change in this packet | **Closed as a current prohibition** | Reopen only through an approved architecture and security packet |
| Shared identity or login | D-001/D-005 keep identity and account creation separate; no federation contract exists | **Closed as a current prohibition; future choice open** | Owner-approved identity mapping and threat model would be required |
| Shared sessions, cookies, tokens, and revocation | No cross-system session acceptance is authorized | **Closed as a current prohibition; future choice open** | Separate capability contract, audience, expiry, replay, and revocation design |
| Shared data, databases, files, cloud credentials, or provider namespaces | No automatic transfer or shared storage boundary is authorized | **Closed as a current prohibition; future migration choice open** | Reviewed export/import scope, integrity, rollback, retention, and consent |
| Shared encryption or recovery keys | D-003/D-006/D-007/D-009 preserve client-side and compartment-isolated key direction | **Closed as a current prohibition** | Any future interoperability must preserve key isolation and receive separate approval |
| BielOS administrator access to Root.ark content | Not implied by repository relationship or host/process identity | **Closed as a current trust rule** | Explicit consent, scoped capability, audit, and approved product policy would be required |
| Future API/IPC | No endpoint, IPC channel, adapter, credential, or data flow is implemented | **Owner-dependent and unimplemented** | Separate versioned least-privilege contract and security review |
| Migration or selective reuse | Allowed by D-001 only as a future explicitly designed and approved project | **Owner-dependent and unimplemented** | Owner approval, architecture, threat model, migration/rollback plan, and validation |
| Current Root.ark independent operation | Existing runtime remains the current local system of record; current behavior is not reclassified as final D-003/D-009 product behavior | **Locally closure-ready with reservations** | Continue independent operation while product and architecture gaps remain tracked |

## 6. Required future project gate

Before any cross-system implementation, the owner must approve a separate scope that names the exact data, principals, capabilities, direction, protocol, consent, keys, retention, audit, failure behavior, rollback, and operational ownership. The project must demonstrate that no implicit administrator path, shared session, silent migration, key reuse, or server-readable content expansion has been introduced.

Until that gate is satisfied, the correct behavior is separation: reject uncontracted cross-system requests, do not import or synchronize state, and preserve Root.ark's independent runtime and data boundaries.

## Sources and limitations

- `docs/product-discovery.md`: D-001 establishes independent Root.ark development and explicitly prohibits automatic code/database/session/file/encryption-model sharing; D-003, D-005, D-006, D-007, D-008, and D-009 constrain administrator authority, accounts, keys, recovery, retention, backups, quarantine, synchronization, and zero-knowledge boundaries.
- `docs/plan-tree.md`: Issue #10 tracks the relationship consequences; current independent operation is the selected direction while future integration policy and contracts remain open.
- `docs/issue-ledger.md`: Issue #10 is locally recorded as `closure-ready-local`; the current independent relationship is documented, while any future integration remains owner-dependent and the remote issue was not modified.
- `docs/architecture/current-server-responsibility-map.md`: the current runtime is independently composed and must not be mistaken for the final D-003/D-009 architecture.
- `docs/validation/2026-08-13-json-sqlite-parity-matrix.md`: persistence and migration parity remain measured only in bounded slices; no shared Root.ark/BielOS migration is implied.

This document is local evidence and contract definition only. It does not implement integration, validate another repository, prove production deployment, establish owner approval for future choices, or claim remote closure. No runtime, test, dependency, plan-tree, product-discovery, workflow, or other documentation file is changed by this packet.
