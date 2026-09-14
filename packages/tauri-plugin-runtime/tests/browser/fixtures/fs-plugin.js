const result = (text) => { document.getElementById("result").textContent = text; };
try {
  const [{ default: fs }, { default: fsp }, { aplg }] = await Promise.all([
    import("/runtime/node/fs.js"), import("/runtime/node/fs/promises.js"), import("/runtime/plugin/index.js"),
  ]);
  await aplg.ready();
  document.getElementById("shared").textContent = fs.promises === fsp ? "same" : "different";
  document.getElementById("status").textContent = "ready";
  document.getElementById("roundtrip").addEventListener("click", () => {
    void (async () => {
      const bytes = new Uint8Array(300001).fill(173);
      await fsp.writeFile("/data/browser.bin", bytes);
      const direct = await fs.promises.readFile("/data/browser.bin");
      const callback = await new Promise((resolve, reject) => fs.readFile("/data/browser.bin", (error, data) => error ? reject(error) : resolve(data)));
      result(`roundtrip:${direct.length}:${direct.every((byte) => byte === 173)}:${callback.equals(direct)}`);
    })().catch((error) => result(`error:${error.code}`));
  });
  document.getElementById("concurrent").addEventListener("click", () => {
    const callback = new Promise((resolve, reject) => fs.writeFile("/data/callback.txt", "a", (error) => error ? reject(error) : resolve()));
    void Promise.all([callback, fsp.writeFile("/data/direct.txt", "b"), fs.promises.writeFile("/data/shared.txt", "c")])
      .then(() => result("concurrent:done"), (error) => result(`error:${error.code}`));
  });
} catch (error) { document.getElementById("status").textContent = `error:${error.message}`; }
