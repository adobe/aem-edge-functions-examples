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

/**
 * The AEM Edge Delivery origin, hardcoded to stay simple and aligned with the
 * publish-delivery-transformer / edge-delivery-transformer examples.
 *
 * Replace `main--repo--owner` with your Edge Delivery URL pattern
 * (`<branch>--<repo>--<owner>`). Both the redirect-map JSON sources and the
 * pass-through (redirect miss) fetch are served from this origin. Because this
 * origin host is DIFFERENT from your customer-facing CDN domain, a redirect
 * miss can fetch the page directly here with no loop — so, unlike the AEMaaCS
 * publish example, this one needs no loopback marker header.
 */
export const AEM_ORIGIN = "https://main--repo--owner.aem.live";

/**
 * Ordered list of redirect-map JSON sources on the Edge Delivery origin.
 *
 * Each entry is an independently-authored map published on the origin (hardcoded
 * here for the example — a real implementer points these at their own published
 * redirect sheets). Maps are checked **in order; the first match wins**, so you
 * can compose several teams' maps (e.g. migration + campaigns) with a clear
 * precedence — the same "check each map in order" model as the AEMaaCS example.
 *
 * Each source is expected to be an Edge Delivery / Helix published sheet:
 *
 *     { "total": N, "offset": 0, "limit": N,
 *       "data": [ { "Source": "/old-path", "Destination": "/new-path" }, ... ] }
 *
 * which is the same shape Edge Delivery serves for a redirects spreadsheet — so
 * a real project can point these straight at its existing published sheet(s).
 * A bare JSON array of `{ Source, Destination }` rows is also accepted.
 *
 * Each entry is `{ sourcePath, redirectCode? }`:
 *   - sourcePath    Path to the published sheet on AEM_ORIGIN.
 *   - redirectCode  Optional 301 (permanent) or 302 (temporary) for this map;
 *                   defaults to REDIRECT_STATUS when omitted. This lets maps
 *                   redirect with different status codes — e.g. a permanent
 *                   migration map alongside a temporary campaigns map.
 */
export const REDIRECT_MAPS = [
  { sourcePath: "/bigredirects.json" },                           // migration — uses default (301)
  { sourcePath: "/marketing-redirects.json", redirectCode: 302 }, // campaigns — temporary
];

/**
 * Default redirect status, used for any map entry that omits `redirectCode`.
 * Edge Delivery's canonical-URL redirects are permanent, so 301 is the default.
 * Per-row status codes are not modelled — extend `parse.js` and the handler if
 * you need them.
 */
export const REDIRECT_STATUS = 301;

/**
 * Cache TTL (seconds) for a redirect-map source, applied at BOTH cache layers
 * (see `lib/redirects.js`): the per-POP edge cache of the fetched JSON and the
 * per-instance in-memory memo of the parsed map. Redirect maps change rarely,
 * so a modest TTL keeps lookups cheap while bounding how long a just-published
 * change can take to become visible.
 */
export const MAP_TTL_SECONDS = 300;
