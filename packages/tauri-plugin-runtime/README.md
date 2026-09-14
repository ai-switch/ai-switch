# @ai-switch/tauri-plugin-runtime

Host-neutral contracts for APLG plugins. The package does not depend on Tauri,
React, Vue, or AI Switch application source code.

## Implementation status

The first implementation slice provides the manifest schema, generated
TypeScript declarations and ahead-of-time validators, safe JSON validation,
portable archive/virtual path policies, and version constants.

The host/plugin bridge, lifecycle, Node API shims, Rust capability providers and
installation/release integration are **not implemented yet**. The package has
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
