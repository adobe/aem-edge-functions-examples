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
 * Parse an Edge Delivery / Helix published redirect sheet into a lookup map.
 *
 * Accepts the single-sheet published shape:
 *   { "total": N, "offset": 0, "limit": N,
 *     "data": [ { "Source": "/old", "Destination": "/new" }, ... ] }
 * or a bare array of `{ Source, Destination }` rows. Field names are matched
 * case-insensitively for the two common spellings (`Source`/`source`,
 * `Destination`/`destination`). Rows missing either field are skipped.
 *
 * Within a single file the first occurrence of a Source wins (later duplicates
 * are ignored); across files, precedence is by the order of REDIRECT_MAPS.
 *
 * @param {string} text - Raw JSON text of the published sheet.
 * @returns {Map<string, string>} Map of source path -> destination.
 */
export function parseRedirectSheet(text) {
  const json = JSON.parse(text);
  const rows = Array.isArray(json)
    ? json
    : Array.isArray(json?.data)
      ? json.data
      : [];

  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const source = row.Source ?? row.source;
    const destination = row.Destination ?? row.destination;
    if (
      typeof source === "string" &&
      source.length > 0 &&
      typeof destination === "string" &&
      destination.length > 0 &&
      !map.has(source)
    ) {
      map.set(source, destination);
    }
  }
  return map;
}
