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

/// <reference types="@fastly/js-compute" />

// Runtime side of the user-delegation variant: exchange a service-principal client
// secret for an Entra OAuth token, then ask Azure Storage for a user-delegation key.
// Both are cached at module scope (per instance) and refreshed only near expiry — the
// delegation key lasts up to 7 days, the OAuth token ~1 hour — so the vast majority of
// requests do no Azure round-trip and just HMAC locally with the cached key.
//
// Plain Web-API calls (fetch + Web Crypto), no Azure SDK: the @azure/identity /
// @azure/storage-blob packages target Node and do not run in this WASM sandbox
// (see the note in azure-sas.js). The two REST calls here are small and documented.
//
// OAuth (client credentials): https://learn.microsoft.com/entra/identity-platform/v2-oauth2-client-creds-grant-flow
// getUserDelegationKey: https://learn.microsoft.com/rest/api/storageservices/get-user-delegation-key

import { SecretStore } from 'fastly:secret-store';
import { sasTimestamp } from './azure-sas.js';
import { config, SP_CLIENT_SECRET, ENTRA_LOGIN_BACKEND, AZURE_BLOB_BACKEND } from '../config.js';

const REFRESH_MARGIN_SECONDS = 300; // refresh this long before expiry

let tokenCache = null; // { token: string, expiresAtMs: number }
let delegationCache = null; // { value, keyObjectId, ..., expiresAtMs }

function nowMs() {
  return Date.now();
}

async function secret(name) {
  const store = new SecretStore('secret_default');
  const entry = await store.get(name);
  if (!entry) throw new Error(`secret '${name}' not found in secret_default`);
  return entry.plaintext();
}

/** Entra service-principal client-credentials token for Azure Storage. */
async function getOAuthToken() {
  if (tokenCache && tokenCache.expiresAtMs > nowMs()) return tokenCache.token;

  const c = config();
  const clientSecret = await secret(SP_CLIENT_SECRET);
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://storage.azure.com/.default',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      backend: ENTRA_LOGIN_BACKEND,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!res.ok) throw new Error(`Entra token request failed: ${res.status}`);
  const json = await res.json();
  const ttl = Number(json.expires_in) || 3600;
  tokenCache = { token: json.access_token, expiresAtMs: nowMs() + (ttl - REFRESH_MARGIN_SECONDS) * 1000 };
  return tokenCache.token;
}

// Pull one element's text out of the getUserDelegationKey XML. The response is a
// small, fixed document, so a tag match is sufficient (no XML parser in the sandbox).
function xmlValue(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : '';
}

/**
 * Returns a cached-or-fresh user-delegation key and its identity fields (mapped to
 * the SAS query params skoid/sktid/skt/ske/sks/skv).
 * @returns {Promise<{ value: string, keyObjectId: string, keyTenantId: string,
 *   keyStart: string, keyExpiry: string, keyService: string, keyVersion: string }>}
 */
export async function getUserDelegationKey() {
  if (delegationCache && delegationCache.expiresAtMs > nowMs()) return delegationCache;

  const token = await getOAuthToken();
  const c = config();
  const start = new Date();
  const expiry = new Date(start.getTime() + c.delegationKeyTtlSeconds * 1000);
  const keyInfo = `<?xml version="1.0" encoding="utf-8"?><KeyInfo>`
    + `<Start>${sasTimestamp(start)}</Start><Expiry>${sasTimestamp(expiry)}</Expiry></KeyInfo>`;

  const res = await fetch(
    `https://${c.account}.blob.core.windows.net/?restype=service&comp=userdelegationkey`,
    {
      method: 'POST',
      backend: AZURE_BLOB_BACKEND,
      headers: {
        authorization: `Bearer ${token}`,
        'x-ms-version': c.signedVersion,
        'content-type': 'application/xml',
      },
      body: keyInfo,
    },
  );
  if (!res.ok) throw new Error(`getUserDelegationKey failed: ${res.status}`);
  const xml = await res.text();

  const key = {
    value: xmlValue(xml, 'Value'),
    keyObjectId: xmlValue(xml, 'SignedOid'),
    keyTenantId: xmlValue(xml, 'SignedTid'),
    keyStart: xmlValue(xml, 'SignedStart'),
    keyExpiry: xmlValue(xml, 'SignedExpiry'),
    keyService: xmlValue(xml, 'SignedService'),
    keyVersion: xmlValue(xml, 'SignedVersion'),
    // reuse until shortly before the key itself expires
    expiresAtMs: expiry.getTime() - REFRESH_MARGIN_SECONDS * 1000,
  };
  if (!key.value) throw new Error('getUserDelegationKey returned no key value');
  delegationCache = key;
  return key;
}

/** Test hook: clear the module caches. */
export function _resetCaches() {
  tokenCache = null;
  delegationCache = null;
}
