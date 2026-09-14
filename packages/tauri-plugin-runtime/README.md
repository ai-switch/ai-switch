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
EventEmitter entry points. R7 adds asynchronous filesystem clients and callback
wrappers with bounded transfer handling. R8 adds clean builds, package boundary
checks, a framework-free storage-only host example, and real external npm
tarball installation tests in Chromium and WebKit. Real Rust capability providers and
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
paths. The JS filesystem client now tracks transfers over the capability bridge,
but it does **not** execute OS filesystem operations or grant permissions. Those
remain the responsibility of an authenticated capability provider.

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
## Asynchronous filesystem client

```ts
import fs from "@ai-switch/tauri-plugin-runtime/node/fs";
import fsp from "@ai-switch/tauri-plugin-runtime/node/fs/promises";

await fsp.writeFile("/data/note.txt", "hello", "utf8");
const text = await fs.promises.readFile("/data/note.txt", "utf8");
fs.readFile("/data/note.txt", (error, data) => {
  if (error) { console.error(error.code); return; }
  console.log(data.toString("utf8"));
});
```

The plugin must declare and be granted compatible `aplg.fs` capability. These
imports do not call Node's real filesystem, create an implicit browser filesystem,
or auto-connect on module import. `fs.promises`, the default promises export and
its named methods share one lazy client and one concurrency queue.

Supported operations are `readFile`, `writeFile`, `appendFile`, `readdir`, `stat`,
`mkdir`, `rename`, `copyFile` and `rm`, plus their callback forms. Only absolute
virtual string paths are accepted. UTF-8 reads return strings; omitted/null
encoding returns the browser Buffer. Writes accept strings/Uint8Array and flags
`w`/`wx`; append uses `a`/`ax`. Unknown options, streams, file descriptors, URLs,
watch APIs and arbitrary encodings are rejected. Synchronous methods throw
`ERR_APLG_SYNC_IO_UNSUPPORTED`, not promises.

- A file is limited to **8 MiB**, chunks to **256 KiB**, and active transfers to
  **two** (or smaller negotiated host limits). The queue is bounded at 64 operations.
- The client snapshots input byte buffers, checks chunk offsets/lengths/base64 and
  byte acknowledgements, and commits only after the complete transfer is staged.
- A 30-second per-request/queue timeout and connection-close handling prevent
  unbounded waits. Cleanup has its own bounded best-effort abort; uncertain
  cleanup blocks new transfer admission rather than pretending capacity is free.
- Host-side handle ownership also protects replies that arrive after a plugin
  request timed out. Reconnect confirms interrupted handle cleanup before
  resuming; unconfirmed opens fail closed. These are not a substitute for backend
  resource ownership and authorization.
- Timeouts/cancellation do not undo an already committed write or other external
  side effect. Non-idempotent operations, especially append, are never retried
  automatically. `force` does not bypass permissions and rename cannot cross grants.
- Stats and directory entries expose immutable snapshots of the supported subset,
  not the full native Node Stats/Dirent APIs. Errors contain safe virtual paths,
  syscall names and known codes, never blindly copied backend stacks or credentials.

The in-memory filesystem implementation is test-only and is not exported. Tests
include real Node filesystem differential cases in an isolated temporary directory
and actual built ESM imports in sandboxed browser views. The Rust provider and
its symlink/junction, OS permissions, quotas and transactional staging still need
separate implementation and verification. Standard `node:fs` import aliases are
part of the later devkit, not automatically installed by this runtime.
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
pnpm --dir packages/tauri-plugin-runtime run test:package
pnpm --dir packages/tauri-plugin-runtime exec playwright install chromium webkit
pnpm --dir packages/tauri-plugin-runtime test:browser
pnpm --dir packages/tauri-plugin-runtime verify:tarball
```

JSON schemas under `src/protocol/schema/` are the authoritative structural
contract. Generated TypeScript and ESM validators are committed and verified
without invoking runtime code generation in the browser. Validation does not
need `eval`, `new Function`, a Node `require`, or browser globals on import.

Only implemented entry points are exported: root version/types, `/protocol`,
`/plugin`, `/host`, `/node/path`, `/node/buffer`, `/node/events`, `/node/fs`, and
`/node/fs/promises`. The root export contains only version constants and public
TypeScript types; it does not aggregate host or Node clients. Consumers need an
ESM-capable bundler and TypeScript `Bundler`/`NodeNext` resolution. CJS `require`
and deep internal paths are not public APIs.

## Independent package verification

`verify:tarball` builds and packs a real `.tgz`, then creates a new consumer under
`os.tmpdir()` **outside the source checkout**. It installs with npm and disabled
lifecycle scripts, verifies all nine public ESM entries and the fs singleton in
Node without DOM globals, compiles public types without Node globals, and builds
the plain-host example with its own Vite 8. The consumer's runtime and build/test
tools must resolve from its own node_modules, never a workspace link or source
alias. The npm package file list and installed bytes are compared before testing.

The same consumer runs the packaged browser suite against two loopback-only
origins with a no-inline/no-eval CSP and an opaque iframe. Tests cover storage
roundtrips, safe text rendering, cleanup/remount, unavailable filesystem access,
origin separation and a narrow viewport. Both Chromium and WebKit must be
installed; missing browsers fail, not silently skip. On Linux, install browser
system dependencies first (`playwright install --with-deps chromium webkit`).

The verifier stops its owned child processes/servers and checks the temporary
directory's canonical parent, identity and ownership marker before removal in
`finally`. Its bounded subprocess tests also cover failure, interruption and
descendant termination. Forced OS termination/power loss cannot promise cleanup.
Run builds and validation commands sequentially: they intentionally share the
single generated dist directory. `test` now builds first so the example tests also
work on a fresh checkout.

Package hygiene checks inspect **parsed** JS/declaration imports, the esbuild
input graph and installed transitive production dependencies. They reject real
Node builtins, app/framework/Tauri imports, workspace/file dependencies, runtime
install hooks, unresolved or stale chunks, source maps, unexpected packed files,
known source-root paths and common secret/key material. This is a conservative
release boundary check, **not** a general malware scanner or authorization layer.
Every build clears only the validated package-local dist directory before the
single multi-entry ESM build, retaining shared client state across subpaths.

Current artifacts contain 77 files (16 JS files), approximately **120 KiB gzip
npm tarball / 983 KiB unpacked**. Exact bytes are reported each run and change with
documentation. The four direct registry dependencies remain `buffer@6.0.3`,
`events@3.3.0`, `path-browserify@1.0.1`, `semver@7.8.5`; the installed production
graph also includes `base64-js@1.5.1` and `ieee754@1.2.1`. They are not claimed to
be zero dependencies: browser JS is bundled, while public Buffer declarations
still use its upstream package. See third-party notices for bundled code.

Local verification has run on **Windows, Node 22.22.2**, with both browsers.
Linux execution is still outstanding: the available Ubuntu and Podman WSL
registrations could not mount their missing VHDs. Portable scripts and a POSIX
signal-target unit test are not evidence of Linux execution. The Windows/Ubuntu
Node 22/24 CI matrix belongs to the later coordinated runtime/devkit D9 workflow;
no remote workflow or publication has been triggered by this task.

The Chinese walkthrough is in `examples/aplg-plain-host/README.md` in the source
repository. Its Transport offers **memory-only, view-scoped storage**, no fake
filesystem and no OS/network permission grants. The example and verification tools
are deliberately not in the published tarball. Rust providers, production
Tauri/Web adapters, native plugins, installation/signing and store release
workflows are separate work. The runtime has **not been published to npm**.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
