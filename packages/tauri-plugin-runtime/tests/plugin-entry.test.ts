import { expect, test } from "vitest";

test("plugin entry is safe to import without a browser and connects only on demand", async () => {
  const { aplg, connectPlugin } = await import("../src/plugin/index.js");
  expect(aplg.capabilities.supports("aplg.storage")).toBe(false);
  const first = connectPlugin(); const second = connectPlugin();
  expect(first).toBe(second);
  await expect(first).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE" });
  await expect(aplg.ready()).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE" });
});

test("failed public connections release pre-registered observers and report closure", async () => {
  const { aplg } = await import("../src/plugin/index.js");
  const states: string[] = [];
  aplg.onConnectionChange((state) => states.push(state));
  await expect(aplg.ready()).rejects.toMatchObject({ code: "E_HOST_UNAVAILABLE" });
  expect(states).toEqual(["closed"]);
});
