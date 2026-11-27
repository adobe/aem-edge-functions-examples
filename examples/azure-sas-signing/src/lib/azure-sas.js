/*
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

// Azure Storage **service SAS** signing — pure helpers, no `fastly:*` imports, so
// this file runs unmodified in Node for unit tests. Uses only Web Crypto
// (`crypto.subtle`), `atob`/`btoa`, `TextEncoder` — all present in both the
// Fastly Compute sandbox and Node 18+.
//
// Why hand-assemble the SAS instead of using @azure/storage-blob? The SDK's
// SAS generation (StorageSharedKeyCredential / generateBlobSASQueryParameters) is
// Node-only: it relies on node:crypto and is deliberately excluded from the SDK's
// browser build. It will not run in this WASM/Web-API sandbox. Signing a SAS is
// just HMAC-SHA256 over a documented string-to-sign, so we do it with Web Crypto —
// the standard approach for edge runtimes. The only "low-level" part is the field
// order below, which is fixed by the Azure spec and pinned by unit tests.
//
// Tradeoff vs. the SDK: the SDK tracks spec changes for you, whereas this code is
// pinned to a signed version. That is safe because the SAS format is VERSIONED by
// the `sv` parameter — each version has a fixed, documented layout and Azure keeps
// older versions working. So a pinned SIGNED_VERSION (config) stays stable; adopting
// a newer `sv` with new fields is a deliberate change (update the field lists below +
// the tests), never a silent break.
//
// A service SAS `sig` is NOT issued by Azure: it is an HMAC-SHA256 that the holder
// of the storage account key computes locally; Azure only re-computes and compares
// on the incoming request. That is why it is signable at the edge with zero Azure
// round-trips (the account-key variant). See README for the user-delegation variant.
//
// String-to-sign layout follows the Azure REST spec "Create a service SAS"
// (signedVersion 2020-12-06 and later, which includes signedEncryptionScope):
// https://learn.microsoft.com/rest/api/storageservices/create-service-sas

/** Base64 (standard) → bytes. */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes → Base64 (standard). */
function bytesToBase64(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

/**
 * Format a Date as an Azure SAS timestamp: ISO 8601, whole seconds, `Z`
 * (e.g. `2026-09-28T13:00:00Z`). Azure rejects millisecond precision here.
 * @param {Date} date
 * @returns {string}
 */
export function sasTimestamp(date) {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/**
 * Canonicalized resource for a blob service SAS: `/blob/<account>/<container>/<blob>`.
 * Uses the raw (un-encoded) path — encoding happens only in the query string.
 * @param {string} account
 * @param {string} container
 * @param {string} blob  blob name (may contain `/`)
 * @returns {string}
 */
export function canonicalizedBlobResource(account, container, blob) {
  return `/blob/${account}/${container}/${blob}`;
}

/**
 * Build the exact string-to-sign for a blob service SAS. Field order and the
 * empty-string placeholders are significant — do not reorder.
 * @param {object} p
 * @returns {string}
 */
export function buildServiceSasStringToSign(p) {
  return [
    p.permissions || '', // sp
    p.start || '', // st
    p.expiry || '', // se
    p.canonicalizedResource || '', // canonicalized resource
    p.identifier || '', // si (stored access policy id)
    p.ip || '', // sip
    p.protocol || '', // spr
    p.version || '', // sv
    p.resource || '', // sr
    p.snapshot || '', // signed snapshot time
    p.encryptionScope || '', // ses
    p.cacheControl || '', // rscc
    p.contentDisposition || '', // rscd
    p.contentEncoding || '', // rsce
    p.contentLanguage || '', // rscl
    p.contentType || '', // rsct  (no trailing newline)
  ].join('\n');
}

/**
 * Import a base64 HMAC-SHA256 signing key — either the storage **account key**
 * (account-key variant) or a **user-delegation key** (user-delegation variant).
 * @param {string} keyBase64
 * @returns {Promise<CryptoKey>}
 */
export function importSigningKey(keyBase64) {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(keyBase64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * HMAC-SHA256 a string-to-sign and return the Base64 signature (the `sig` value).
 * @param {CryptoKey} cryptoKey
 * @param {string} stringToSign
 * @returns {Promise<string>}
 */
export async function signStringToSign(cryptoKey, stringToSign) {
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(stringToSign));
  return bytesToBase64(sig);
}

/**
 * Generate a signed blob URL with a read-only (by default) service SAS.
 *
 * @param {object} opts
 * @param {CryptoKey} opts.cryptoKey     imported account key (see importAccountKey)
 * @param {string}    opts.account       storage account name
 * @param {string}    opts.container     container name
 * @param {string}    opts.blob          blob name (path within the container)
 * @param {number}    [opts.ttlSeconds=300]
 * @param {string}    [opts.permissions='r']
 * @param {string}    [opts.version='2022-11-02']
 * @param {string}    [opts.protocol='https']  'https' → spr=https
 * @param {string}    [opts.ip]          optional signed IP or range (sip)
 * @param {Date}      [opts.now=new Date()]
 * @returns {Promise<{ url: string, query: string, expiry: string }>}
 */
export async function generateBlobServiceSasUrl(opts) {
  const {
    cryptoKey, account, container, blob,
    ttlSeconds = 300, permissions = 'r', version = '2022-11-02',
    protocol = 'https', ip = '', now = new Date(),
  } = opts;

  const expiry = sasTimestamp(new Date(now.getTime() + ttlSeconds * 1000));
  const resource = 'b'; // blob

  const stringToSign = buildServiceSasStringToSign({
    permissions,
    expiry,
    canonicalizedResource: canonicalizedBlobResource(account, container, blob),
    ip,
    protocol,
    version,
    resource,
  });

  const sig = await signStringToSign(cryptoKey, stringToSign);

  const params = new URLSearchParams();
  params.set('sv', version);
  params.set('sr', resource);
  params.set('sp', permissions);
  params.set('se', expiry);
  if (protocol) params.set('spr', protocol);
  if (ip) params.set('sip', ip);
  params.set('sig', sig);

  const query = params.toString();
  const blobPath = blob.split('/').map(encodeURIComponent).join('/');
  const url = `https://${account}.blob.core.windows.net/${container}/${blobPath}?${query}`;
  return { url, query, expiry };
}

// ─── User-delegation SAS ──────────────────────────────────────────────────────
// A user-delegation SAS is signed with a short-lived **user-delegation key** that
// Azure returns from getUserDelegationKey (obtained with an Entra OAuth token), not
// with the account key. Its string-to-sign carries the delegation-key identity
// (skoid/sktid/skt/ske/sks/skv). Layout per "Create a user delegation SAS",
// signedVersion 2020-12-06 and later:
// https://learn.microsoft.com/rest/api/storageservices/create-user-delegation-sas

/**
 * Build the string-to-sign for a blob user-delegation SAS. 24 fields; order and
 * empty placeholders are significant.
 * @param {object} p
 * @returns {string}
 */
export function buildUserDelegationSasStringToSign(p) {
  return [
    p.permissions || '', // sp
    p.start || '', // st
    p.expiry || '', // se
    p.canonicalizedResource || '', // canonicalized resource
    p.keyObjectId || '', // skoid
    p.keyTenantId || '', // sktid
    p.keyStart || '', // skt
    p.keyExpiry || '', // ske
    p.keyService || '', // sks
    p.keyVersion || '', // skv
    p.authorizedUserObjectId || '', // saoid
    p.unauthorizedUserObjectId || '', // suoid
    p.correlationId || '', // scid
    p.ip || '', // sip
    p.protocol || '', // spr
    p.version || '', // sv
    p.resource || '', // sr
    p.snapshot || '', // signed snapshot time
    p.encryptionScope || '', // ses
    p.cacheControl || '', // rscc
    p.contentDisposition || '', // rscd
    p.contentEncoding || '', // rsce
    p.contentLanguage || '', // rscl
    p.contentType || '', // rsct  (no trailing newline)
  ].join('\n');
}

/**
 * Generate a signed blob URL with a user-delegation SAS.
 *
 * @param {object} opts
 * @param {CryptoKey} opts.cryptoKey  the imported **user-delegation** key
 * @param {string} opts.account
 * @param {string} opts.container
 * @param {string} opts.blob
 * @param {object} opts.delegation    getUserDelegationKey result:
 *   { keyObjectId (skoid), keyTenantId (sktid), keyStart (skt), keyExpiry (ske),
 *     keyService (sks), keyVersion (skv) }
 * @param {number} [opts.ttlSeconds=300]
 * @param {string} [opts.permissions='r']
 * @param {string} [opts.version='2022-11-02']
 * @param {string} [opts.protocol='https']
 * @param {string} [opts.ip]
 * @param {Date}   [opts.now=new Date()]
 * @returns {Promise<{ url: string, query: string, expiry: string }>}
 */
export async function generateBlobUserDelegationSasUrl(opts) {
  const {
    cryptoKey, account, container, blob, delegation,
    ttlSeconds = 300, permissions = 'r', version = '2022-11-02',
    protocol = 'https', ip = '', now = new Date(),
  } = opts;

  const expiry = sasTimestamp(new Date(now.getTime() + ttlSeconds * 1000));
  const resource = 'b';

  const stringToSign = buildUserDelegationSasStringToSign({
    permissions,
    expiry,
    canonicalizedResource: canonicalizedBlobResource(account, container, blob),
    keyObjectId: delegation.keyObjectId,
    keyTenantId: delegation.keyTenantId,
    keyStart: delegation.keyStart,
    keyExpiry: delegation.keyExpiry,
    keyService: delegation.keyService,
    keyVersion: delegation.keyVersion,
    ip,
    protocol,
    version,
    resource,
  });

  const sig = await signStringToSign(cryptoKey, stringToSign);

  const params = new URLSearchParams();
  params.set('sv', version);
  params.set('sr', resource);
  params.set('sp', permissions);
  params.set('se', expiry);
  if (protocol) params.set('spr', protocol);
  if (ip) params.set('sip', ip);
  params.set('skoid', delegation.keyObjectId);
  params.set('sktid', delegation.keyTenantId);
  params.set('skt', delegation.keyStart);
  params.set('ske', delegation.keyExpiry);
  params.set('sks', delegation.keyService);
  params.set('skv', delegation.keyVersion);
  params.set('sig', sig);

  const query = params.toString();
  const blobPath = blob.split('/').map(encodeURIComponent).join('/');
  const url = `https://${account}.blob.core.windows.net/${container}/${blobPath}?${query}`;
  return { url, query, expiry };
}
