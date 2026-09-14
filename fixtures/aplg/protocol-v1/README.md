# APLG protocol v1 cross-language fixtures

These files are versioned protocol inputs, not executable plugins or trusted
host state. TypeScript tests validate them through the public protocol entry;
future Rust and devkit consumers must exercise the same cases.

- `manifest.valid.json`, `request.valid.json`, `session.valid.json`: accepted.
- `request.spoofed.json`: rejected because a plugin supplies a session ID.
- `fs.methods.json`: accepted request/result examples for every v1 fs method.

Schema validation is only structural. Consumers must also apply semantic path,
version, base64, size, identity and permission checks. Validating these fixtures
does not prove authorization or actual filesystem execution.
