export const protocolVersion = "aplg/1" as const;
export const apiVersion = "1.0.0" as const;

export const limits = Object.freeze({
  controlBytes: 1_048_576,
  fileChunkBytes: 262_144,
  fileBytes: 8_388_608,
  fileTransfers: 2,
  archiveBytes: 134_217_728,
  archiveExtractedBytes: 536_870_912,
  archiveEntries: 10_000,
} as const);
