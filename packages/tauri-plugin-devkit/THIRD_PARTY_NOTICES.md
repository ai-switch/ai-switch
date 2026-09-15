# Third-party notices

The devkit uses registry dependencies as external modules; its Node build does
not copy their implementation into this package. Their own distributions retain
copyright and license notices. The runtime is consumed only through public npm
exports and includes its own THIRD_PARTY_NOTICES.md for bundled browser code.

Direct dependency licenses:

| Dependency | Version | License |
| --- | --- | --- |
| @ai-switch/tauri-plugin-runtime | 0.1.0 | MIT |
| jsonc-parser | 3.3.1 | MIT |
| acorn | 8.18.0 | MIT |
| es-module-lexer | 3.0.2 | MIT |
| parse5 | 8.0.1 | MIT |
| postcss | 8.5.28 | MIT |
| postcss-value-parser | 4.2.0 | MIT |
| yauzl | 3.4.0 | MIT |
| yazl | 3.3.1 | MIT |

Only runtime/protocol and jsonc-parser are used by the D1 source validator.
D2 uses yauzl for lazy ZIP reading; CRC-32 is implemented locally from the
standard polynomial and tested against the published check vector. D4 uses parse5,
PostCSS/value-parser, es-module-lexer and Acorn for static artifact checks.
Remaining archive/build dependencies are pinned for subsequent implementation slices;
pinning them does not mean those features are implemented. Vite is an optional
peer dependency and is loaded only by the /vite entry in D3. Its exported parser
is used without copying its implementation. Build/test tools and test fixtures are not distributed in the
npm tarball. No global Node shim or Tauri implementation is bundled here.
