# Zero-knowledge architecture and migration contract

Status: architecture and threat-model proposal for review; not implementation, acceptance evidence, or owner approval.

Repository: `bielxdh3/root.ark`
Branch: `cdx/rootark-roadmap`
Local baseline: `28747c6ebdac873650e2d5a3c6193824e7cc9985`
Policy sources: D-003, D-006, D-007, D-008, and D-009 in `docs/product-discovery.md`

## 1. Acceptance boundary first

Root.ark is not a zero-knowledge product today. The current server-readable encryption and metadata modes, server-side previews/search, ClamAV scanning, server-native WebDAV, one-way synchronization MVP, and existing backup/restore behavior are legacy/current implementation behavior. They are not acceptance evidence for the future zero-knowledge architecture and must not be relabeled as compliant by this document.

This document defines a reviewable target contract and a migration boundary only. It does not implement cryptography, client code, server routes, key storage, migration jobs, synchronization, WebDAV bridges, or dependency changes. No current route or test result proves the target design. A future implementation packet must separately establish algorithm/library approval, client interoperability, threat-model closure, migration safety, and authorized-client decryptability.

The target trust claim is precise: for protected compartments, the service and its administrators may store and operate on ciphertext and minimum operational metadata, but must not possess an ordinary independent path to decrypt content, keys, previews, indexes, or recovery material. This does not erase endpoint compromise, recipient-held copies, traffic/metadata leakage, malicious clients, or operational access to ciphertext.

## 2. Versioned cryptographic envelope

Every protected file, version, encrypted derived artifact, and key envelope must carry an authenticated, versioned envelope. The initial schema should be algorithm-agile rather than naming an unapproved final algorithm:

```text
Envelope {
  format: "rootark-envelope",
  formatVersion: integer,
  cryptoSuiteId: registered opaque identifier,
  compartmentId: opaque identifier,
  objectId: opaque identifier,
  objectType: file | preview | thumbnail | index | recovery,
  contentVersion: integer,
  keyReference: opaque non-secret reference,
  nonceOrIv: suite-defined encoded value,
  ciphertext: bytes,
  authenticatedMetadata: suite-defined protected metadata,
  aadDigest: encoded digest or suite-equivalent binding,
  integrityProof: suite-defined authentication result,
  createdAt: operational timestamp,
  parentVersion: optional opaque/version reference
}
```

The final serialization, field encodings, required fields, and suite registry must be defined by an independently reviewed implementation specification. `cryptoSuiteId` must be resolved through a versioned registry with explicit allowed, deprecated, and rejected states. Unknown, deprecated-for-writing, malformed, truncated, or downgraded envelopes fail closed; readers may retain a bounded compatibility window only when the approved registry says so.

No bespoke primitive, improvised composition, home-grown KDF, unaudited nonce construction, or “temporary” cryptography is acceptable. The Architect recommendation in section 2.1 resolves the implementation-only choices for review; it does not authorize implementation or replace independent security review.

The implementation gate must include positive and negative test vectors for every suite, cross-client round trips, malformed and tampered envelopes, wrong-key and wrong-compartment failures, replay/downgrade attempts, truncation, version transitions, deterministic metadata/AAD binding, and safe error classification without plaintext or key leakage.

## 2.1 Architect technical recommendation (pending independent security review)

This is an Architect recommendation, not an implementation approval, product decision, or claim that Root.ark is zero-knowledge. It is deliberately specific enough to make Phase 8 technically actionable while leaving only genuine product policy in `OWNER_DECISION_PACKET`.

### Recommended suite and library boundary

Use one registered initial suite, `rootark-zk-1`, with these standards-based components:

- Content and derived artifacts: AES-256-GCM with a 256-bit CEK, a 96-bit nonce, and a 128-bit authentication tag. AES-GCM is the AEAD boundary for confidentiality and integrity; implementations must obey the per-key nonce-uniqueness requirement described by [RFC 5116](https://www.rfc-editor.org/rfc/rfc5116) and [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final).
- Domain-separated derivation: HKDF-SHA-256 ([RFC 5869](https://www.rfc-editor.org/rfc/rfc5869)). Every derived value uses an explicit, length-delimited `info` context containing the suite ID, purpose, compartment ID, object type, content version, and key epoch. HKDF is not used as a password KDF.
- Password-protected recovery packages only: Argon2id with a unique salt and parameters recorded in the package, following the testable definition in [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106). Parameters are deployment-tuned and independently reviewed; passwords never directly encrypt content.
- Device and compartment key delivery: HPKE ([RFC 9180](https://www.rfc-editor.org/rfc/rfc9180)), base mode, `DHKEM(X25519, HKDF-SHA256)`, `HKDF-SHA256`, and `AES-256-GCM`. HPKE is used only through a reviewed implementation conforming to the RFC and its vectors; no hand-built X25519-plus-AES composition is permitted.
- Device authorization manifests: Ed25519 signatures through the same reviewed crypto boundary, with the signed scope, device key, compartment, epoch, expiry, and authorization purpose included in the signed payload. Signature support is for authorization/integrity, not content encryption.

The audited library boundary is one small client-side crypto module exposing typed operations for random generation, AES-GCM, HKDF, Argon2id package protection, HPKE, Ed25519 verification/signing, and secure zeroization where the platform permits it. Application routes, storage adapters, WebDAV, sync, and UI code must not call primitives directly. The module must pin an independently reviewed, standards-conformant implementation, record provenance and supported platforms, verify reproducible artifacts, and expose no fallback to custom or weaker primitives. Web Crypto may be used as a backend for the exact AES-GCM/HKDF operations only behind this interface and only after feature, interoperability, and security review; HPKE, Argon2id, and signature operations require the reviewed library backend. No dependency is selected or installed by this document.

### Key hierarchy, separation, and nonce construction

Each file version receives a fresh, uniformly random 256-bit CEK. A compartment encryption root (CER) is generated on an authorized client for each compartment and key epoch. The CER is wrapped to each authorized device public key with the HPKE suite above. The file CEK is wrapped under the current CER using AES-256-GCM with a distinct wrapping nonce and AAD; a share or recovery envelope creates a separately scoped HPKE-wrapped copy rather than exposing the CER. HKDF derives only purpose-specific subkeys (for example `content`, `derived-data`, `key-wrap`, `manifest-signing-context`, and `recovery-package`) and never reuses one derived key across purposes.

For AES-GCM, the envelope stores a 12-byte nonce. The preferred construction is a per-key fixed random field plus a monotonic counter, with durable checkpointing before reuse as described by RFC 5116. Because the file CEK is single-version scoped, a fresh CSPRNG nonce is acceptable only for that one encryption under that CEK; a wrapping key or CER must use a coordinated per-key nonce ledger/counter. Any nonce collision, counter rollback, lost checkpoint, or ambiguous reuse state is a hard failure that forces key rotation and prevents encryption until repaired. Nonces are never derived from filenames, timestamps, object IDs, or attacker-controlled values alone.

### Envelope, AAD, and version registry

Use deterministic CBOR ([RFC 8949](https://www.rfc-editor.org/rfc/rfc8949)) for the application envelope and COSE structures ([RFC 9052](https://www.rfc-editor.org/rfc/rfc9052)) for authenticated encryption/signature processing. The registered suite fixes one deterministic encoding, integer/byte-string types, protected-header set, and rejection rules. A `COSE_Encrypt0`-style content envelope is used for one CEK/object; recipient and recovery copies use the corresponding COSE recipient structure carrying HPKE output and the wrapped key. The registry assigns each suite a status of `allowed-for-read`, `allowed-for-write`, `deprecated`, or `rejected`, plus minimum client version and migration rules.

The protected AAD is the deterministic encoding of: protocol domain, suite ID, envelope version, compartment ID, opaque object ID, object type, content version, key epoch, parent/version reference, key purpose, and schema/derivation identifiers. Mutable routing, quota, timestamps, and provider fields are excluded unless explicitly versioned and authenticated. The envelope must be self-describing enough to select the registered parser, but must not contain plaintext names, keys, passwords, or recovery material. Unknown fields, duplicate fields, non-deterministic encodings, unknown suites, rejected versions, AAD mismatch, tag failure, and inconsistent parent/epoch state fail closed.

### Devices, recovery, rotation, and compromise

Every device has a distinct HPKE key pair and Ed25519 authorization key. Enrollment is approved by an existing authorized device or a verified recovery package, then recorded in a signed, compartment-scoped manifest with expiry, epoch, and replay/idempotency state. Login recovery never supplies content keys. Recovery packages contain encrypted CER epochs and authorization metadata, are protected by the user-controlled recovery mechanism, and are tested by the client before acceptance; the service receives only opaque encrypted package material.

Removing or suspecting a device revokes its manifest immediately, increments the compartment authorization epoch, and rotates the CER for future writes. Existing CEKs are rewrapped only when an authorized device has the required keys; historical re-encryption after compromise is explicit and separately verified. A compromise cannot revoke plaintext, exported keys, recipient copies, or already-decrypted caches. Lost recovery material is a fail-closed unrecoverable state unless another authorized device or approved recovery policy exists.

### Derived data, sharing, backup, bridge, and sync boundaries

Previews, thumbnails, indexes, and other derived artifacts use a fresh artifact CEK and the same AEAD envelope family, with AAD binding source object/version, derivation type, schema, and parameters. The server stores only opaque encrypted artifacts and may reject or route them without decrypting them. Server-blind sharing sends a separately scoped recipient envelope (HPKE-wrapped CEK or CER reference) and capability metadata; expiry/revocation stops future delivery but cannot revoke recipient-held plaintext or keys.

Backups contain ciphertext, deterministic envelopes, wrapped keys, manifests, and opaque integrity/migration state only. Cryptographic erasure is complete only after every service-controlled decryptable key, recipient envelope under service control, cache, backup, and restore copy is inventoried and destroyed or made unusable; legacy server-readable copies remain outside the target claim until migrated or expired under approved policy.

The trusted WebDAV bridge is a local client process, not a server route: loopback/OS-authenticated IPC, a short-lived compartment-scoped capability, OS-backed key storage, encrypted/minimized cache, atomic ciphertext writes, and crash journals are required. It decrypts only after local authorization and re-encrypts before upload; server-native WebDAV remains a legacy non-zero-knowledge mode. Sync transports opaque envelopes, signed manifests, versions, capabilities, and idempotency/replay state. Authorized clients, not the service, decrypt and resolve content conflicts; provider or network failure never causes plaintext fallback or an accepted unauthenticated state.

### Migration, rollback, downgrade resistance, and fixtures

Migration uses an explicit state machine and a monotonic envelope/version registry. It is opt-in, compartment-scoped, inventory-first, client-authorized, dual-read/target-write only during an owner-approved window, and never silently downgrades. Each object has an authenticated manifest, idempotency key, checkpoint, and client decrypt-and-verify proof before legacy key destruction. Rollback may restore a deliberately retained prior envelope/state, but cannot restore destroyed keys or external copies; partial or uncertain coordination remains `mixed`, `blocked`, or `migration-failed`.

The implementation packet must ship RFC/NIST and suite-specific vectors, fixed deterministic fixtures with test-only keys/nonces, cross-language envelope fixtures, round-trip and wrong-key tests, AAD/tag/truncation/duplicate-field tests, nonce-ledger crash/restart tests, replay/downgrade/unknown-suite tests, device/recovery/rotation/compromise tests, migration checkpoint/rollback tests, and fuzz/property tests. Interoperability requires at least two independent implementations or a reviewed reference plus a second client; production acceptance requires reproducible vector results and no plaintext/key leakage in errors or logs.

### Failure classification

Cryptographic authentication/tag failure, AAD mismatch, malformed or duplicate envelope field, unknown/deprecated/downgraded suite, nonce reuse/rollback, invalid device/recovery authorization, replay, or scope mismatch is `FAIL_CLOSED_SECURITY`. Missing optional provider/network/cache state without a verified ciphertext result is `RETRYABLE_OPERATIONAL`; it must not become plaintext fallback or success. Missing library/backend, unsupported platform primitive, unavailable native binding, or failed reproducibility is `BLOCKED_ENVIRONMENT`. Sharing UX, recovery authority, migration window, retention, and conflict policy remain `OWNER_DECISION`. Any unexpected parser/crypto error is `REQUIRES_SECURITY_REVIEW` and must not disclose sensitive values.

## 3. Keys, compartments, and authenticated metadata

Each file receives a fresh random content-encryption key (CEK). A CEK is never reused across files or compartments. A file version may use a new CEK or an explicitly approved version relationship; the relationship must not make historical key material a universal decryption path.

Each compartment has an isolated root/key hierarchy. User and device authorization keys receive access through compartment-scoped wrapping or envelope records. The server stores opaque key references and wrapped material, not an independently usable universal administrator key. A wrapped key must bind at least the compartment, object, content version, intended recipient/device scope, crypto-suite version, and purpose through authenticated metadata or AAD. A key valid for one compartment, object type, or purpose must fail for another.

Authenticated metadata/AAD must bind the ciphertext to its opaque object identity, compartment, version, content type, parent/version relationship, and integrity-relevant state. Mutable operational fields must be explicitly classified so a metadata update cannot silently rebind ciphertext or keys. Integrity failure is a hard failure: do not preview, index, publish, restore, synchronize, or release the object.

Opaque identifiers should replace plaintext filenames, folder names, user identifiers, and provider keys wherever the target product permits. The system must preserve enough separately authorized metadata to route, quota, deduplicate only where approved, retain, audit, and recover objects. Filename and folder-name protection is feasible only if clients perform name encryption/decryption and the service uses opaque IDs or approved blind lookup structures; this requires a separate searchable-metadata design and must not become an accidental plaintext index.

Unavoidable or likely operational leakage must be documented per deployment: ciphertext byte length and approximate size, object count, opaque identifiers, timestamps needed for operation, version relationships, request timing and frequency, network endpoint information, account/compartment existence where routing requires it, storage-provider placement, quota/retention state, failure categories, and possibly access-pattern or traffic metadata. The service must not claim to hide metadata it must observe to provide the selected operation. Audit records use opaque identifiers and may contain actor, IP/device, timestamp, operation, result, and security state, but not plaintext, keys, recovery material, decrypted names, search terms, previews, or unnecessary payloads.

## 4. Devices, authorization, and recovery

Keys are generated client-side. A trusted device may authorize another device through a compartment-scoped authorization flow; a valid recovery package may authorize a device without an existing device. Device authorization records must be scoped, expiring/revocable, auditable, replay-resistant, and bound to the intended compartment and device key. Login recovery and content-key recovery are separate: changing or resetting a password must not silently recover content keys.

Device removal immediately blocks future service authorization and rotates material used for future content and authorization. It cannot revoke plaintext or ciphertext already downloaded, decrypted, exported, cached, or held by a recipient. Lost-device handling must distinguish a reachable device, an unavailable device, a suspected compromise, and a lost recovery package; each state must have explicit user-visible consequences and fail-closed defaults.

Offline access stores only indispensable protected key material. The client must use OS-backed secure storage and local authentication where available, minimize cache lifetime and scope, bind local records to the device key, and make deletion/expiry behavior explicit. Offline copies are outside the service's ability to revoke retroactively and must be represented in the user/security model.

Recovery packages are generated client-side, protected with a user-controlled mechanism, versioned, exportable, and tested by the user before setup completes. Verification must prove that an authorized client can recover the intended key hierarchy without sending plaintext or usable recovery keys to the service. A suspected package compromise revokes that package for future authorization, records an audit event without the package contents, requires a new package, and rotates material used for future authorization. Historical re-encryption after compromise is separate, expensive, explicit, and never automatic.

## 5. Derived data, scanning, and quarantine

Previews, thumbnails, MIME classifications where product policy requires them, and full-text indexes are generated client-side for protected content where feasible. Derived artifacts are encrypted, carry their own versioned envelopes, bind to the source object/version and derivation parameters through AAD, and follow source authorization, retention, deletion, backup, and rotation state. A client without the relevant key fails closed; it must not receive plaintext or a “best effort” unencrypted derivative.

Scanning occurs client-side before client encryption when feasible. External uploads that cannot be scanned client-side enter quarantine by default and are clearly marked unverified. Quarantine metadata and payloads require a separate policy and audit boundary. An administrator may reject or release only under explicit approved policy and authorization; release does not claim malware verification and never requires server decryption. There is no automatic release based on scanner availability, migration completion, backup restore, or a successful metadata check.

The current ClamAV/server-readable scan path remains legacy behavior during migration. It must not be described as zero-knowledge scanning, and migration must label whether an object was client-verified, externally unverified, or processed by the legacy server-readable path.

## 6. Server-blind sharing and public links

Sharing delivers ciphertext and the required wrapped key material through separately authorized channels. A public link may contain or convey a recipient-held decryption capability only under a server-blind design in which the server cannot independently reconstruct the decryption secret. Link metadata must not turn into a server-readable key registry.

Upload-only and download/share capabilities remain separate. Links require explicit scope, expiry, revocation state, rate and abuse limits, and auditable creation/use/revocation. Revocation blocks future service access but cannot revoke plaintext, decrypted caches, ciphertext, or keys already obtained by recipients. Expired or revoked links fail closed; uncertain link state must not become successful access. The exact link UX, expiry defaults, recipient recovery, and fragment/key delivery mechanism remain owner-dependent until separately approved.

## 7. Backup, restore, and cryptographic erasure

Backups preserve ciphertext, authenticated metadata, crypto-suite and envelope versions, object/version relationships, wrapped envelopes, encrypted previews/thumbnails/indexes, integrity proofs, and the minimum migration/recovery metadata needed by authorized clients. Backup and restore must not create a server/admin plaintext path or universal recovery key. Restore validation must include integrity checks and proof that an authorized client can decrypt representative restored material; a successful archive extraction alone is insufficient.

Cryptographic erasure is a state machine, not a boolean filesystem deletion:

```text
requested → authorized → pending_key_inventory → pending_backup_expiry_or_invalidation
          → key_material_destroyed → verified_complete
          ↘ rejected / failed / requires_review
```

Completion requires an auditable inventory showing that every service-controlled key, envelope, backup copy, cache, and restore structure that could decrypt the scoped content was destroyed or made unusable and independently verified. If an old backup envelope cannot be invalidated safely, erasure remains pending until it expires; it must not be reported complete. D-008's 30-day trash/backup defaults, immediate access revocation, 30-day operational logs, and 180-day security logs remain policy constraints until implementation details are approved.

Erasure does not remove downloaded, exported, already-decrypted, recipient-held, or externally stored copies. It does not promise retroactive revocation of plaintext or ciphertext. Audit records must preserve truthful state transitions without recording keys, plaintext, or recovery packages.

## 8. Synchronization contract

The final product requires a bidirectional, version-aware synchronization protocol. It must define object identity, versions, upload/download direction, conflict detection, conflict representation, renames, moves, deletes, trash/restore, exclusions, encrypted metadata, offline queues, retries, replay protection, device authorization, key availability, recovery, and audit events.

The server may coordinate opaque envelopes, versions, capabilities, and integrity proofs, but must not decrypt protected content or resolve content conflicts by reading plaintext. Conflict resolution must occur on authorized clients or through a separately approved encrypted/metadata-only mechanism. Every operation needs an idempotency/replay key, authenticated scope, freshness/expiry, bounded payload, explicit result state, and safe handling of uncertain remote completion. A one-way sync MVP or cloud retry path is not evidence of this contract.

## 9. Zero-knowledge WebDAV

Protected zero-knowledge WebDAV requires a trusted local bridge or client. Server-native WebDAV must not decrypt protected content. The bridge is a separate trust boundary and must have:

- local authentication and explicit user/device authorization;
- strict path-to-opaque-object mapping without trusting remote WebDAV path text as an identity;
- least-privilege access to selected compartments and files;
- protected local key handling using OS-backed storage where possible;
- encrypted or minimized local caches with expiry, revocation, and clear offline-copy limits;
- bounded request/body sizes, replay protection, safe temporary files, and fail-closed authorization;
- crash journals and recovery that preserve ciphertext and metadata integrity without duplicating plaintext;
- audit events with opaque identifiers and no content, key, or recovery material;
- explicit behavior for unavailable keys, stale authorization, conflicts, rename/delete, trash, and partial writes.

The existing server-native WebDAV implementation is current behavior and remains outside this target acceptance boundary until replaced or explicitly scoped as a legacy non-zero-knowledge mode.

## 10. Migration from current server-readable encryption

Migration is opt-in, explicit, resumable, and compartment-scoped. It must never claim that an existing server-readable object is already zero-knowledge. Before any write, build an inventory containing object/version identity, current encryption mode, plaintext/metadata exposure class, derived artifacts, links, backups, cloud copies, WebDAV/sync references, quarantine state, retention/hold state, and whether an authorized client/key is available. Inventory output must not include plaintext content or keys.

The migration sequence is:

1. **Classify and label.** Mark legacy server-readable, protected target, mixed/transition, externally unverified, unavailable-key, and migration-failed states. Labels remain visible to operators and clients where required.
2. **Obtain client authorization.** The user authorizes a trusted client with the required content keys and confirms scope, cost, offline effects, links, derived data, backups, and rollback limits. Password reset or administrator status cannot substitute for content-key authorization.
3. **Client re-encrypt.** The client reads/decrypts only within its authorized boundary, generates a fresh target CEK/envelope, encrypts content and required derived data, verifies round-trip integrity, and uploads ciphertext plus authenticated metadata. The service never receives plaintext as part of the target flow.
4. **Dual-read/one-write transition.** During an approved compatibility window, reads can recognize legacy and target envelopes, but new writes use only the approved target format. Every object exposes its state; no silent downgrade or implicit legacy rewrite is allowed.
5. **Coordinate references.** Rebind versions, links, sharing envelopes, cloud objects, backup entries, WebDAV/sync references, search/index/preview artifacts, trash, retention, and quarantine labels. A reference that cannot be safely re-enveloped remains mixed or blocked.
6. **Checkpoint and rollback.** Use per-object integrity checkpoints, authenticated manifests, idempotent operation IDs, durable progress, bounded retries, and explicit rollback states. Rollback can restore a prior service-controlled envelope/state only while the old material is intentionally retained; it cannot restore plaintext or keys already destroyed.
7. **Verify before destruction.** An authorized client must decrypt representative and scoped migrated material, validate metadata/AAD/version relationships, and confirm backups/restores where promised. Only after proof may old service-controlled keys/envelopes be destroyed under the erasure rules.
8. **Close or remain mixed.** Failed, unavailable-key, unverified, and uncoordinated objects remain clearly labeled and are not counted as migrated. The service must not report zero-knowledge completion while any service-controlled path can still decrypt the claimed scope.

Backups made during transition must preserve both the state label and the applicable envelope versions. Links, WebDAV, sync, search/index/preview, and quarantine must each have explicit legacy/migrated behavior; no component may silently expose a plaintext derivative or downgrade an envelope to keep compatibility. A migration is complete only for the declared scope, not for the repository as a whole.

## 11. Security and threat-model review

### Assets and trust boundaries

Assets include plaintext content, ciphertext, CEKs, compartment roots, user/device authorization keys, recovery packages, encrypted derived data, opaque identifiers, link capabilities, migration manifests, backup envelopes, audit records, and local offline caches. Boundaries are client endpoint, trusted device, local bridge, Root.ark service, administrator/operator, storage provider, backup/restore service, BielOS or other external system, recipient, and network/transport.

### Attacker capabilities

Review must assume a malicious or compromised client, stolen session, compromised device, rogue recipient, replayed or reordered request, malicious migration input, tampered ciphertext/metadata, malicious or misconfigured provider, compromised bridge host, curious administrator, database/backup reader, and partial service compromise. The target does not protect plaintext already exposed to an authorized endpoint or recipient.

### Required controls and residual risks

| Risk | Required control | Residual limitation |
|---|---|---|
| Service/admin reads content or keys | Client-side generation, compartment isolation, wrapped envelopes, no universal administrator key, no server plaintext operations | A compromised authorized endpoint or malicious client can expose its own plaintext |
| Metadata leakage | Opaque IDs, encrypted names where feasible, field classification, minimum audited metadata, documented traffic leakage | Routing, size, timing, quota, retention, and some access patterns may remain visible |
| Tamper or substitution | Authenticated envelope/AAD, version/object/compartment binding, integrity verification before use | Availability and deletion can still be attacked even when tampering is detected |
| Replay, downgrade, or confused deputy | Version registry, audience/scope binding, nonce/idempotency, expiry, revocation, monotonic state, fail-closed unknown versions | Offline clients need bounded replay windows and explicit reconciliation |
| Recovery abuse | User-verified packages, separate login/content recovery, scoped device authorization, package revocation and rotation | Lost all keys/recovery may make content unrecoverable by design |
| Migration rollback or partial failure | Inventory, checkpoints, manifests, idempotence, dual-read/one-write labels, proof before key destruction | Cross-resource rollback cannot restore keys already destroyed or external copies |
| Backup exposure | Ciphertext-only backup, envelope/integrity preservation, key invalidation inventory, authorized-client restore proof | Existing legacy backups may keep a service-controlled decryption path until migrated/expired |
| Recipient/public-link leakage | Server-blind wrapped-key delivery, separate capabilities, expiry/revocation, recipient-copy warnings | Recipient-held plaintext/keys cannot be revoked retroactively |
| Bridge compromise | Local auth, OS key store, compartment scope, minimized encrypted cache, crash-safe journals, audit | A compromised local endpoint can access content authorized to that bridge |
| Sync conflict abuse | Client-side conflict authority, authenticated versions, replay protection, no plaintext conflict resolver | Usability and conflict resolution remain open architecture work |

Security review verdict: **Architect recommendation documented; independent security review required before implementation**. The policy direction is internally consistent with D-003/D-006/D-007/D-008/D-009, and section 2.1 recommends a concrete suite, library boundary, hierarchy, envelope, and failure model. Metadata leakage limits, recovery authority, migration scope, sync authority, and bridge deployment still require review and/or owner policy. No current implementation or validation result closes these risks.

## 12. Implementation readiness

| Slice | Readiness | Why |
|---|---|---|
| Envelope schema and version registry | **No owner decision required for scaffolding** | Can define versioning, field classes, malformed-state handling, and registry interfaces without selecting the final suite |
| Metadata classification and leakage register | **No owner decision required** | Can inventory required/optional/forbidden fields and document operational leakage before implementation |
| Client test-vector harness | **No owner decision required for harness** | Can build fixture format and negative-test structure; suite-specific vectors remain implementation-gated until independent review |
| Key lifecycle state model | **No owner decision required for state model** | Can model device authorization, removal, recovery, rotation, migration, and erasure states without implementing crypto |
| Migration inventory tooling | **No owner decision required for read-only tooling** | Can enumerate current modes, references, derived data, backups, and labels without rewriting data |
| Local bridge threat model | **No owner decision required for threat model** | Can define process, filesystem, key-cache, local-auth, and crash boundaries before selecting platforms |
| Exact algorithm/KDF/library/suite, nonce construction, and envelope serialization | **Technical architecture/security decision; not an owner-packet item** | The Architect and independent security review resolve primitive composition, library provenance, KDF domain separation, nonce construction, and serialization; product owners decide only the resulting compatibility and migration policy |
| Sharing-link UX, expiry, and recipient recovery | **Owner-dependent** | Determines consent, usability, revocation expectations, and recipient-held-copy warnings |
| Recovery person/device policy | **Owner-dependent** | Changes account/key separation, social recovery risk, audit, and loss consequences |
| Mixed-mode migration scope and compatibility window | **Owner-dependent** | Determines how long legacy server-readable content and dual-read behavior remain allowed |
| Sync conflict authority | **Owner-dependent** | Determines whether clients, users, or a metadata-only service resolves conflicts without plaintext |
| 2FA coupling | **Owner-dependent** | Authentication assurance and content-key recovery must not be conflated; product policy is open |

## 13. OWNER_DECISION_PACKET

Implementation-only security architecture choices are not irreducible owner decisions. Section 2.1 records the Architect recommendation; implementation remains gated until independent security review accepts or revises it.

Only the following questions are irreducible owner decisions for the next architecture gate:

1. **Sharing-link UX, expiry, and recipient recovery.** Recommendation: server-blind, least-privilege links with explicit expiry/revocation and clear recipient-copy limits. Alternatives: no public links, or a narrower invite/device-only share model. Consequence: affects usability, recipient-held key risk, revocation promises, and audit. Independent work continues: capability state model and threat analysis.
2. **Recovery authority.** Recommendation: user-controlled verified packages plus trusted devices, with no universal administrator key; decide separately whether an explicitly chosen recovery person/device is allowed. Alternatives: device-only recovery or package-only recovery. Consequence: changes social-engineering, loss, compromise, and support risk. Independent work continues: recovery state transitions and compromise response.
3. **Mixed-mode migration scope.** Recommendation: opt-in compartment/object migration with dual-read/one-write labels and a finite owner-approved compatibility window. Alternatives: block legacy reads until migration or retain a longer legacy mode. Consequence: determines exposure duration, rollback inventory, operational cost, and when “zero-knowledge” may be claimed. Independent work continues: read-only inventory and integrity checkpoint design.
4. **Synchronization conflict authority.** Recommendation: authorized clients resolve content conflicts; the service coordinates opaque versions and integrity only. Alternatives: metadata-only server resolution for a narrowly defined class, or defer sync. Consequence: affects offline usability, convergence, privacy, and conflict-loss risk. Independent work continues: protocol state, replay protection, and version/conflict fixture design.
5. **Authentication/2FA coupling.** Recommendation: keep login assurance, device authorization, and content-key recovery as separate state machines with explicit step-up requirements. Alternatives: product-approved coupling for selected high-risk operations. Consequence: changes recovery and account-takeover risk without granting the server content keys. Independent work continues: threat model and capability/audit matrix.

No owner decision in this packet authorizes cryptographic implementation, migration, route changes, dependency installation, data rewriting, or a claim that Root.ark is zero-knowledge today.

## Sources and limitations

- `docs/product-discovery.md`: D-003 establishes client-side zero-knowledge content and minimum metadata; D-006 establishes compartment/device isolation and non-retroactive revocation; D-007 establishes versioned audited cryptography, per-file keys, verified recovery, and explicit historical re-encryption; D-008 establishes retention and truthful cryptographic-erasure limits; D-009 establishes encrypted derived data, unverified quarantine, server-blind sharing, bidirectional synchronization, local-bridge WebDAV, and encrypted backup/restore.
- `docs/architecture/current-server-responsibility-map.md`: current server-readable modes, metadata-dependent routes, scanning, WebDAV, persistence, cloud, backup, and lifecycle coordination are implementation boundaries, not target acceptance evidence.
- `docs/architecture/rootark-bielos-relationship-contract.md`: Root.ark and BielOS remain independently trusted systems with no shared identity, sessions, data, databases, keys, or automatic migration.
- `docs/validation/2026-08-13-rootark-continuation-evidence.md` and `docs/validation/2026-08-13-json-sqlite-parity-matrix.md`: focused local evidence is bounded and explicitly leaves current zero-knowledge behavior, full parity, live providers, OS WebDAV, migration, and production behavior unverified.
- `docs/security/current-findings.md` and `docs/security/phase-2-2-closure-audit.md`: prior security stabilization does not establish the future zero-knowledge architecture.
- Standards consulted for the Architect recommendation: [RFC 5116 AEAD](https://www.rfc-editor.org/rfc/rfc5116), [RFC 5869 HKDF](https://www.rfc-editor.org/rfc/rfc5869), [NIST SP 800-38D GCM](https://csrc.nist.gov/pubs/sp/800/38/d/final), [RFC 9106 Argon2](https://www.rfc-editor.org/rfc/rfc9106), [RFC 9180 HPKE](https://www.rfc-editor.org/rfc/rfc9180), [RFC 8949 CBOR](https://www.rfc-editor.org/rfc/rfc8949), and [RFC 9052 COSE](https://www.rfc-editor.org/rfc/rfc9052). These references support the recommendation; they do not constitute independent review or implementation evidence.

This is a reviewable design and threat-model record only. It does not change plan-tree, product decisions, issue state, runtime, tests, package files, dependencies, data, credentials, or remote state. Browser, CI, provider, OS-mount, and production behavior are not claimed.
