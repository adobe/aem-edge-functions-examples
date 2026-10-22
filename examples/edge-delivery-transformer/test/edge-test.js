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

import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "fastly:cache-override") {
      return {
        url: "data:text/javascript,export class CacheOverride {}",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
let edgeDeliveryHandler;
try {
  ({ edgeDeliveryHandler } = await import("../src/edge.js"));
} finally {
  hooks.deregister();
}

const page = "<html><header></header><main>Page</main><footer></footer></html>";

function resource(body, options = {}) {
  const headers = new Headers({ "content-type": "text/html", ...options.headers });
  return new Response(body, { ...options, headers });
}

describe("edgeDeliveryHandler", function () {
  let originalFetch;
  let resources;

  beforeEach(function () {
    originalFetch = globalThis.fetch;
    resources = {
      "/": resource(page, {
        headers: {
          "last-modified": "Mon, 19 Oct 2026 08:00:00 GMT",
          "surrogate-key": "page-main page-shared",
        },
      }),
      "/nav.plain.html": resource("Nav", {
        headers: {
          "last-modified": "Tue, 20 Oct 2026 08:00:00 GMT",
          "surrogate-key": "page-shared-nav page-shared",
        },
      }),
      "/footer.plain.html": resource("Footer", {
        headers: {
          "last-modified": "Wed, 21 Oct 2026 08:00:00 GMT",
          "surrogate-key": "page-shared-footer",
        },
      }),
    };
    globalThis.fetch = async (url) => {
      const response = resources[new URL(url).pathname];
      assert.ok(response, `Unexpected upstream URL: ${url}`);
      return response;
    };
  });

  afterEach(function () {
    globalThis.fetch = originalFetch;
  });

  async function handle() {
    return edgeDeliveryHandler(new Request("https://example.com/"));
  }

  describe("Last-Modified", function () {
    it("uses the main document timestamp when it is newest", async function () {
      const newest = "Thu, 22 Oct 2026 08:00:00 GMT";
      resources["/"].headers.set("last-modified", newest);
      const response = await handle();
      assert.equal(response.headers.get("last-modified"), newest);
      assert.equal(response.status, 200);
      assert.equal(
        await response.text(),
        "<html><header>Nav</header><main>Page</main><footer>Footer</footer></html>"
      );
    });

    it("uses the nav timestamp when it is chronologically newest", async function () {
      const newest = "Thu, 22 Oct 2026 08:00:00 GMT";
      resources["/nav.plain.html"].headers.set("last-modified", newest);
      assert.equal((await handle()).headers.get("last-modified"), newest);
    });

    it("uses the footer timestamp when it is newest", async function () {
      assert.equal(
        (await handle()).headers.get("last-modified"),
        "Wed, 21 Oct 2026 08:00:00 GMT"
      );
    });

    it("ignores missing and invalid timestamps", async function () {
      resources["/"].headers.set("last-modified", "invalid-date");
      resources["/nav.plain.html"].headers.delete("last-modified");
      assert.equal(
        (await handle()).headers.get("last-modified"),
        "Wed, 21 Oct 2026 08:00:00 GMT"
      );
    });

    it("omits Last-Modified when no timestamp is valid", async function () {
      resources["/"].headers.set("last-modified", "invalid-date");
      resources["/nav.plain.html"].headers.delete("last-modified");
      resources["/footer.plain.html"].headers.delete("last-modified");
      assert.equal((await handle()).headers.get("last-modified"), null);
    });

    it("preserves headers on responses passed through without composition", async function () {
      const lastModified = "Mon, 19 Oct 2026 08:00:00 GMT";
      const original = resource("Not Found", {
        status: 404,
        headers: { "last-modified": lastModified },
      });
      resources["/"] = original;
      const response = await handle();
      assert.equal(response, original);
      assert.equal(response.headers.get("last-modified"), lastModified);
    });
  });

  describe("Surrogate-Key", function () {
    it("merges and deduplicates keys from the main document, nav, and footer", async function () {
      resources["/"].headers.set("surrogate-key", "page-main page-main page-shared");
      resources["/nav.plain.html"].headers.set("surrogate-key", "page-shared page-shared-nav page-shared-nav");
      resources["/footer.plain.html"].headers.set("surrogate-key", "page-shared-footer page-shared page-main");
      assert.equal(
        (await handle()).headers.get("surrogate-key"),
        "page-main page-shared page-shared-nav page-shared-footer"
      );
    });

    it("ignores missing and blank headers", async function () {
      resources["/nav.plain.html"].headers.delete("surrogate-key");
      resources["/footer.plain.html"].headers.set("surrogate-key", "   ");
      assert.equal((await handle()).headers.get("surrogate-key"), "page-main page-shared");
    });

    it("omits the header when no upstream response has keys", async function () {
      resources["/"].headers.delete("surrogate-key");
      resources["/nav.plain.html"].headers.delete("surrogate-key");
      resources["/footer.plain.html"].headers.delete("surrogate-key");
      assert.equal((await handle()).headers.get("surrogate-key"), null);
    });

    it("preserves main document keys when fragment fetches fail", async function () {
      globalThis.fetch = async (url) => {
        if (new URL(url).pathname === "/") {
          return resources["/"];
        }
        throw new Error("Fragment unavailable");
      };
      assert.equal((await handle()).headers.get("surrogate-key"), "page-main page-shared");
    });

    it("preserves keys on a main response passed through unchanged", async function () {
      resources["/"] = resource("Not Found", {
        status: 404,
        headers: { "surrogate-key": "page-missing" },
      });
      const response = await handle();
      assert.equal(response, resources["/"]);
      assert.equal(response.headers.get("surrogate-key"), "page-missing");
    });
  });
});
