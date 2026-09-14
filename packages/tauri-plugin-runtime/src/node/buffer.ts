// An explicit package path avoids Node's builtin module and never installs a global.
import { Buffer as BrowserBuffer } from "buffer/index.js";

// buffer@6 returns Buffer from subarray at runtime, but its published declarations
// inherit Uint8Array.subarray. Correct that return type without redefining Buffer.
declare module "buffer/index.js" {
  interface Buffer {
    subarray(start?: number, end?: number): Buffer;
  }
}

export { BrowserBuffer as Buffer };
