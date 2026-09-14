import { describe, expect, test } from "vitest";
import { checkNodeUsage } from "../src/vite/node-policy.js";

describe("scope-aware plugin Node syntax checks", () => {
  test.each([
    'function f(process){ return process.cwd(); } f({cwd:()=>1});',
    'const {process, Buffer: Binary} = {process:1, Buffer:2}; console.log(process,Binary);',
    'try {throw 1;} catch(process) {console.log(process);}',
    'const f = (Buffer) => Buffer; f(1);',
    'function f(){ if(true){var process = 1;} return process; }',
    'const x = {process:1}; console.log(x.process);',
    'const require = (name) => name; console.log(require("x"));',
    'import {Buffer} from "buffer"; console.log(Buffer.from("hello"));',
    'const x = "process.cwd() require(x)"; console.log(x);',
    'interface Buffer { foo:string }; const data:{process:string} = {process:"ok"};',
    'export {Buffer} from "buffer";',
    'export type {Buffer} from "node:buffer";',
    'interface Buffer {}; export type {Buffer};',
    'class Buffer { static from(x){return x} }; console.log(Buffer.from(1));',
    'for(const process of [1,2]) {console.log(process)}',
  ])("does not reject local identifiers or non-executable type syntax: %s", (source) => {
    expect(() => checkNodeUsage(source, "plugin.ts", () => {})).not.toThrow();
  });
  test.each([
    'const fn = (process) => process; console.log(process.cwd());',
    'if(true) {let process = 1;} console.log(process);',
    'import type {Buffer} from "buffer"; console.log(Buffer.from("x"));',
    'const p = process; console.log(p);',
    'const x = {process}; console.log(x);',
    'console.log(globalThis["Buffer"]);',
    'const {process} = globalThis; console.log(process);',
    'const {require} = window; require("fs");',
    'import(process.env.MODULE);',
    'import(process);',
    'declare function decorator(x:unknown):any; @decorator(process) class Example {}',
    'let obj = { [process.env.KEY]: 1 };',
    'switch(1){case 1: let process=1; break;} console.log(process);',
  ])("does not mistake lexical declarations in another scope for global permission: %s", (source) => {
    expect(() => checkNodeUsage(source, "plugin.ts", () => {})).toThrow(/APLG_(UNSUPPORTED_NODE_GLOBAL|DYNAMIC_REQUIRE)/);
  });
  test("forwards literal require/import/export references to one specifier checker", () => {
    const seen: string[] = [];
    checkNodeUsage('import path from "path"; export {join} from "node:path"; const fs = require("fs"); import("fs/promises");', "plugin.js", (name) => { seen.push(name); });
    expect(seen).toEqual(["path", "node:path", "fs", "fs/promises"]);
  });
});
