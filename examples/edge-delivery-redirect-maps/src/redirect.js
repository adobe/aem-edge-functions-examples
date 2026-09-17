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
import { AEM_ORIGIN, REDIRECT_MAPS, REDIRECT_STATUS } from "./config.js";
import { getRedirectMap } from "./lib/redirects.js";
import { toLocation } from "./lib/location.js";

/** Incoming request header names forwarded on the pass-through fetch (all others omitted). */
const FORWARDED_INCOMING_HEADER_NAMES = [
  "X-Forwarded-Host",
  "User-Agent",
  "X-AEM-Request-ID",
];

/**
 * @param {Request} req
 * @returns {Headers}
 */
function forwardedOriginHeaders(req) {
  const out = new Headers();
  for (const name of FORWARDED_INCOMING_HEADER_NAMES) {
    const value = req.headers.get(name);
    if (value !== null) {
      out.set(name, value);
    }
  }
  // BYO CDN signalling so Edge Delivery's cache/invalidation stays coherent.
  out.set("X-BYO-CDN-Type", "fastly");
  out.set("X-Push-Invalidation", "enabled");
  return out;
}

/**
 * Redirect lookup for AEM Edge Delivery.
 *
 * Flow (no loopback):
 *   Browser → CDN (your EDS domain) → this function
 *     → check each configured JSON map in order (edge-cached + parsed-memoized)
 *         → 301 (REDIRECT_STATUS) if the path is in a map      ← first match wins
 *       else pass through:
 *         → fetch the same path directly from the EDS origin and return it
 *
 * No loop risk on the miss path: the origin host (AEM_ORIGIN) differs from the
 * customer-facing CDN domain, so the fetch never routes back into this function.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function redirectHandler(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Check each configured map in order; first match wins.
  for (const { sourcePath, redirectCode } of REDIRECT_MAPS) {
    const map = await getRedirectMap(sourcePath);
    if (map) {
      const destination = map.get(pathname);
      if (destination) {
        // A relative Destination is returned as a relative Location, which the
        // browser resolves against the host it requested (your customer domain)
        // — so no customer domain needs to be hardcoded here. Absolute targets
        // (cross-host) pass through verbatim. Each map may set its own
        // redirectCode (301/302); otherwise the default REDIRECT_STATUS applies.
        return new Response(null, {
          status: redirectCode ?? REDIRECT_STATUS,
          headers: { location: toLocation(destination) },
        });
      }
    }
  }

  // No redirect matched: transparent pass-through to the EDS origin.
  // CacheOverride("pass") keeps the Compute service from independently caching
  // this sub-request; the outer CDN still caches the final response as normal.
  const originUrl = `${AEM_ORIGIN}${pathname}${url.search}`;
  return fetch(originUrl, {
    method: request.method,
    headers: forwardedOriginHeaders(request),
    cacheOverride: new CacheOverride("pass"),
  });
}
