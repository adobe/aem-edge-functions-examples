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

import { CacheOverride } from "fastly:cache-override";
import { AEM_ORIGIN, MAP_TTL_SECONDS } from "../config.js";
import { parseRedirectSheet } from "./parse.js";

/**
 * Two-layer cache for redirect maps so lookups avoid both the network fetch and
 * the JSON parse whenever possible:
 *
 *   Layer A — per-POP edge cache of the fetched JSON bytes, via Fastly's
 *             readthrough cache (`CacheOverride("override", { ttl })`), keyed by
 *             the source URL and SHARED ACROSS ALL INSTANCES AT A POP. `override`
 *             applies our TTL regardless of the origin's cache headers.
 *   Layer B — per-instance in-memory memo of the PARSED map (this module-scope
 *             Map). A warm Compute instance reuses the parsed map across the
 *             requests it serves, skipping the parse entirely. Best-effort:
 *             not shared across instances, lost on cold start, bounded by the
 *             TTL. Never relied on for correctness — only optimization.
 *
 * Three-tier outcome per lookup:
 *   - Layer B hit (warm instance) → no fetch, no parse (just a Map read).
 *   - Layer B miss, Layer A hit (cold/new/recycled instance, or after memo TTL)
 *     → cheap POP-cached fetch (no origin round-trip) + parse, then re-memoize.
 *     Because Layer A is POP-shared, one instance's fetch warms it for others.
 *   - Both miss (cold POP, or after Layer-A TTL) → origin fetch + parse.
 *
 * @type {Map<string, { map: Map<string,string>, expiresAt: number }>}
 */
const parsedCache = new Map();

/**
 * Fetch a redirect-map source as text. The readthrough cache (Layer A) serves
 * it from the POP on subsequent requests across instances. Returns null if the
 * source is unavailable.
 *
 * @param {string} sourcePath
 * @returns {Promise<string|null>}
 */
async function fetchMapText(sourcePath) {
  const res = await fetch(`${AEM_ORIGIN}${sourcePath}`, {
    headers: { Accept: "application/json" },
    cacheOverride: new CacheOverride("override", { ttl: MAP_TTL_SECONDS }),
  });
  if (!res.ok) return null;
  return await res.text();
}

/**
 * Return the parsed redirect map for a source, using Layer B (parsed memo) when
 * fresh, otherwise refilling via Layer A / origin and re-parsing. If the source
 * is momentarily unavailable or malformed, a previously-parsed (stale) map is
 * kept in use rather than dropping redirects.
 *
 * @param {string} sourcePath
 * @returns {Promise<Map<string,string>|null>}
 */
export async function getRedirectMap(sourcePath) {
  const now = Date.now();

  const memo = parsedCache.get(sourcePath);
  if (memo && memo.expiresAt > now) {
    return memo.map; // Layer B hit: no fetch, no parse.
  }

  const text = await fetchMapText(sourcePath);
  if (text === null) {
    // Origin unavailable — serve the last good map if we have one.
    return memo ? memo.map : null;
  }

  let map;
  try {
    map = parseRedirectSheet(text);
  } catch {
    // Malformed JSON — keep the last good map if we have one, else skip.
    return memo ? memo.map : null;
  }

  parsedCache.set(sourcePath, {
    map,
    expiresAt: now + MAP_TTL_SECONDS * 1000,
  });
  return map;
}
