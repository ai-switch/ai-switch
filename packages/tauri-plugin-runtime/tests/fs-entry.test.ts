import { expect, test } from "vitest";

test("public file entries are lazy and share one promises object", async () => {
  const [{ default: fs, promises }, { default: direct, readFile }] = await Promise.all([
    import("../src/node/fs.js"), import("../src/node/fs/promises.js"),
  ]);
  expect(fs.promises).toBe(direct); expect(promises).toBe(direct); expect(direct.readFile).toBe(readFile);
  expect(() => fs.readFileSync("/data/a")).toThrow(expect.objectContaining({ code: "ERR_APLG_SYNC_IO_UNSUPPORTED" }));
  await expect(direct.readFile("/data/a")).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE", syscall: "readFile" });
});
