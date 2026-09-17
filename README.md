# AEM Edge Functions examples

This repository collects **standalone JavaScript examples** for **[AEM Edge Functions](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/edge-functions)**—patterns that work well with **Adobe Experience Manager**. Each example lives entirely under `examples/<name>/` (source, configuration, `package.json`, `Makefile`, and tests) so you can copy, adapt, or deploy it without pulling in unrelated code.

Official product overview, setup, build, deploy, and local development are covered in the [AEM Edge Functions documentation](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/edge-functions).



## Repository layout

| Path | Role |
|------|------|
| `examples/*/` | Individual edge function examples and their documentation |
| `Makefile` | Install dependencies and run tests across all examples |

## Examples

| Example | Description |
|---------|-------------|
| [edge-delivery-transformer](examples/edge-delivery-transformer/README.md) | Fetches Edge Delivery HTML and composes header/footer fragments; demonstrates routing, upstream fetch, and response shaping. |
| [publish-delivery-transformer](examples/publish-delivery-transformer/README.md) | Fetches AEMaaCS publish HTML via a CDN loopback, transforms it at the edge, and returns the result; demonstrates the loopback pattern with `x-edgefunction-request` loop prevention. |
| [edge-delivery-redirect-maps](examples/edge-delivery-redirect-maps/README.md) | Serves URL redirect maps at the edge for Edge Delivery from published JSON sheets; demonstrates ordered JSON-sourced maps with edge + in-memory caching and pass-through on miss (no KV, no loopback). |
| [publish-delivery-redirect-maps](examples/publish-delivery-redirect-maps/README.md) | Serves large-scale URL redirect maps at the edge for AEMaaCS publish; demonstrates KV-sharded lookups and a maintenance endpoint, with the loopback pattern for redirect misses. |

## Local checks

From the repository root:

```bash
make install-examples   # npm ci in each example that has a Makefile
make test               # run tests in every example
```

Use Node.js as required by your toolchain (see the workflow for a version used in CI). For build, deploy, and local serving, follow the [AEM Edge Functions](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/edge-functions) guide and the README inside each example.
