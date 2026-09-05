# OpenUse v0.2 usage and cost

## Sources of truth

Gateway model metadata is fetched from the current Vercel AI Gateway catalog endpoint and validated with Zod. The catalog includes model/provider identity, capabilities, context information, and pricing where available. It is cached locally for six hours; Settings has a manual Refresh action. If the request fails, the last valid cache is used; only when no cache exists does OpenUse use the small bundled fallback.

The implementation follows the current Gateway model catalog and REST documentation: [Gateway models and providers](https://vercel.com/docs/ai-gateway/models-and-providers) and [OpenAI-compatible REST API](https://vercel.com/docs/ai-gateway/openai-compat/rest-api). Reasoning is passed through the AI SDK provider-neutral request option where supported; see [AI SDK `generateText`](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text).

## Model picker

The default view includes only models whose validated metadata indicates both tool use and visual/image input. Search and provider filters operate over the parsed catalog. **Show all models** exposes incompatible entries with explicit reasons. Pricing is read from catalog data, including direct and tiered input/output/cache prices; missing pricing is shown as `Pricing unavailable`.

## Actual request cost

After each Gateway request, the provider adapter reads `providerMetadata.gateway.cost`, validates the shape and numeric value, and returns the known actual cost to the main runtime. The task runtime records it once per request and emits the updated task and lifetime totals. Token-derived arithmetic is not used when Gateway provides the charge. Custom endpoints show `Cost: unknown` unless trustworthy pricing is explicitly available through a future configured path.

## 20-step estimate

The model picker shows an approximate comparison, never a guarantee:

```text
≈ (average input tokens per step × candidate input price)
 + (average output/reasoning tokens per step × candidate output price)
 × 20 steps
```

The usage store first prefers recent model-specific averages, then the general OpenUse profile. A new installation starts without fabricated token counts and displays an unavailable estimate until real usage exists. Tiered pricing uses the candidate's configured/catalog tiers rather than a permanent hardcoded Vercel price.

## Ledger

The local privacy-safe ledger stores:

```text
timestamp, model ID, provider, reasoning level, task status,
steps, actions, input tokens, output tokens, known actual cost,
request count, duration
```

It does not store the command, screenshots, passwords, accessibility trees, private window text, file contents, or chain-of-thought. Writes are versioned, migrated defensively, atomic, and queued to avoid corrupting the store.

Settings → Usage shows known total spend, completed tasks, input/output tokens, average task cost, recent model usage, and known versus unpriced requests. The wording is **OpenUse total** / **spend recorded through this OpenUse installation**, not Vercel account spend. Reset requires confirmation.
