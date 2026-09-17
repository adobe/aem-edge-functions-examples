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

/**
 * Resolve a redirect Destination to a `Location` header value.
 *
 * - Absolute URLs (cross-host, e.g. `https://campaign.example.com/x`) pass
 *   through verbatim.
 * - Relative targets are returned as a root-relative Location (leading slash
 *   ensured). Per HTTP, browsers resolve a relative Location against the URL the
 *   visitor requested — i.e. your customer-facing domain — so same-site
 *   redirects need no hardcoded customer host here.
 *
 * @param {string} destination - The Destination from the redirect map.
 * @returns {string} The Location header value.
 */
export function toLocation(destination) {
  if (/^https?:\/\//i.test(destination)) {
    return destination;
  }
  return destination.startsWith("/") ? destination : `/${destination}`;
}
