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

const AEM_ORIGIN = "https://main--repo--org.aem.live";

/** Incoming request header names allowed on upstream AEM fetches (all others are omitted). */
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
  return out;
}

/**
 * @param {string} url
 * @param {Headers} requestHeaders — allowlisted incoming headers only (see {@link FORWARDED_INCOMING_HEADER_NAMES})
 * @returns {Promise<{ res: Response | null, text: string | null }>}
 */
async function safeFetchText(url, requestHeaders) {
  try {
    const headers = new Headers(requestHeaders);
    headers.set("X-BYO-CDN-Type", "fastly");
    headers.set("X-Push-Invalidation", "enabled");
    headers.set("Accept", "text/html");
    headers.set("Accept-Encoding", "identity");

    // don ot cache the response because the edge function is not authomerically purged by Edge Delivery
    const res = await fetch(url, {
      headers,
      cacheOverride: new CacheOverride("pass"),
    });

    // Uncomment for debugging: logs request/response headers for each upstream fetch.
    // console.log("safeFetchText", url, "request headers:", Object.fromEntries(headers), "response headers:", Object.fromEntries(res.headers));

    if (!res.ok) {
      return { res, text: null };
    }
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return { res, text: null };
    }

    const text = await res.text();
    return { res, text };
  } catch {
    return { res: null, text: null };
  }
}

/**
 * Fetches HTML from AEM Edge Delivery and stitches nav + footer fragments into the document.
 * Mirrors the composition pattern used for AEM Live pages (header/footer plain HTML).
 *
 * @param {Request} req
 * @param {string} mountPath — URL prefix served by this handler (e.g. `"/edge"`); stripped from `req` pathname for the AEM document path
 */
async function edgeDeliveryHandler(req, mountPath = "/") {
  try {
    const url = new URL(req.url);
    const requestHeaders = forwardedOriginHeaders(req);

    let mount = mountPath.startsWith("/") ? mountPath : `/${mountPath}`;
    mount = mount.endsWith("/") ? mount : `${mount}/`;
    let path;
    if (url.pathname.startsWith(mount)) {
      path = url.pathname.slice(mount.length) || "/";
    } else {
      return new Response("Not Found", { status: 404 });
    }

    const mainUrl = `${AEM_ORIGIN}${path}${url.search}`;
    const { res: mainResp, text: html } = await safeFetchText(
      mainUrl,
      requestHeaders
    );

    if (!mainResp) {
      return new Response("Internal Edge Error", { status: 500 });
    }

    if (!mainResp.ok || !html) {
      return mainResp;
    }

    const [
      { res: navRes, text: headerHtml },
      { res: footerRes, text: footerHtml },
    ] = await Promise.all([
      safeFetchText(`${AEM_ORIGIN}/nav.plain.html`, requestHeaders),
      safeFetchText(`${AEM_ORIGIN}/footer.plain.html`, requestHeaders),
    ]);

    // This can be done more efficinetly with fastly-javascript-sdk https://www.fastly.com/blog/rewriting-html-with-the-fastly-javascript-sdk
    const modified = html
      .replace(/<header([^>]*)>/i, `<header$1>${headerHtml ?? ""}`)
      .replace(/<footer([^>]*)>/i, `<footer$1>${footerHtml ?? ""}`);

    const responseHeaders = new Headers(mainResp.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding");

    const lastModifiedTimes = [mainResp, navRes, footerRes]
      .map((res) => Date.parse(res?.headers.get("last-modified") ?? ""))
      .filter(Number.isFinite);
    if (lastModifiedTimes.length > 0) {
      responseHeaders.set(
        "Last-Modified",
        new Date(Math.max(...lastModifiedTimes)).toUTCString()
      );
    } else {
      responseHeaders.delete("last-modified");
    }

    // Should pass through all surrogate keys from upstream responses so that the CDN can invalidate the cache.
    const surrogateKeyArray = [mainResp, navRes, footerRes].flatMap(
      (res) => {
        const raw = res?.headers.get("surrogate-key");
        return raw && raw.trim() ? raw.trim().split(" ") : [];
      }
    );
    const surrogateKeys = new Set(surrogateKeyArray);
    if (surrogateKeys.size > 0) {
      responseHeaders.set("Surrogate-Key", [...surrogateKeys].join(" "));
    }

    return new Response(modified, {
      status: mainResp.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("edgeDeliveryHandler error:", err);
    return new Response("Internal Edge Error", { status: 500 });
  }
}

export { edgeDeliveryHandler };
