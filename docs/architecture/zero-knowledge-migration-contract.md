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
- Device and compartment key delivery: direct RFC 9180 HPKE, base mode, `DHKEM(X25519, HKDF-SHA256)`, `HKDF-SHA256`, and `AES-256-GCM`, behind the explicit Root.ark envelope defined in Section 2.2. RFC 9180 does not define an application wire format; no hand-built X25519-plus-AES composition is permitted.
- Device authorization manifests: Ed25519 signatures through the same reviewed crypto boundary. HPKE base mode authenticates only the recipient possession of the private key; it does not authenticate the sender. Every accepted wrap therefore requires the canonical signed authorization manifest and exact signature-input bytes defined in Section 2.2.

The audited library boundary is one small client-side crypto module exposing typed operations for random generation, AES-GCM, HKDF, Argon2id package protection, HPKE, Ed25519 verification/signing, and secure zeroization where the platform permits it. Application routes, storage adapters, WebDAV, sync, and UI code must not call primitives directly. The module must pin an independently reviewed, standards-conformant implementation, record provenance and supported platforms, verify reproducible artifacts, and expose no fallback to custom or weaker primitives. Web Crypto may be used as a backend for the exact AES-GCM/HKDF operations only behind this interface and only after feature, interoperability, and security review; HPKE, Argon2id, and signature operations require the reviewed library backend. No dependency is selected or installed by this document.

### Key hierarchy, separation, and nonce construction

Each file version receives a fresh, uniformly random 256-bit CEK. A compartment encryption root (CER) is generated on an authorized client for each compartment and key epoch. The CER is wrapped to each authorized device public key with the HPKE suite above. The file CEK is wrapped under the current CER only after the unresolved wrap-key/nonce decision in Section 2.2 is formally reviewed; a share or recovery envelope creates a separately scoped HPKE-wrapped copy rather than exposing the CER. HKDF derives only purpose-specific subkeys (for example `content`, `derived-data`, `key-wrap`, `manifest-signing-context`, and `recovery-package`) and never reuses one derived key across purposes.

For AES-GCM, the envelope stores a 12-byte nonce. The reusable-CER ledger prose is not sufficient for concurrent, offline, crash, rollback, or restore writers. The preferred direction is a one-shot per-wrap key derived with a unique HKDF context plus a fresh nonce, or a reviewed standard key-wrap construction; neither may be implemented until formal vectors and independent review choose one. If a ledger remains, allocation must be linearizable or use disjoint leases, with crash-burn semantics, restore fencing, and hard-fail rotation on rollback or ambiguity. Nonces are never derived from filenames, timestamps, object IDs, or attacker-controlled values alone.

### Envelope, AAD, and version registry

Use an explicit Root.ark deterministic CBOR envelope under the RFC 8949 profile in Section 2.2. Direct RFC 9180 HPKE supplies the HPKE `enc` and ciphertext outputs; the application envelope is not an invented COSE recipient structure. If COSE is retained for a signed manifest or a future interoperable binding, use only final RFC 9052 and RFC 9864 semantics with pinned fully specified algorithms. `draft-ietf-cose-hpke-26` is an active Internet-Draft/work in progress, not a final RFC dependency. The registry assigns each suite a status of `allowed-for-read`, `allowed-for-write`, `deprecated`, or `rejected`, plus minimum client version and migration rules.

The protected AAD and HPKE `info` bytes are the exact deterministic encodings defined in Section 2.2. Mutable routing, quota, operational timestamps, and provider fields are excluded unless explicitly versioned and authenticated. The envelope must be self-describing enough to select the registered parser, but must not contain plaintext names, keys, passwords, or recovery material. Unknown fields, duplicate fields, indefinite or non-preferred encodings, unknown suites, rejected versions, AAD mismatch, tag failure, and inconsistent parent/epoch state fail closed.

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

## 2.2 Independent Phase 8 closure corrections — 2026-08-14

This section supersedes any earlier ambiguity in this document. Verdict: **`PHASE_8_BLOCKED_SECURITY_REVIEW`**. Phase 8 remains `PARTIAL`, Phase 9 remains `NOT_STARTED`, and no Phase 9 foundation, dependency selection, runtime cryptography, migration code, or test implementation was executed.

### Standards and application wire profile

`draft-ietf-cose-hpke-26` is the active IETF Internet-Draft as observed on 2026-08-14, not a final RFC and not a normative dependency. It is cited only as work in progress. The implementation target uses final [RFC 9180 HPKE](https://www.rfc-editor.org/rfc/rfc9180.html) directly behind an explicit Root.ark deterministic CBOR envelope. RFC 9180 does not define an application wire format. If COSE is retained, only final [RFC 9052](https://www.rfc-editor.org/rfc/rfc9052.html) and [RFC 9864](https://www.rfc-editor.org/rfc/rfc9864.html) semantics with pinned fully specified algorithms may be used. Root.ark must not describe a `COSE_Encrypt0`-style object with an invented recipient structure as final standards semantics.

The `rootark-zk-1` envelope profile is provisionally:

- `envelope_version`: unsigned integer `0..65535`.
- `suite`: the exact text string `rootark-zk-1`.
- `compartment_id`, `object_id`, `version_id`, `key_ref`, `sender_key_id`, `recipient_key_id`, and `replay_id`: definite CBOR byte strings, each `1..128` bytes.
- `purpose`: one of the registered text strings `content`, `derived-data`, `key-wrap`, `recovery-package`, or `authorization`.
- `epoch`: unsigned integer `0..2^64-1`.
- `expiry`: unsigned Unix seconds `0..2^63-1`; operational creation/observation timestamps are not authenticated protocol fields.
- `hpke_enc`: exactly 32 bytes for the selected X25519 KEM; `hpke_info_digest`, `wrapped_key_digest`, and `ciphertext_digest`: exactly 32 bytes each.
- `signature`: exactly 64 bytes when an Ed25519 authorization manifest is present; Ed25519 public keys are exactly 32 bytes.

The profile uses RFC 8949 deterministic encoding: preferred serialization, definite lengths, shortest integer and length forms, and deterministic length-first map-key ordering. Maps have unique keys; duplicate keys, indefinite-length items, non-preferred encodings, unsupported tags, floats, trailing bytes, unknown required fields, out-of-range values, and unknown suite/profile versions are rejected before cryptographic processing. Parser errors fail closed and expose no plaintext or key material.

The exact authenticated structures are:

1. `aad_map = {"profile":"rootark-zk-1/aad/v1","suite":"rootark-zk-1","envelope_version":envelope_version,"compartment_id":compartment_id,"epoch":epoch,"purpose":purpose,"object_id":object_id,"version_id":version_id,"key_ref":key_ref,"manifest_digest":SHA-256(manifest_bytes)}` and `aad = deterministic_cbor(aad_map)`.
2. `info_map = {"profile":"rootark-zk-1/hpke-info/v1","suite":"rootark-zk-1","envelope_version":envelope_version,"compartment_id":compartment_id,"epoch":epoch,"purpose":purpose,"object_id":object_id,"version_id":version_id,"key_ref":key_ref,"sender_key_id":sender_key_id,"recipient_key_id":recipient_key_id,"manifest_digest":SHA-256(manifest_bytes)}` and `info = ASCII("Root.ark/zk-1/hpke-info/v1") || 0x00 || deterministic_cbor(info_map)`.
3. `hpke_info_digest = SHA-256(info)`. The HPKE operation uses the exact `info` bytes and the exact `aad` bytes; no JSON, implementation-defined serialization, operational timestamp, or mutable provider field is substituted.

### Base-mode sender authorization

HPKE base mode is recipient-only and does not authenticate the sender. The authorization manifest is therefore mandatory, independent of HPKE success. Define `manifest_map` with exactly these fields: `type`=`rootark-authorization-manifest-v1`, `suite`, `envelope_version`, `compartment_id`, `epoch`, `purpose`, `sender_key_id`, `recipient_key_id`, `object_id`, `version_id`, `key_ref`, `expiry`, `replay_id`, `idempotency_key`, `hpke_enc`, `hpke_info_digest`, `wrapped_key_digest`, and `ciphertext_digest`. `idempotency_key` is a definite byte string `1..128` bytes. The exact signed bytes are `manifest_bytes = deterministic_cbor(manifest_map)` and `signature_input = ASCII("Root.ark/zk-1/authorization-manifest/v1") || 0x00 || manifest_bytes`; Ed25519 signs `signature_input`, not a language object or a re-encoded map.

Verification obtains the sender public key only from the already-authorized device registry, checks the exact Ed25519 signature bytes, suite/version/compartment/epoch/purpose, sender and recipient identifiers, object/version/key reference, expiry, replay and idempotency state, `hpke_enc`, `hpke_info_digest`, and wrapped-key/ciphertext digests. Any mismatch, duplicate idempotency key, expired manifest, revoked sender, wrong recipient, or HPKE/manifest disagreement is rejected before decrypt, publish, restore, sync, or migration.

### Wrapping nonce decision

The current reusable-CER nonce-ledger prose is insufficient for concurrent, offline, crash, rollback, and restore writers. The preferred direction is one-shot per-wrap key derivation with a unique HKDF context containing suite, compartment, epoch, purpose, object/version/key reference, recipient, and a unique wrap identifier, followed by a fresh 96-bit nonce; the alternative is a reviewed standard key-wrap construction. This is a recommendation pending formal vectors and independent review, not an implementation decision. No wrapping implementation may proceed until one option is selected and reviewed. If a ledger remains, it must provide linearizable allocation or disjoint leases, crash-burn semantics, restore fencing, rollback detection, and hard-fail rotation on ambiguity or reuse.

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

Security review verdict: **`PHASE_8_BLOCKED_SECURITY_REVIEW`**. The policy direction is internally consistent with D-003/D-006/D-007/D-008/D-009, but the independent closure corrections in Sections 2.2 and 14-16 identify blocking technical/provenance gates. Metadata leakage limits, recovery authority, migration scope, sync authority, and bridge deployment still require review and/or owner policy. No current implementation or validation result closes these risks.

## 12. Implementation readiness

The following decomposition is planning evidence only. It does not authorize Phase 9 foundation work: `PHASE_8_BLOCKED_SECURITY_REVIEW` remains the gate until the exact corrections, provenance, vectors, owner decisions, and environment-dependent validation close.

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

## 14. Independent attacker matrix and closure classification — 2026-08-14

This is the fresh Phase 8 attacker matrix. A classification is an evidence disposition, not a claim that the control is implemented.

| Attacker or failure | Required protection and acceptance evidence | Classification |
|---|---|---|
| Server or administrator compromise | No ordinary server/admin decryption path; client-held keys, manifest verification, ciphertext-only storage, and no plaintext fallback must be proven with negative tests and log review. | `BLOCKING_PHASE_8` |
| Stolen storage or database/backup reader | Envelope/AAD integrity, opaque identifiers, ciphertext-only backups, leakage register, and truthful erasure inventory must be defined; metadata and traffic leakage remain visible risks. | `REQUIRED_TECHNICAL_CORRECTION` |
| Compromised or revoked device | Signed device authorization, epoch increment, future-content rotation, replay fencing, recovery separation, and explicit historical re-encryption must be interoperably tested. | `BLOCKING_PHASE_8` |
| Malicious recipient or public-link holder | Server-blind recipient wrapping, expiry/revocation, recipient-copy warnings, and no retroactive-revocation promise must be bound to owner-approved sharing UX. | `GENUINE_OWNER_DECISION` and `IMPLEMENTATION_PHASE_REQUIREMENT` |
| Recovery-package compromise | Password protection, package verification, authorization rotation, compromise response, no login/content-key conflation, and recovery audit evidence must be specified and tested. | `BLOCKING_PHASE_8` |
| Replay, rollback, or downgrade | Exact manifest replay/idempotency fields, monotonic suite/epoch state, restore fencing, version registry, and fail-closed unknown/old state must be proven. | `REQUIRED_TECHNICAL_CORRECTION` |
| Provider substitution or malicious cloud state | Provider identity, opaque key containment, authenticated envelopes, digest checks, and no plaintext fallback require provider-backed and failure-injection validation. | `ENVIRONMENT_DEPENDENT_VALIDATION` |
| Synchronization races and conflict abuse | Authenticated version/epoch state, idempotency, client conflict authority, opaque transport, and concurrent/offline fixtures must be implemented and tested. | `REQUIRED_TECHNICAL_CORRECTION` and `GENUINE_OWNER_DECISION` |
| Local bridge crash or compromise | Local authorization, OS key storage, minimized encrypted cache, atomic ciphertext writes, crash journals, recovery fencing, and endpoint compromise boundaries require implementation evidence. | `IMPLEMENTATION_PHASE_REQUIREMENT` |
| Backup/restore rollback or partial failure | Ciphertext-only archives, manifest/digest verification, restore fencing, key-destruction inventory, and rollback labels must be proven without claiming restoration of destroyed keys. | `REQUIRED_TECHNICAL_CORRECTION` |
| Supply-chain or library compromise | Exact package provenance/integrity, reproducible artifacts, supported backends, vectors, maintenance, formal audit scope, and zeroization limits must be independently reviewed. | `BLOCKING_PHASE_8` |
| Metadata, traffic, timing, quota, and access-pattern leakage | Maintain a deployment leakage register and make no stronger privacy claim than D-003/D-009 support. | `RESIDUAL_ACCEPTED_RISK` |

## 15. Library and provenance matrix — read-only evidence observed 2026-08-14

The package versions and integrity values below are read-only npm metadata observations supplied by the independent review. They are not a formal audit, endorsement, reproducible-build result, or implementation selection.

| Candidate | Observed package/integrity | Primary repository or source | Runtime/backend and vectors | Audit, maintenance, zeroization, and supply-chain caveats | Disposition |
|---|---|---|---|---|---|
| HPKE modular stack | `@hpke/core` 1.9.0, `sha512-pFxWl1nNJeQCSUFs7+GAblHvXBCjn9EPN65vdKlYQil2aURaRxfGMO6vBKGqm1YHTKwiAxJQNEI70PbSowMP9Q==`; `@hpke/dhkem-x25519` 1.8.0, `sha512-S1MWWkAfu+TFxySgv5+P3O4Mx/jk7BsoplzQaA1s3sfUJVJ2UsZsSzSsMc+FXJumLXncoJFlO6mK6mDGspfmA==` | [hpke-js](https://github.com/dajiaji/hpke-js) | Browser/Web Crypto-oriented modules; package and upstream vectors require exact version execution; backend support and cross-client behavior remain unverified here. | No formal HPKE integration audit was established; JS secret zeroization is limited; package provenance, transitive dependencies, maintenance, and reproducibility require independent review. | `BLOCKING_PHASE_8` |
| HPKE Node/browser alternative | `hpke` 1.1.4, `sha512-cPzmFEsiyNnD7281X5WeZ461mbH+3P+rjWMSNrLO5rks7dAJvFXAyMwCmorB61pxt+jBnd0GQ6CY43TqOxmhCQ==`; `@panva/hpke-noble` 1.1.4, `sha512-+bOeaH/9XP8FlRqSHOy2zDEAG/SMnDfvxGlBh0bIYtEvt6vP3fkInpwV/pdtde7dF1Ujw3pUVMzYfCDPQ3nZZw==` | [panva/hpke](https://github.com/panva/hpke) | Node, browser, Cloudflare Workers, Deno, and Bun claims are upstream claims; exact backend and RFC vector/interoperability execution remain unverified. | No formal integration audit was established; JS zeroization is limited; maintenance, dependency provenance, reproducible artifacts, and platform-specific behavior require review. | `BLOCKING_PHASE_8` |
| Noble primitives | `@noble/curves` 2.3.0; `@noble/ciphers` 2.3.0; `@noble/hashes` 2.3.0; exact integrity values were not present in the read-only evidence packet. | [noble-curves](https://github.com/paulmillr/noble-curves) and corresponding upstream package sources | Portable JavaScript primitives; vectors and backend assumptions must be pinned per operation and version. | Upstream audit statements are not a Root.ark integration audit; JS zeroization is limited, and package integrity, transitive supply chain, maintenance, and reproducibility must be independently closed. | `REQUIRED_TECHNICAL_CORRECTION` |
| Browser Argon2id | `argon2-browser` 1.18.0; integrity not present in the read-only evidence packet. | [npm argon2-browser](https://www.npmjs.com/package/argon2-browser) | Browser/WASM candidate; Node interoperability, WASM provenance, parameter behavior, vectors, and memory handling remain unverified. | Browser candidate is stale relative to the review; no formal audit or robust zeroization claim is established. | `BLOCKING_PHASE_8` |
| JavaScript Argon2id | `argon2id` 1.0.1; integrity not present in the read-only evidence packet. | [npm argon2id](https://www.npmjs.com/package/argon2id) | JavaScript candidate; browser/Node support, vectors, maintenance, and memory behavior require verification. | No formal audit, reproducible artifact, or zeroization claim is established. | `BLOCKING_PHASE_8` |
| Node-native Argon2id | `@node-rs/argon2` 2.1.0; integrity not present in the read-only evidence packet. | [npm @node-rs/argon2](https://www.npmjs.com/package/@node-rs/argon2) | Node-native candidate; it does not close the browser runtime requirement and native backend provenance requires review. | Native binaries, platform matrix, audit scope, reproducibility, maintenance, and zeroization require independent review. | `BLOCKING_PHASE_8` |

No single Argon2id candidate currently closes browser support, Node support, formal-audit provenance, vectors, reproducibility, and zeroization expectations. No candidate is selected or installed. Missing dependency/network/native-binding evidence remains `ENVIRONMENT_DEPENDENT_VALIDATION`, not a passing security result.

## 16. Phase 9 entry criteria and verdict

Phase 9 may not begin until all of the following are accepted in a separate implementation authorization: independent review of the exact RFC9180 envelope/profile and final COSE boundary; exact deterministic CBOR, AAD, HPKE `info`, and Ed25519 manifest vectors; a reviewed wrap-key/nonce construction; library/package provenance, integrity, reproducibility, backend, maintenance, vector, audit, and zeroization closure; browser/Node Argon2id decision; cross-client interoperability; negative/fuzz/property coverage; device/recovery/rotation/compromise tests; bridge crash safety; migration rollback and downgrade resistance; ciphertext-only backup/restore proof; owner decisions for sharing/public links, recovery authority, migration window/UX, sync conflict UX, and any remaining 2FA policy; and available provider/browser/CI/production validation.

Current verdict: **`PHASE_8_BLOCKED_SECURITY_REVIEW`**. Phase 8 is `PARTIAL`; Phase 9 is `NOT_STARTED`; Phase 15 remains `RELEASE_GATE_BLOCKED_ENVIRONMENT`. No Phase 9 foundation or runtime cryptography was executed by this correction.

## Sources and limitations

- `docs/product-discovery.md`: D-003 establishes client-side zero-knowledge content and minimum metadata; D-006 establishes compartment/device isolation and non-retroactive revocation; D-007 establishes versioned audited cryptography, per-file keys, verified recovery, and explicit historical re-encryption; D-008 establishes retention and truthful cryptographic-erasure limits; D-009 establishes encrypted derived data, unverified quarantine, server-blind sharing, bidirectional synchronization, local-bridge WebDAV, and encrypted backup/restore.
- `docs/architecture/current-server-responsibility-map.md`: current server-readable modes, metadata-dependent routes, scanning, WebDAV, persistence, cloud, backup, and lifecycle coordination are implementation boundaries, not target acceptance evidence.
- `docs/architecture/rootark-bielos-relationship-contract.md`: Root.ark and BielOS remain independently trusted systems with no shared identity, sessions, data, databases, keys, or automatic migration.
- `docs/validation/2026-08-13-rootark-continuation-evidence.md` and `docs/validation/2026-08-13-json-sqlite-parity-matrix.md`: focused local evidence is bounded and explicitly leaves current zero-knowledge behavior, full parity, live providers, OS WebDAV, migration, and production behavior unverified.
- `docs/security/current-findings.md` and `docs/security/phase-2-2-closure-audit.md`: prior security stabilization does not establish the future zero-knowledge architecture.
- Standards and provenance sources consulted for this correction: [RFC 5116 AEAD](https://www.rfc-editor.org/rfc/rfc5116), [RFC 5869 HKDF](https://www.rfc-editor.org/rfc/rfc5869), [NIST SP 800-38D GCM](https://csrc.nist.gov/pubs/sp/800/38/d/final), [RFC 9106 Argon2](https://www.rfc-editor.org/rfc/rfc9106), [RFC 9180 HPKE](https://www.rfc-editor.org/rfc/rfc9180), [RFC 8949 CBOR](https://www.rfc-editor.org/rfc/rfc8949), [RFC 9052 COSE](https://www.rfc-editor.org/rfc/rfc9052), [RFC 9864 fully specified algorithms](https://www.rfc-editor.org/rfc/rfc9864), and active [draft-ietf-cose-hpke-26](https://datatracker.ietf.org/doc/draft-ietf-cose-hpke/). Primary implementation sources are [hpke-js](https://github.com/dajiaji/hpke-js), [panva/hpke](https://github.com/panva/hpke), [noble-curves](https://github.com/paulmillr/noble-curves), [argon2-browser](https://www.npmjs.com/package/argon2-browser), [argon2id](https://www.npmjs.com/package/argon2id), and [@node-rs/argon2](https://www.npmjs.com/package/@node-rs/argon2). These sources support review and provenance mapping; they do not constitute independent review or implementation evidence.

This is a reviewable design and threat-model record only. It does not change plan-tree, product decisions, issue state, runtime, tests, package files, dependencies, data, credentials, or remote state. Browser, CI, provider, OS-mount, and production behavior are not claimed.
