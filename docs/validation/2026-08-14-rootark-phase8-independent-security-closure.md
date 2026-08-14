# Root.ark Phase 8 independent security closure — 2026-08-14

## Scope, provenance, and verdict

This is a bounded documentation/evidence correction on the semantic home of PR #54. It does not implement cryptography, add dependencies, change lockfiles, create Phase 9 foundation code, migrate data, or alter runtime behavior.

| Item | Evidence |
|---|---|
| Executor/backend | `biel4` / `app_server` |
| Repository identity | `bielxdh3/root.ark` |
| Branch | `cdx/rootark-roadmap-evidence` |
| Starting docs head | `4a604e43a57ba8368fca35e72ff10dff4e271c71` (`docs(validation): finalize checkout state`) |
| Canonical baseline | `Root/main` / `28747c6ebdac873650e2d5a3c6193824e7cc9985` |
| Live PR | [PR #54](https://github.com/bielxdh3/root.ark/pull/54) |
| Source evidence | `docs/architecture/zero-knowledge-migration-contract.md`, `docs/product-discovery.md`, `docs/plan-tree.md`, `docs/issue-ledger.md`, and the 2026-08-13 validation artifacts |
| Verdict | **`PHASE_8_ACCEPTED_FOR_BOUNDED_PHASE_9_FOUNDATION`** |

Phase 8 is `ACCEPTED` for a bounded Phase 9 foundation. Phase 9 is separately authorized but remains `NOT_STARTED`. Phase 15 remains `RELEASE_GATE_BLOCKED_ENVIRONMENT`. The existing source baseline and publication records are preserved; no merge, release, tag, deploy, force-push, issue-state mutation, repository-setting mutation, or remote publication action occurred in this correction.

## Confirmed standards corrections

The authoritative [draft-ietf-cose-hpke-26 page](https://datatracker.ietf.org/doc/draft-ietf-cose-hpke/) identifies an active Internet-Draft, last updated 2026-07-04, intended for Proposed Standard, and states that Internet-Drafts are work in progress. It is not a final RFC dependency. Root.ark must use final [RFC 9180 HPKE](https://www.rfc-editor.org/rfc/rfc9180.html) directly behind an explicit application envelope. RFC 9180 does not define the application wire format.

If COSE is retained, only final [RFC 9052](https://www.rfc-editor.org/rfc/rfc9052.html) and [RFC 9864](https://www.rfc-editor.org/rfc/rfc9864.html) semantics with pinned fully specified algorithms may be used. Root.ark must not describe a `COSE_Encrypt0`-style object with an invented recipient structure as final standards semantics. The active draft is cited only as work in progress and interoperability context.

## Root.ark `rootark-zk-1` envelope profile

The application wire profile is an explicit deterministic CBOR envelope under [RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html). Direct RFC 9180 supplies HPKE `enc`, the HPKE ciphertext, and the selected suite operations. The profile is not a draft COSE wire format.

Field requirements are:

- `envelope_version`: unsigned integer `0..65535`; `suite`: exact text `rootark-zk-1`.
- `compartment_id`, `object_id`, `version_id`, `key_ref`, `sender_key_id`, `recipient_key_id`, `replay_id`, and `idempotency_key`: definite byte strings, each `1..128` bytes; `wrap_id` is exactly 16 CSPRNG bytes and is never reused.
- `purpose`: registered text `content`, `derived-data`, `key-wrap`, `recovery-package`, or `authorization`.
- `epoch`: unsigned integer `0..2^64-1`; `expiry`: unsigned Unix seconds `0..2^63-1`.
- `hpke_enc`: exactly 32 bytes for X25519; each digest is exactly 32 bytes; Ed25519 public keys are 32 bytes and signatures are 64 bytes. The frozen HPKE tuple is `mode=0x00`, `kem_id=0x0020`, `kdf_id=0x0001`, `aead_id=0x0002`.

The parser uses deterministic RFC 8949 preferred serialization, definite lengths, shortest integer/length encodings, and deterministic length-first map-key ordering. Duplicate keys, indefinite-length items, non-preferred encodings, unsupported tags, floats, trailing bytes, unknown required fields, out-of-range values, unknown suites, rejected versions, and parser errors fail closed before decryption or publication. Operational creation, observation, routing, quota, and provider timestamps are separate metadata and are not silently inserted into authenticated bytes.

The exact authenticated bytes use a two-stage construction to prevent circularity:

1. Perform the base-mode HPKE encapsulation first and obtain `hpke_enc`; then define `manifest_core_map` with exactly `type`, `suite`, `envelope_version`, `compartment_id`, `epoch`, `purpose`, `sender_key_id`, `recipient_key_id`, `object_id`, `version_id`, `key_ref`, `expiry`, `replay_id`, `idempotency_key`, `wrap_id`, and `hpke_enc`. Encode `manifest_core_bytes = deterministic_cbor(manifest_core_map)` and compute `manifest_core_digest = SHA-256(manifest_core_bytes)`.
2. Define `aad_map = {"profile":"rootark-zk-1/aad/v1","suite":"rootark-zk-1","envelope_version":envelope_version,"compartment_id":compartment_id,"epoch":epoch,"purpose":purpose,"object_id":object_id,"version_id":version_id,"key_ref":key_ref,"wrap_id":wrap_id,"manifest_core_digest":manifest_core_digest}` and `aad = deterministic_cbor(aad_map)`.
3. Define `info_map = {"profile":"rootark-zk-1/hpke-info/v1","suite":"rootark-zk-1","envelope_version":envelope_version,"compartment_id":compartment_id,"epoch":epoch,"purpose":purpose,"object_id":object_id,"version_id":version_id,"key_ref":key_ref,"sender_key_id":sender_key_id,"recipient_key_id":recipient_key_id,"wrap_id":wrap_id,"manifest_core_digest":manifest_core_digest}` and `info = ASCII("Root.ark/zk-1/hpke-info/v1") || 0x00 || deterministic_cbor(info_map)`; compute `hpke_info_digest = SHA-256(info)`.
4. After HPKE wrapping and content AEAD have produced their outputs, compute `wrapped_key_digest = SHA-256(wrapped_key)` and `ciphertext_digest = SHA-256(ciphertext)`. Build `manifest_map` by appending `hpke_info_digest`, `wrapped_key_digest`, and `ciphertext_digest` to the exact `manifest_core_map`; encode `manifest_bytes = deterministic_cbor(manifest_map)` and sign the final bytes as specified below. The HPKE operation uses the exact `info` and `aad` bytes; neither uses `manifest_bytes`, so this ordering prevents circularity. This construction is frozen for the bounded foundation; vectors and executable proof belong to Phase 9+.

## HPKE base-mode sender authorization

RFC 9180 base mode authenticates the recipient’s possession of the private key; it does not authenticate the sender, and authenticated-HPKE modes are rejected alternatives. Every accepted wrap therefore requires an Ed25519 authorization manifest independent of HPKE success.

Define `manifest_core_map` with exactly these fields: `type`=`rootark-authorization-manifest-v1`, `suite`, `envelope_version`, `compartment_id`, `epoch`, `purpose`, `sender_key_id`, `recipient_key_id`, `object_id`, `version_id`, `key_ref`, `expiry`, `replay_id`, `idempotency_key`, `wrap_id`, and `hpke_enc`. After the two-stage construction above, `manifest_map` appends exactly `hpke_info_digest`, `wrapped_key_digest`, and `ciphertext_digest`. `idempotency_key` and `wrap_id` are definite byte strings `1..128` bytes.

The exact signed bytes are `manifest_bytes = deterministic_cbor(manifest_map)` and `signature_input = ASCII("Root.ark/zk-1/authorization-manifest/v1") || 0x00 || manifest_bytes`. Ed25519 signs `signature_input`, never a language object or a non-canonical map. Verification uses the already-authorized sender key and rejects a bad signature, sender/recipient mismatch, wrong compartment/epoch/purpose, expired or revoked sender, replayed or duplicate idempotency value, wrong object/version/key reference, `hpke_enc` mismatch, `hpke_info_digest` mismatch, or wrapped-key/ciphertext digest mismatch before decrypt, restore, sync, migration, or publication.

## GCM wrapping nonce decision

The fixed wrapping construction is one-shot per-wrap AES-256-GCM under the CER. Compute `prk = HKDF-Extract(empty salt, CER IKM)`, then `wrap_key = HKDF-Expand(prk, ASCII("Root.ark/zk-1/key-wrap/v1") || 0x00 || deterministic_cbor({suite, compartment_id, epoch, purpose, object_id, version_id, key_ref, recipient_key_id, wrap_id}), 32)`. `wrap_id` is exactly 16 CSPRNG bytes and is never reused. Use a fresh 12-byte CSPRNG nonce for the single-use `wrap_key`; `wrapped_key` is exactly `nonce || AES-256-GCM(wrap_key, nonce, exact_aad, wrapped_key_plaintext) || 16-byte tag` for the 32-byte wrapped key. Retry, crash, rollback, restore ambiguity, collision, or reuse burns the identifier and derived key and allocates a new pair; fail closed on any ambiguity. A durable CER nonce ledger or alternative wrapping construction is not permitted because single-use derived keys eliminate that ledger.

This exact construction is a Phase 8 design decision. Its vectors, implementation, crash/retry execution, and restore proof are Phase 9+ work; no Phase 8 blocker remains for lack of executable evidence.

## Fresh attacker matrix and classifications

| Attacker/failure | Required control and evidence | Classification |
|---|---|---|
| Server or administrator compromise | No ordinary service/admin decryption path; client-held keys, manifest verification, and no plaintext fallback are frozen design controls; negative tests/log review are Phase 9+. | `IMPLEMENTATION_PHASE_REQUIREMENT` |
| Stolen storage, database, or backup | Authenticated envelopes, opaque identifiers, ciphertext-only backup, leakage register, and truthful erasure inventory are frozen design controls; proof is Phase 9+. | `IMPLEMENTATION_PHASE_REQUIREMENT`; `RESIDUAL_ACCEPTED_RISK` |
| Compromised or revoked device | Signed device authorization, epoch increment, future-content rotation, replay fencing, and explicit historical re-encryption are frozen controls; execution is Phase 9+. | `IMPLEMENTATION_PHASE_REQUIREMENT` |
| Malicious recipient or public-link holder | Server-blind wrapped-key delivery, expiry/revocation, recipient-copy warning, and no retroactive-revocation promise | `GENUINE_OWNER_DECISION`; `IMPLEMENTATION_PHASE_REQUIREMENT` |
| Recovery-package compromise | Password protection, package verification, rotation, compromise response, and separation of login/content recovery are frozen controls; execution is Phase 9+. | `IMPLEMENTATION_PHASE_REQUIREMENT` |
| Replay, rollback, or downgrade | Exact manifest replay/idempotency, monotonic epoch/version state, restore fencing, and fail-closed old/unknown state are frozen controls; execution is Phase 9+. | `IMPLEMENTATION_PHASE_REQUIREMENT` |
| Provider substitution or malicious cloud state | Provider identity, key containment, authenticated digests, failure injection, and provider-backed validation | `ENVIRONMENT_DEPENDENT_VALIDATION` |
| Synchronization races | Authenticated versions/epochs, opaque transport, idempotency, and client conflict authority are frozen controls; concurrent/offline fixtures are Phase 9+, while conflict UX remains owner policy. | `IMPLEMENTATION_PHASE_REQUIREMENT`; `GENUINE_OWNER_DECISION` |
| Local bridge crash or compromise | Local authorization, OS key storage, minimized encrypted cache, atomic ciphertext writes, crash journal, and endpoint boundary | `IMPLEMENTATION_PHASE_REQUIREMENT` |
| Backup/restore rollback | Ciphertext-only archive, digest verification, restore fencing, key-destruction inventory, and explicit rollback labels are frozen controls; proof is Phase 9+. | `IMPLEMENTATION_PHASE_REQUIREMENT` |
| Supply-chain/library compromise | Frozen candidate policy and observed integrity are recorded; vectors, transitive provenance, reproducibility, backend, and interoperability are Phase 9+/release evidence. Formal-audit absence alone is residual risk. | `IMPLEMENTATION_PHASE_REQUIREMENT`; `RESIDUAL_ACCEPTED_RISK` |
| Metadata/traffic/timing leakage | Deployment leakage register; no stronger claim than D-003/D-009 support | `RESIDUAL_ACCEPTED_RISK` |

## Library and Argon2id provenance matrix

The following versions and integrity values are read-only npm metadata observations from 2026-08-14. They are not formal audits, endorsements, reproducible-build results, or dependency selections.

| Candidate | Observed version/integrity | Primary source and caveat | Disposition |
|---|---|---|---|
| `@hpke/core` + `@hpke/dhkem-x25519` Phase 9 candidate | 1.9.0, `sha512-pFxWl1nNJeQCSUFs7+GAblHvXBCjn9EPN65vdKlYQil2aURaRxfGMO6vBKGqm1YHTKwiAxJQNEI70PbSowMP9Q==`; 1.8.0, `sha512-S1MWWkAfu+TFxySgv5+P3O4Mx/jk7BsoplzQaA1s3sfUJVJ2UsZsSzSsMc+FXJumLXncoJFlO6mK6mDGspfmA==` | [hpke-js](https://github.com/dajiaji/hpke-js); candidate only, not installed or production evidence. Exact vectors, pinned transitive provenance, reproducible artifacts, backend support, and interoperability remain Phase 9/release work. | `IMPLEMENTATION_PHASE_REQUIREMENT` |
| Non-selected `hpke` + `@panva/hpke-noble` provenance | 1.1.4, `sha512-cPzmFEsiyNnD7281X5WeZ461mbH+3P+rjWMSNrLO5rks7dAJvFXAyMwCmorB61pxt+jBnd0GQ6CY43TqOxmhCQ==`; 1.1.4, `sha512-+bOeaH/9XP8FlRqSHOy2zDEAG/SMnDfvxGlBh0bIYtEvt6vP3fkInpwV/pdtde7dF1Ujw3pUVMzYfCDPQ3nZZw==` | [panva/hpke](https://github.com/panva/hpke); provenance only, not an alternative `rootark-zk-1` suite. | Later interoperability, provenance, and reproducibility review is Phase 9/release work; formal-audit absence alone is residual risk. | `RESIDUAL_ACCEPTED_RISK` |
| `@noble/curves`, `@noble/ciphers`, `@noble/hashes` provenance | `@noble/curves` 2.3.0, `sha512-v7cY+4oWYPQszRj6ZFGzTVL7uP2TaLo1xMhWHzYC5wj0ZhOXQ5x+sBre8rF3hi8cAoi0bh1qXoovoOkdFtvqEg==`; `@noble/ciphers` 2.3.0, `sha512-Clu/xdfgVTf9o7ngLOURaxePwR0j8sjclKEtVij10/jGulwFsPWCvvRgG/XjUVf8Nei+jLG6uwyXzUTGY1DQrw==`; `@noble/hashes` 2.3.0, `sha512-oN+QwyX7VSHotibwubG3kpzbwKrfnyR6OOO+3Nk/53ADL7FmgHHz4TgrbaYKvvOw09u6QTx0oiH1cNCIOuN0CQ==` | [noble-curves](https://github.com/paulmillr/noble-curves); primitive provenance only, not the selected suite boundary. | Vectors, backend assumptions, reproducibility, maintenance, and JS zeroization remain Phase 9/release work. | `RESIDUAL_ACCEPTED_RISK` |
| Browser Argon2id provenance | 1.18.0, `sha512-ImVAGIItnFnvET1exhsQB7apRztcoC5TnlSqernMJDUjbc/DLq3UEYeXFrLPrlaIl8cVfwnXb6wX2KpFf2zxHw==` | [npm argon2-browser](https://www.npmjs.com/package/argon2-browser); read-only candidate provenance, not the frozen policy. | Browser vectors, reproducibility, and JS/WASM memory behavior remain Phase 9/release work; formal-audit absence is residual risk. | `RESIDUAL_ACCEPTED_RISK` |
| JavaScript Argon2id provenance | 1.0.1, `sha512-rsiD3lX+0L0CsiZARp3bf9EGxprtuWAT7PpiJd+Fk53URV0/USOQkBIP1dLTV8t6aui0ECbymQ9W9YCcTd6XgA==` | [npm argon2id](https://www.npmjs.com/package/argon2id); read-only candidate provenance, not the frozen policy. | Browser/Node support, vectors, maintenance, and memory behavior remain Phase 9/release work. | `RESIDUAL_ACCEPTED_RISK` |
| Node-native Argon2id provenance | 2.1.0, `sha512-VBOWfM2u58/to3DFqTGJ2U5cJKQwmjN2zxzsQNZ5a2o8Z6aUrhvqQh8NdgotIF1Y0tMsBNtzOBDBdfvvkwJDSQ==` | [npm @node-rs/argon2](https://www.npmjs.com/package/@node-rs/argon2); read-only Node-native candidate provenance, not the frozen policy. | Browser closure, backend, vectors, reproducibility, maintenance, and zeroization remain Phase 9/release work. | `RESIDUAL_ACCEPTED_RISK` |
| Frozen browser/Node Argon2id policy | `libsodium-wrappers-sumo` 0.8.4, `sha512-ql7hcgulKZ3ekfa2DGAogcCKsWU0diA/0nArz1CFzh93WQdb46/Kj18ka/Hifq6uA3Ush34Pc6vU/6HXeRwUkg==` | [jedisct1/libsodium.js](https://github.com/jedisct1/libsodium.js); candidate-only Node capability evidence. | After `await ready`, a narrow adapter calls only `crypto_pwhash` with `crypto_pwhash_ALG_ARGON2ID13`, 32-byte output, unique 16-byte salt, and recorded `opslimit`/`memlimit`; it never exposes the sumo surface or uses `ALG_DEFAULT`. Browser vectors/reproducibility remain Phase 9 work; JS/WASM zeroization is limited. | `IMPLEMENTATION_PHASE_REQUIREMENT` |

The frozen libsodium-wrappers-sumo policy parameterizes browser/Node Argon2id use without claiming installation or production evidence. Missing dependency/network/native evidence is `ENVIRONMENT_DEPENDENT_VALIDATION`; browser vectors, reproducibility, backend execution, and JS/WASM memory handling remain Phase 9/release work, not Phase 8 blockers.

## Genuine owner decisions only

Technical decisions above are architecture/security decisions, not owner-packet questions. Genuine owner decisions are limited to sharing/public-link UX and recipient recovery, recovery authority, mixed-mode migration window/UX, synchronization conflict UX/authority, and any remaining 2FA policy. Those policy choices do not block safe parameterization of the accepted design; they do not authorize a product claim that Root.ark is zero-knowledge today.

## Phase 9 entry criteria and final disposition

Phase 9 foundation work is separately authorized by this accepted design but remains `NOT_STARTED`. Phase 9+ must execute exact vectors, cross-client interoperability, fuzz/property coverage, device/recovery/rotation/compromise tests, bridge crash safety, migration rollback/downgrade resistance, ciphertext-only backup/restore proof, candidate provenance/reproducibility/backend checks, and available provider/browser/CI/production validation. Concrete incompatibility, unverifiable artifacts, or irreproducibility block Phase 9 progression. Genuine owner decisions remain limited to the product policies above.

**Final verdict: `PHASE_8_ACCEPTED_FOR_BOUNDED_PHASE_9_FOUNDATION`.** Phase 8 is `ACCEPTED`; Phase 9 is separately authorized but `NOT_STARTED`. No Phase 9 foundation or runtime cryptography was executed. This report is architecture/evidence only and does not claim current zero-knowledge behavior or release readiness.

## Validation boundary

Allowed docs-only checks are `git diff --check` and a scoped secret scan. Dependency-backed tests, cryptographic vectors, interoperability, provider behavior, browser behavior, production behavior, OS WebDAV, live ClamAV, and native bindings are not claimed by this report.

## Primary sources

- [draft-ietf-cose-hpke-26](https://datatracker.ietf.org/doc/draft-ietf-cose-hpke/)
- [RFC 9180 HPKE](https://www.rfc-editor.org/rfc/rfc9180.html)
- [RFC 9052 COSE](https://www.rfc-editor.org/rfc/rfc9052.html)
- [RFC 9864 fully specified algorithms](https://www.rfc-editor.org/rfc/rfc9864.html)
- [hpke-js](https://github.com/dajiaji/hpke-js), [panva/hpke](https://github.com/panva/hpke), [noble-curves](https://github.com/paulmillr/noble-curves)
- [argon2-browser](https://www.npmjs.com/package/argon2-browser), [argon2id](https://www.npmjs.com/package/argon2id), [@node-rs/argon2](https://www.npmjs.com/package/@node-rs/argon2)
