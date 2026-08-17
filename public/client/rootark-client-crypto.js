(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("node:crypto").webcrypto);
  else root.RootarkClientCrypto = factory(root.crypto);
}(typeof globalThis === "object" ? globalThis : this, function (cryptoApi) {
  "use strict";

  const subtle = cryptoApi && cryptoApi.subtle;
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function bytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError("A raw 32-byte key is required");
  }

  function keyBytes(value) {
    const result = bytes(value);
    if (result.byteLength !== 32) throw new TypeError("A raw 32-byte key is required");
    return result;
  }

  function base64url(value) {
    const input = bytes(value);
    let binary = "";
    input.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function fromBase64url(value) {
    const text = String(value || "");
    if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new Error("Base64URL invalido");
    const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
    let binary;
    try { binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")); } catch { throw new Error("Base64URL invalido"); }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (base64url(bytes) !== text) throw new Error("Base64URL nao canonico");
    return bytes;
  }

  function canonicalize(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(canonicalize);
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }

  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }

  function contextText(context) {
    return typeof context === "string" ? context : canonicalJson(context);
  }

  async function importKey(rawKey) {
    if (!subtle) throw new Error("Web Crypto indisponivel");
    return subtle.importKey("raw", keyBytes(rawKey), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  async function encryptJson(value, rawKey, context = "Root.ark/client") {
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const aad = textEncoder.encode(contextText(context));
    const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, await importKey(rawKey), textEncoder.encode(canonicalJson(value)));
    return { algorithm: "AES-256-GCM", iv: base64url(iv), ciphertext: base64url(new Uint8Array(ciphertext)), aad: base64url(aad) };
  }

  async function decryptJson(envelope, rawKey, context = "Root.ark/client") {
    if (!envelope || envelope.algorithm !== "AES-256-GCM" || !envelope.iv || !envelope.ciphertext || !envelope.aad) throw new Error("Envelope protegido invalido");
    const aad = fromBase64url(envelope.aad);
    const iv = fromBase64url(envelope.iv);
    const ciphertext = fromBase64url(envelope.ciphertext);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 16) throw new Error("Envelope protegido invalido");
    const expected = textEncoder.encode(contextText(context));
    if (new TextDecoder().decode(aad) !== new TextDecoder().decode(expected)) throw new Error("Contexto protegido invalido");
    const plaintext = await subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, await importKey(rawKey), ciphertext);
    return JSON.parse(textDecoder.decode(plaintext));
  }

  return { canonicalJson, canonicalize, decryptJson, encryptJson, keyBytes };
}));
