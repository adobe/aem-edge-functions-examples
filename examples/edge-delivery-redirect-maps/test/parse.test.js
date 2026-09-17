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

import assert from 'assert';
import { readFileSync } from 'fs';
import { parseRedirectSheet } from '../src/lib/parse.js';

describe('parseRedirectSheet', function () {
  it('parses the EDS/Helix published sheet shape', function () {
    const text = readFileSync(new URL('./sample-bigredirects.json', import.meta.url), 'utf8');
    const map = parseRedirectSheet(text);
    assert.equal(map.get('/old-home'), '/');
    assert.equal(map.get('/legacy/about'), '/company/about');
    assert.equal(map.get('/promo'), 'https://campaign.example.com/promo');
    assert.equal(map.size, 3);
  });

  it('accepts a bare array of rows', function () {
    const map = parseRedirectSheet('[{"Source":"/a","Destination":"/b"}]');
    assert.equal(map.get('/a'), '/b');
  });

  it('accepts lowercase field names', function () {
    const map = parseRedirectSheet('{"data":[{"source":"/a","destination":"/b"}]}');
    assert.equal(map.get('/a'), '/b');
  });

  it('skips incomplete rows and keeps the first occurrence of a Source', function () {
    const map = parseRedirectSheet(
      '{"data":[{"Source":"/a"},{"Source":"/a","Destination":"/b"},{"Source":"/a","Destination":"/c"}]}'
    );
    assert.equal(map.get('/a'), '/b');
    assert.equal(map.size, 1);
  });

  it('returns an empty map when data is missing', function () {
    assert.equal(parseRedirectSheet('{}').size, 0);
  });
});
