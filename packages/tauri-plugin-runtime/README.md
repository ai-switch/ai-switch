# @ai-switch/tauri-plugin-runtime

Host-neutral contracts for APLG plugins. The package does not depend on Tauri,
React, Vue, or AI Switch application source code.

## Implementation status

The R1/R2 implementation slices provide manifest, wire, session and standard
capability schemas, generated TypeScript declarations and ahead-of-time
validators, safe JSON validation, portable archive/virtual path policies,
capability negotiation, safe error envelopes, and version constants.

An internal bounded MessagePort RPC layer is implemented and tested. The public
plugin connection and host mounting APIs, Node API shims, Rust capability
providers and installation/release integration are **not implemented yet**. The package has
not been published to npm. Do not interpret a valid manifest as authorization
to access files, the network, or the host application.

## Protocol entry

```ts
import {
  validateManifest,
  parseManifest,
  manifestSchema,
  normalizeArchivePath,
  validateVirtualPath,
  validateWireMessage,
  validateHostEvent,
  validateSessionDescriptor,
  validateCapabilityRequest,
  validateCapabilityResult,
} from "@ai-switch/tauri-plugin-runtime/protocol";
```

- `validateManifest(value)` returns `{ ok, value }` or structured diagnostics.
- `parseManifest(value)` throws an error with `code: E_MANIFEST_INVALID` on failure.
- `normalizeArchivePath(path)` validates a portable relative POSIX archive path;
  it never accesses the filesystem or silently rewrites input.
- `validateVirtualPath(path)` accepts only `/app`, `/data`, and
  `/mounts/<grantId>` roots. It does not grant real filesystem access.
- `manifestSchema` is the draft-07 structural schema. Semantic version, path,
  duplicate ID, origin and safe-JSON rules also require `validateManifest`.

- `validateWireMessage` rejects unknown operations, plugin-supplied identity
  fields, malformed replies, unsafe JSON and oversized UTF-8 envelopes.
- `validateHostEvent` validates the separate identity-bearing host event shape.
- `validateSessionDescriptor` checks manifest identity, capability declarations,
  standard method completeness, API versions, asset URL safety and limits.
  An allowed asset URL still needs the concrete host's origin/IPC policy.
- `validateCapabilityRequest` / `validateCapabilityResult` validate v1
  `aplg.storage`, `aplg.dialog` and `aplg.fs` DTOs. They reject unknown standard
  methods; extension capabilities require their own provider-side validation.
- `AplgError` and `toErrorPayload` serialize deliberately public errors without
  blindly copying native Error stacks or real filesystem paths. Construct
  AplgError only from messages/details that are safe to show to plugins.

File DTO checks enforce canonical base64, bounded offsets/chunks and virtual
paths. They do **not** read/write files, track actual transfer sessions or grant
permissions; R3 onward and the future Rust backend implement those behaviors.

Shared cross-language inputs live in `fixtures/aplg/protocol-v1/`. Generated
schemas define structural contracts; semantic validation and backend grant
checks remain necessary in every consumer.
The implementation version is `0.1.0`; the wire identifier is `aplg/1`, the
plugin API version is `1.0.0`, and `manifestVersion` is `1`. These are separate
version domains.

## Development

Node `^22.12.0 || ^24.0.0 || >=26.0.0` and pnpm `10.12.4` are required.

```sh
pnpm install --frozen-lockfile
pnpm --dir packages/tauri-plugin-runtime generate
pnpm --dir packages/tauri-plugin-runtime check:generated
pnpm --dir packages/tauri-plugin-runtime typecheck
pnpm --dir packages/tauri-plugin-runtime test
pnpm --dir packages/tauri-plugin-runtime build
```

JSON schemas under `src/protocol/schema/` are the authoritative structural
contract. Generated TypeScript and ESM validators are committed and verified
without invoking runtime code generation in the browser. Validation does not
need `eval`, `new Function`, a Node `require`, or browser globals on import.

Only implemented entry points are exported. Later slices add `/host`,
`/plugin` and `/node/*`; no empty implementations are published in advance.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
