# Agent logo sources

Retrieved/checked 2026-11-15–16. All images are bundled locally; no client logo is fetched at runtime. Branding here identifies the client, not an affiliation or endorsement.

| Client | Source / asset | Bundled representation |
|---|---|---|
| Codex CLI / ChatGPT | [OpenAI brand guidance](https://openai.com/brand/), existing `AgentIcon.tsx` Codex vector | Existing platform icon retained. No new OpenAI mark redistributed. |
| Claude Code | [Official docs](https://code.claude.com/docs/en/overview) | Existing `AgentIcon.tsx` Claude Code vector retained. |
| Gemini CLI | [Official project](https://github.com/google-gemini/gemini-cli) | Existing platform vector retained. |
| Grok | [xAI](https://x.ai/) | Existing platform vector retained; no new asset permission asserted. |
| OpenCode | [Brand page](https://opencode.ai/brand) | Existing platform vector retained. |
| OpenClaw | [Official MIT project](https://github.com/openclaw/openclaw) | Existing platform vector retained. |
| Hermes Agent | [Official site logo](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/static/img/logo.png), [MIT license](https://github.com/NousResearch/hermes-agent/blob/main/LICENSE) | `public/brand/hermes-agent.png`, unmodified official website asset. Copyright notice preserved below. |
| DeepSeek Harness | [Official favicon](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/website/public/favicon.svg), [MIT license](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE), [brand guidelines](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md) | `public/brand/deepseek-harness.svg`, unmodified official project favicon. Identification only, no endorsement implied. |
| DeepSeek Harness Desktop | [Official desktop icon](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/desktop/resources/icon.svg), same license/guidelines as above | `public/brand/deepseek-harness-desktop.svg`, unmodified official asset. |
| ZCode | [Official pinned icon](https://raw.githubusercontent.com/zai-org/ZCode/fec975905a2abd4c07e35c40d51fa097a2258ec9/public/logo/icons/128x128.png), [LICENSE](https://github.com/zai-org/ZCode/blob/fec975905a2abd4c07e35c40d51fa097a2258ec9/LICENSE), [NOTICE](https://github.com/zai-org/ZCode/blob/fec975905a2abd4c07e35c40d51fa097a2258ec9/NOTICE.md) | `public/brand/zcode.png`, unmodified 128px official application icon, not a font monogram. Exact upstream license/notice bundled in `LICENSES/ZCode-*`. |
| WorkBuddy | [Official homepage favicon](https://assets.workbuddy.cn/web/workbuddy/8e036eb06f87c6b08437546b3cbd58e60af45b10/assets/logo.svg), [terms §9.3](https://www.workbuddy.cn/document/term) | `public/brand/workbuddy.svg`, unmodified green Buddy symbol from the homepage's `rel=icon`. |
| WorkBuddy AI | [Official homepage favicon](https://download.codebuddy.ai/web/workbuddy/05fd33c3609bc9cf5ae1fc387a142a2ad0fab64e/assets/logo.svg), [terms §9.3](https://www.workbuddy.ai/document/term) | The official AI and CN favicon files are byte-identical; shares `public/brand/workbuddy.svg`. |
| CodeBuddy CLI | [Official CLI page](https://www.codebuddy.ai/cli), [its favicon](https://codebuddy-1328495429.cos.accelerate.myqcloud.com/web/ide/logo.svg), [terms §9.3](https://www.codebuddy.ai/document/term) | `public/brand/codebuddy.svg`, the original purple Buddy symbol explicitly used by the official CLI page. Not a recolored WorkBuddy icon or CB monogram. |
| Qoder CLI | [Official CLI page](https://qoder.com/cli), [official favicon](https://qoder.com/favIcon.svg), [terms](https://qoder.com/product-service) | `public/brand/qoder.svg`, unmodified official square icon with interlocking emblem. The favicon path is case-sensitive. |
| Qoder CN CLI | [Official CLI page](https://qoder.com.cn/cli), [official favicon](https://qoder.com.cn/favIcon.svg), [user agreement](https://terms.alicdn.com/legal-agreement/terms/c_platform_service_agreement/20231023213402278/20231023213402278.html) | CN and international originals are byte-identical; shares `public/brand/qoder.svg`. |

The WorkBuddy/CodeBuddy, ZCode and Qoder source checks above were repeated on 2026-11-16 after the reported logo mismatch. Previously the application displayed W/CB/Z/Q placeholders for these clients; those placeholders are not official artwork. The corrected assets identify the named third-party client only, without recoloring, redesign or endorsement claims. Unknown clients still use a neutral fallback.

Official provenance is not a blanket trademark or redistribution grant. Tencent's quoted terms §9.3 require prior written consent for Tencent Logos and do not explicitly state an identification exception; Qoder reserves rights not expressly granted; Apache-2.0 does not grant general trademark rights. No consent, affiliation or broad permission is asserted here. The original source links and relevant terms are retained for distribution review.

## Verified official-asset hashes

| Local file | SHA-256 |
|---|---|
| `workbuddy.svg` | `10ccbc099e7bc3d5ff12c315c4edd7b21386aa7166c1ec19997b3d55010d5c7d` |
| `codebuddy.svg` | `149baa45b9f9370c15f20d599afe381aa138e4fc13acf503f435c571ac93ecf5` |
| `zcode.png` | `1ec553f7eaeae4492c673e9d636692a3898d11800d912628d8c1e667222d6d19` |
| `qoder.svg` | `5e1843cb50c4613855024453e76d5c06d2ca5562efebc12b4fcd80cf9ece1dd0` |

## MIT notices for bundled official project assets

Copyright (c) 2026 DeepSeek

Copyright (c) 2025 Nous Research (Hermes Agent)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
