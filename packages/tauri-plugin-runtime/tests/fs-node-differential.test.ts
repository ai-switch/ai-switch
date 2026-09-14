import { mkdtemp, mkdir, readFile, readdir, rename, copyFile, rm, stat, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep, toNamespacedPath } from "node:path";
import { expect, test } from "vitest";
import { createFsClient } from "../src/node/fs/client.js";
import { createMemoryFsProvider } from "./support/memory-fs-provider.js";

test("declared file operations match real Node on a temporary data-root mapping", async () => {
  const root = await mkdtemp(join(tmpdir(), "aplg-fs-node-"));
  const provider = createMemoryFsProvider(); const fs = createFsClient(provider.call, provider.session);
  const map = (virtual: string) => join(root, ...virtual.slice("/data/".length).split("/"));
  try {
    const realCreated = await mkdir(map("/data/notes/a"), { recursive: true });
    expect(toNamespacedPath(realCreated!)).toBe(toNamespacedPath(map("/data/notes")));
    expect(await fs.mkdir("/data/notes/a", { recursive: true })).toBe("/data/notes");
    await Promise.all([writeFile(map("/data/notes/a.txt"), "你好", "utf8"), fs.writeFile("/data/notes/a.txt", "你好", "utf8")]);
    await Promise.all([appendFile(map("/data/notes/a.txt"), "+🙂"), fs.appendFile("/data/notes/a.txt", "+🙂")]);
    expect(await fs.readFile("/data/notes/a.txt", "utf8")).toBe(await readFile(map("/data/notes/a.txt"), "utf8"));
    expect(Array.from(await fs.readFile("/data/notes/a.txt"))).toEqual(Array.from(await readFile(map("/data/notes/a.txt"))));
    const real = await stat(map("/data/notes/a.txt")); const virtual = await fs.stat("/data/notes/a.txt");
    expect(virtual.size).toBe(real.size); expect(virtual.isFile()).toBe(real.isFile()); expect(virtual.isDirectory()).toBe(real.isDirectory());
    expect((await fs.readdir("/data/notes")).sort()).toEqual((await readdir(map("/data/notes"))).sort());
    const realEntries = (await readdir(map("/data/notes"), { withFileTypes: true })).map((entry) => [entry.name, entry.isFile(), entry.isDirectory()]).sort();
    const virtualEntries = (await fs.readdir("/data/notes", { withFileTypes: true })).map((entry) => [entry.name, entry.isFile(), entry.isDirectory()]).sort();
    expect(virtualEntries).toEqual(realEntries);
    await Promise.all([copyFile(map("/data/notes/a.txt"), map("/data/notes/b.txt")), fs.copyFile("/data/notes/a.txt", "/data/notes/b.txt")]);
    await Promise.all([rename(map("/data/notes/b.txt"), map("/data/notes/c.txt")), fs.rename("/data/notes/b.txt", "/data/notes/c.txt")]);
    expect(await fs.readFile("/data/notes/c.txt", "utf8")).toBe(await readFile(map("/data/notes/c.txt"), "utf8"));
    await Promise.all([rm(map("/data/notes/c.txt")), fs.rm("/data/notes/c.txt")]);
    await expect(fs.readFile("/data/notes/c.txt")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(map("/data/notes/c.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.writeFile("/data/notes/a.txt", "bad", { flag: "wx" })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(writeFile(map("/data/notes/a.txt"), "bad", { flag: "wx" })).rejects.toMatchObject({ code: "EEXIST" });
  } finally {
    const target = resolve(root); const parent = resolve(tmpdir());
    if (dirname(target) !== parent || !target.slice(parent.length + 1).startsWith("aplg-fs-node-")) throw new Error("Unsafe temporary cleanup path");
    await rm(target, { recursive: true, force: true });
  }
});
