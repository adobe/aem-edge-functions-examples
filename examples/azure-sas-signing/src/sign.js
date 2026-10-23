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

import { SecretStore } from 'fastly:secret-store';
import { CacheOverride } from 'fastly:cache-override';
import * as response from './lib/response.js';
import {
  importSigningKey, generateBlobServiceSasUrl, generateBlobUserDelegationSasUrl,
} from './lib/azure-sas.js';
import { getUserDelegationKey } from './lib/azure-delegation.js';
import { config, ACCOUNT_KEY_SECRET, AZURE_BLOB_BACKEND } from './config.js';

// Import the account key once per instance (account-key variant). `importKey` is
// async, so memoize the promise; a failure clears it so the next request retries.
let accountKeyPromise = null;
function getAccountSigningKey() {
  if (!accountKeyPromise) {
    accountKeyPromise = (async () => {
      const store = new SecretStore('secret_default');
      const entry = await store.get(ACCOUNT_KEY_SECRET);
      if (!entry) throw new Error(`secret '${ACCOUNT_KEY_SECRET}' not found in secret_default`);
      return importSigningKey(entry.plaintext());
    })().catch((err) => {
      accountKeyPromise = null;
      throw err;
    });
  }
  return accountKeyPromise;
}

// Sign one blob with whichever credential variant is configured.
async function signBlobUrl(blob) {
  const c = config();
  const common = {
    account: c.account,
    container: c.container,
    blob,
    ttlSeconds: c.sasTtlSeconds,
    permissions: c.sasPermissions,
    version: c.signedVersion,
    protocol: 'https',
  };

  if (c.authMode === 'user-delegation') {
    const delegation = await getUserDelegationKey();
    const cryptoKey = await importSigningKey(delegation.value);
    return generateBlobUserDelegationSasUrl({ ...common, cryptoKey, delegation });
  }

  // default: account-key
  const cryptoKey = await getAccountSigningKey();
  return generateBlobServiceSasUrl({ ...common, cryptoKey });
}

/**
 * Signs (and delivers) access to a private Azure Blob for requests under the
 * configured protected prefix. Everything else is 404 — this function only guards
 * the protected space (route only that space to it in config/cdn.yaml).
 * @param {Request} req
 * @returns {Promise<Response>}
 */
export async function signHandler(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  const c = config();
  const url = new URL(req.url);
  if (!url.pathname.startsWith(c.protectedPrefix)) return response.notFound();
  const blob = decodeURIComponent(url.pathname.slice(c.protectedPrefix.length));
  if (!blob || blob.endsWith('/')) return response.notFound();

  const { url: signedUrl, expiry } = await signBlobUrl(blob);

  if (c.mode === 'proxy') return proxyBlob(signedUrl, c.sasTtlSeconds);

  // redirect (default): cache the redirect no longer than the SAS is valid, so a
  // shared cache never hands out a URL past its `se=` expiry.
  const maxAge = Math.max(0, c.sasTtlSeconds - 30);
  return new Response(null, {
    status: 302,
    headers: {
      location: signedUrl,
      'cache-control': `public, max-age=${maxAge}`,
      // Surface expiry for debugging; harmless to expose (the SAS carries it anyway).
      'x-sas-expiry': expiry,
    },
  });
}

// MODE='proxy': fetch the blob with the SAS and stream it back under the site
// domain. Requires the Azure origin declared as AZURE_BLOB_BACKEND.
const DROPPED = ['connection', 'keep-alive', 'transfer-encoding'];
async function proxyBlob(signedUrl, ttlSeconds) {
  const res = await fetch(signedUrl, {
    backend: AZURE_BLOB_BACKEND,
    cacheOverride: new CacheOverride('override', { ttl: Math.max(0, ttlSeconds - 30) }),
  });
  const headers = new Headers(res.headers);
  DROPPED.forEach((h) => headers.delete(h));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
