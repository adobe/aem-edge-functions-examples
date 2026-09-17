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
import { toLocation } from '../src/lib/location.js';

describe('toLocation', function () {
  it('passes through absolute URLs verbatim', function () {
    assert.equal(toLocation('https://campaign.example.com/promo'), 'https://campaign.example.com/promo');
    assert.equal(toLocation('http://example.org/x'), 'http://example.org/x');
  });

  it('returns a root-relative target unchanged', function () {
    assert.equal(toLocation('/new-page'), '/new-page');
  });

  it('adds a leading slash to a bare relative target', function () {
    assert.equal(toLocation('new-page'), '/new-page');
  });
});
