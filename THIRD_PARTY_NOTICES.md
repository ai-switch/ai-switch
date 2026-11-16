# Third-Party Notices

## Agent identification artwork

DeepSeek Harness website/favicon and desktop icons are bundled unmodified from
[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
under the MIT license (Copyright (c) 2026 DeepSeek).
The Hermes Agent website logo is bundled unmodified from
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
under the MIT license (Copyright (c) 2025 Nous Research).

Exact upstream license notices are preserved in `LICENSES/deepseek-harness-MIT.txt`
and `LICENSES/hermes-agent-MIT.txt`.

The ZCode application icon is bundled unmodified from
[zai-org/ZCode](https://github.com/zai-org/ZCode) revision
`fec975905a2abd4c07e35c40d51fa097a2258ec9`. Its original Apache-2.0 license and
upstream notice are preserved in `LICENSES/ZCode-Apache-2.0.txt` and
`LICENSES/ZCode-NOTICE.md` (Copyright 2026 Z.AI Co., Ltd). The upstream notice
records ZCode's behavior and dependencies, not AI Switch's behavior.

WorkBuddy/WorkBuddy AI and CodeBuddy use unmodified official homepage/CLI-page
favicon symbols; Qoder CLI/CN use their identical official square favicon.
These vendor marks remain the property of their respective owners, not MIT or
Apache-licensed AI Switch artwork. Source URLs, hashes and relevant vendor-use
terms are recorded in `src/components/brand/agent-logo-sources.md`; no general
trademark permission or vendor consent is asserted.

Client artwork identifies third-party products in the interface. It does not
imply sponsorship, endorsement or that AI Switch is an official vendor product.

## codeg MCP and Skills implementation

Parts of the MCP and Skills settings implementation are derived from and adapted from:

- Project: [xintaofei/codeg](https://github.com/xintaofei/codeg)
- License: Apache License 2.0
- Source snapshot: `df7a872de44546277e4c49cfe9d173c631161dc6`

AI Switch reorganizes the implementation into independent MCP and Skills modules,
adapts error and transport boundaries, and adds support for this repository's
Tauri/Web command layer. The original Apache-2.0 notices are retained in the
derived source files. See `LICENSES/Apache-2.0.txt`.

## codeg bilingual release notes rendering

The bilingual release-notes splitting and the markdown notes panel are derived
from and adapted from:

- Project: [xintaofei/codeg](https://github.com/xintaofei/codeg)
- License: Apache License 2.0
- Source files: `src/lib/release-notes.ts`, `src/components/settings/release-notes.tsx`

AI Switch ports the separator detection and language scoring to this
repository's own i18n context and UnoCSS typography. The Apache-2.0 notices are
retained in the derived source files. See `LICENSES/Apache-2.0.txt`.
