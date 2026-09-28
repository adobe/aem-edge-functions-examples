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

import { ConfigStore } from 'fastly:config-store';

// Runtime configuration lives in the Config Store (`config_default`) — declared in
// config/edgeFunctions.yaml under `configs:` and seeded for local `serve` in
// fastly.toml. Configure a deployment there, not in code. These DEFAULTS apply only
// when an entry is missing. Secret VALUES (account key / SP client secret) live in
// the Secret Store; only their entry NAMES are in code (below).
const DEFAULTS = {
  AUTH_MODE: 'account-key', // 'account-key' | 'user-delegation'
  AZURE_STORAGE_ACCOUNT: 'mystorageaccount',
  AZURE_BLOB_CONTAINER: 'private-assets',
  PROTECTED_PREFIX: '/secure-assets/', // keep in sync with config/cdn.yaml routing
  MODE: 'redirect', // 'redirect' | 'proxy'
  SAS_TTL_SECONDS: '300',
  SAS_PERMISSIONS: 'r',
  SIGNED_VERSION: '2022-11-02',
  AZURE_TENANT_ID: '00000000-0000-0000-0000-000000000000', // user-delegation only
  AZURE_CLIENT_ID: '00000000-0000-0000-0000-000000000000', // user-delegation only
  DELEGATION_KEY_TTL_SECONDS: '86400', // user-delegation only; Azure caps at 7 days
};

let cache = null;

/**
 * Read the runtime configuration once (memoized). Values come from `config_default`
 * with DEFAULTS as fallback, so a missing entry never crashes the function. Read at
 * request time (not module init), matching the Config Store usage in lib/log.js.
 * @returns {object}
 */
export function config() {
  if (cache) return cache;
  let store = null;
  try {
    store = new ConfigStore('config_default');
  } catch {
    store = null;
  }
  const get = (key) => {
    let value = null;
    if (store) {
      try {
        value = store.get(key);
      } catch {
        value = null;
      }
    }
    return value === null || value === undefined || value === '' ? DEFAULTS[key] : value;
  };
  cache = {
    authMode: get('AUTH_MODE'),
    account: get('AZURE_STORAGE_ACCOUNT'),
    container: get('AZURE_BLOB_CONTAINER'),
    protectedPrefix: get('PROTECTED_PREFIX'),
    mode: get('MODE'),
    sasTtlSeconds: Number(get('SAS_TTL_SECONDS')),
    sasPermissions: get('SAS_PERMISSIONS'),
    signedVersion: get('SIGNED_VERSION'),
    tenantId: get('AZURE_TENANT_ID'),
    clientId: get('AZURE_CLIENT_ID'),
    delegationKeyTtlSeconds: Number(get('DELEGATION_KEY_TTL_SECONDS')),
  };
  return cache;
}

// Structural constants that MUST match config/edgeFunctions.yaml + fastly.toml (the
// Secret Store entry names and the declared origin/backend names), so they stay in
// code rather than the Config Store.
export const ACCOUNT_KEY_SECRET = 'AZURE_STORAGE_ACCOUNT_KEY'; // Secret Store (account-key)
export const SP_CLIENT_SECRET = 'AZURE_SP_CLIENT_SECRET'; // Secret Store (user-delegation)
export const AZURE_BLOB_BACKEND = 'azure-blob'; // origin: storage account
export const ENTRA_LOGIN_BACKEND = 'azure-login'; // origin: Entra login (user-delegation)
