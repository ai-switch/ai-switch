import { expect, test } from "vitest";
import { decodeWireMessage, encodeWireMessage } from "../src/bridge/json-codec.js";

const message = { protocol: "aplg/1", kind: "result", id: "r-1", value: "你好" };

test("the port codec uses JSON strings and preserves Unicode", () => {
  const encoded = encodeWireMessage(message);
  expect(typeof encoded).toBe("string");
  expect(decodeWireMessage(encoded)).toEqual(message);
});

test.each([{}, null, new Uint8Array(1), "{", '{"protocol":"aplg/9"}'])("rejects malformed or non-string frames %j", (input) => {
  expect(() => decodeWireMessage(input)).toThrow();
});

test("a negotiated byte limit measures UTF-8, not UTF-16 length", () => {
  const encoded = JSON.stringify(message);
  const bytes = new TextEncoder().encode(encoded).byteLength;
  expect(decodeWireMessage(encoded, bytes)).toEqual(message);
  expect(() => decodeWireMessage(encoded, bytes - 1)).toThrow(expect.objectContaining({ code: "E_LIMIT_EXCEEDED" }));
  expect(() => encodeWireMessage(message, bytes - 1)).toThrow(expect.objectContaining({ code: "E_LIMIT_EXCEEDED" }));
});

test("invalid outgoing frames cannot evaluate getters or serialize circular data", () => {
  let reads = 0;
  const input = { ...message };
  Object.defineProperty(input, "value", { enumerable: true, get() { reads++; return "secret"; } });
  expect(() => encodeWireMessage(input)).toThrow();
  expect(reads).toBe(0);
  const circular: unknown[] = []; circular.push(circular);
  expect(() => encodeWireMessage({ ...message, value: circular })).toThrow();
});
