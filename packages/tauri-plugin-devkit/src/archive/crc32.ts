/** Streaming CRC-32/ISO-HDLC. digest() does not consume/reset the accumulator. */
export function createCrc32() {
  let crc = 0xffffffff;
  return {
    update(bytes: Uint8Array): void { for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]; },
    digest(): number { return (crc ^ 0xffffffff) >>> 0; },
  };
}
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
