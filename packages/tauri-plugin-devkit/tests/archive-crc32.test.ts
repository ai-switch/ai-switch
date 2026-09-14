import { expect, test } from "vitest";
import { createCrc32 } from "../src/archive/crc32.js";

test("CRC-32/ISO-HDLC matches the standard check value", () => {
  const crc = createCrc32(); crc.update(new TextEncoder().encode("123456789"));
  expect(crc.digest()).toBe(0xcbf43926); expect(crc.digest()).toBe(0xcbf43926);
});
test("CRC can be accumulated over arbitrarily split chunks and empty input", () => {
  const crc = createCrc32(); expect(crc.digest()).toBe(0);
  for (const text of ["12", "", "3456", "789"]) crc.update(new TextEncoder().encode(text));
  expect(crc.digest()).toBe(0xcbf43926);
});

test("CRC-32 byte values use the unsigned IEEE table for every possible octet", async () => {
  const { crc32 } = await import("node:zlib");
  const bytes = Uint8Array.from({ length: 4096 }, (_, index) => index % 256);
  const crc = createCrc32();
  for (let offset = 0; offset < bytes.length; offset += 97) crc.update(bytes.subarray(offset, offset + 97));
  expect(crc.digest()).toBe(crc32(bytes));
});