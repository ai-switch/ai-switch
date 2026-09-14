# @ai-switch/tauri-plugin-runtime

Host-neutral contracts for APLG plugins. The package does not depend on Tauri,
React, Vue, or AI Switch application source code.

## Implementation status

The R1/R2 implementation slices provide manifest, wire, session and standard
capability schemas, generated TypeScript declarations and ahead-of-time
validators, safe JSON validation, portable archive/virtual path policies,
capability negotiation, safe error envelopes, and version constants.

R3/R4 add a bounded MessagePort RPC layer and the public `/plugin` client,
including lazy bootstrap, two-way acknowledgement, capability calls,
subscriptions, storage/dialog wrappers, and connection lifecycle handling.
R5 adds the generic `/host` mounting API with scoped identity, event routing,
reconnect handling and bounded cleanup. R6 adds pure-JavaScript path, Buffer and
EventEmitter entry points. Filesystem shims, Rust capability providers and
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
permissions; later Node-client work and the future Rust backend implement those behaviors.

Shared cross-language inputs live in `fixtures/aplg/protocol-v1/`. Generated
schemas define structural contracts; semantic validation and backend grant
checks remain necessary in every consumer.
The implementation version is `0.1.0`; the wire identifier is `aplg/1`, the
plugin API version is `1.0.0`, and `manifestVersion` is `1`. These are separate
version domains.

## Plugin entry

```ts
import { aplg, connectPlugin } from "@ai-switch/tauri-plugin-runtime/plugin";

await connectPlugin(); // Also called lazily by aplg.ready().
if (aplg.capabilities.supports("aplg.storage", "^1.0.0")) {
  await aplg.storage.set("note", "hello");
}
```

A real host must declare and authorize the requested capabilities. Imports do
not create a connection or touch browser globals. Calling `connectPlugin()` on
a standalone page or without bootstrap context fails explicitly; it never
falls back to a privileged mock host. Concurrent initial calls share one
handshake. The client requires the exact parent window/origin, nonce, one port,
and a parent acknowledgement before resolving readiness.

Session information is a frozen public snapshot, not a host credential. The
client rejects unavailable methods and malformed standard requests/results.
Subscriptions are bounded, duplicate/old sequence events are ignored, and
connection changes let callers re-read state after a gap or reconnect; events
are not replayed automatically. Closing the view or losing the peer invalidates
pending work, subscriptions and capability discovery.

RPC frames are bounded JSON strings. Cancellation and timeouts settle locally
and send best-effort cancellation to the peer; they cannot undo side effects.
Duplicate request detection remembers the most recent 1024 IDs, not unlimited
history or durable idempotency across sessions.

Browser tests cover both the low-level handshake fixture and the real generic
host API with an in-memory backend. They demonstrate Chromium iframe/CSP behavior,
not Tauri IPC isolation, actual Rust file access, or WebKit compatibility.
## Host entry

```ts
import { createPluginHost } from "@ai-switch/tauri-plugin-runtime/host";
import type { HostTransport } from "@ai-switch/tauri-plugin-runtime/host";

async function mountPlugin(transport: HostTransport, container: HTMLElement) {
  const host = createPluginHost({ transport });
  const view = await host.mount({ pluginId: "io.github.example.notes", container });
  return async () => { await view.dispose(); await host.dispose(); };
}
```

The application supplies an authenticated `HostTransport`; it is not handed to
plugin code. Mounting subscribes to host events before opening a backend session,
validates the descriptor, binds it to one sandboxed iframe/port, and resolves only
after the plugin handshake. By default assets must use the host page's origin;
other HTTPS/loopback origins require an explicit `allowedAssetOrigins` list.

Each view gets its own backend request IDs and stable logical subscription IDs.
A reconnect only restores active subscriptions; it never repeats a completed
write. Backend sequence numbers are mapped into the logical subscription's
monotonic sequence, while stale backend IDs and foreign sessions are ignored.

Timeouts, container removal, document reload, remote session closure and explicit
disposal all invalidate the view. Late session/subscription results are released,
and cleanup is bounded even if a transport operation never resolves. The backend
must still authorize every call and enforce grants, resource limits and asset
access. Dedicated asset serving, CSP headers and Tauri IPC restrictions remain
the embedding application's responsibility; an iframe is not an OS sandbox.
## Pure JavaScript Node subset

```ts
import path from "@ai-switch/tauri-plugin-runtime/node/path";
import { Buffer } from "@ai-switch/tauri-plugin-runtime/node/buffer";
import EventEmitter from "@ai-switch/tauri-plugin-runtime/node/events";

const filename = path.resolve("notes", "example.txt"); // /data/notes/example.txt
const bytes = Buffer.from("hello", "utf8");
const events = new EventEmitter();
events.once("saved", (name: string) => console.log(name));
events.emit("saved", filename);
```

These modules are local JS operations: importing them does not connect to a
host, grant file access, or install `Buffer`, `process`, or `require` globals.
`node:path`/`node:buffer`/`node:events` build aliases belong to the later devkit;
use the explicit package subpaths until that toolchain is implemented.

- **Path:** only `join`, `resolve`, `normalize`, `dirname`, `basename`, `extname`,
  `relative`, and `isAbsolute`. Semantics are POSIX on every host. Both `resolve`
  and `relative` use `/data` as the virtual working directory, never the OS cwd.
  String operations can produce a path outside the allowed virtual roots; the
  actual filesystem capability must reject it. No `win32`, `parse`, or `format`.
- **Buffer:** uses the browser `buffer@6.0.3` implementation, including byte
  arrays, UTF-8/base64 conversion, concatenation and Buffer-returning subarrays.
  It is not Node's native/global Buffer. Compatibility is limited to the pinned
  implementation and verified behavior, not every modern Node Buffer overload.
- **EventEmitter:** only `on`, `once`, `off`, `emit`, and `removeAllListeners`,
  with string/symbol events, synchronous delivery, original-listener removal,
  and `this` bound to the public emitter. Listener exceptions propagate, as in
  Node. No promise helpers, prepend API or listener-limit configuration is exposed.
  Removing an event's listeners is not cancellation of work they already started.

Type tests cover source and built package exports without installing Node globals.
Browser tests load the actual built ESM files while trapping access to Node globals,
including inside an opaque sandboxed iframe; these are not source-alias-only tests.
The upstream path dependency retains an unreachable `process.cwd()` fallback in
its bundle, but every exposed resolving path supplies an explicit absolute root.
## Development

Node `^22.12.0 || ^24.0.0 || >=26.0.0` and pnpm `10.12.4` are required.

```sh
pnpm install --frozen-lockfile
pnpm --dir packages/tauri-plugin-runtime generate
pnpm --dir packages/tauri-plugin-runtime check:generated
pnpm --dir packages/tauri-plugin-runtime typecheck
pnpm --dir packages/tauri-plugin-runtime test
pnpm --dir packages/tauri-plugin-runtime build
pnpm --dir packages/tauri-plugin-runtime test:types
pnpm --dir packages/tauri-plugin-runtime test:types:public
pnpm --dir packages/tauri-plugin-runtime exec playwright install chromium
pnpm --dir packages/tauri-plugin-runtime test:browser
```

JSON schemas under `src/protocol/schema/` are the authoritative structural
contract. Generated TypeScript and ESM validators are committed and verified
without invoking runtime code generation in the browser. Validation does not
need `eval`, `new Function`, a Node `require`, or browser globals on import.

Only implemented entry points are exported: root version/types, `/protocol`,
`/plugin`, `/host`, `/node/path`, `/node/buffer`, and `/node/events`. Later work
adds filesystem entry points; no empty implementations are published in advance.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
