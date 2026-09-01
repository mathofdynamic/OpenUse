# Third-party notices

OpenUse is an independent implementation. No source code from the projects below is copied into this repository; their public architecture and documentation were inspected as research references.

## T3 Code

T3 Code is MIT licensed. Research references:

- https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md
- https://github.com/pingdotgg/t3code/blob/main/docs/internals/workspace-layout.md
- https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md

## OpenAI Codex

OpenAI Codex is Apache-2.0 licensed. OpenUse does not copy or depend on proprietary Codex Desktop, `@oai/sky`, `cua_repl`, or packaged native controller components.

Research references:

- https://github.com/openai/codex/blob/main/codex-rs/config/src/computer_use.rs
- https://github.com/openai/codex/blob/main/codex-rs/core/src/context/node_repl_review_evidence.rs
- https://github.com/openai/codex/blob/main/codex-rs/core/src/guardian/mod.rs

## Vercel AI SDK

The Vercel AI SDK and its Gateway provider packages are Apache-2.0 licensed. OpenUse uses the published `ai` package API and does not copy SDK implementation code.

- https://github.com/vercel/ai/blob/main/content/providers/01-ai-sdk-providers/00-ai-gateway.mdx
- https://github.com/vercel/ai/blob/main/content/cookbook/05-node/55-manual-agent-loop.mdx

Runtime dependencies retain their own licenses and notices in their published packages.
