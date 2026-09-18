import { expect, test } from "@playwright/test";
const root = "http://127.0.0.1:43171/fs-host";

test("built file entries roundtrip binary data and share the same singleton", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(root);
  const plugin = page.frameLocator("iframe");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await expect(plugin.locator("#shared")).toHaveText("same");
  await plugin.getByRole("button", { name: "Roundtrip", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("roundtrip:300001:true:true", { timeout: 15000 });
  await expect(page.locator("#active")).toHaveText("0");
  expect(errors).toEqual([]);
});

test("callback and promises writes cannot bypass the negotiated concurrency limit", async ({ page }) => {
  await page.goto(`${root}?mode=gate`);
  const plugin = page.frameLocator("iframe");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await plugin.getByRole("button", { name: "Concurrent", exact: true }).click();
  await expect(page.locator("#active")).toHaveText("2");
  await page.getByRole("button", { name: "Release writes", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("concurrent:done");
  await expect(page.locator("#peak")).toHaveText("2");
  await expect(page.locator("#active")).toHaveText("0");
});

test("remote closure rejects both ongoing and queued filesystem operations", async ({ page }) => {
  await page.goto(`${root}?mode=gate`);
  const plugin = page.frameLocator("iframe");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await plugin.getByRole("button", { name: "Concurrent", exact: true }).click();
  await expect(page.locator("#active")).toHaveText("2");
  await page.getByRole("button", { name: "Close session", exact: true }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator("#active")).toHaveText("0");
});

test("filesystem public imports do not manufacture a browser fallback when ungranted", async ({ page }) => {
  await page.goto(`${root}?mode=unavailable`);
  const plugin = page.frameLocator("iframe");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await plugin.getByRole("button", { name: "Roundtrip", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("error:E_CAPABILITY_UNAVAILABLE");
  await expect(page.locator("#calls")).toHaveText("0");
});

test("late file-open results are released even when timeout occurred in the host transport", async ({ page }) => {
  await page.goto(`${root}?mode=late-open`);
  const plugin = page.frameLocator("iframe");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await plugin.getByRole("button", { name: "Roundtrip", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("error:E_TIMEOUT");
  await page.getByRole("button", { name: "Release writes", exact: true }).click();
  await expect(page.locator("#calls")).toHaveText("2");
  await expect(page.locator("#active")).toHaveText("0");
});

test("reconnect does not retain stale file-handle reservations after interrupted writes", async ({ page }) => {
  await page.goto(`${root}?mode=gate`);
  const plugin = page.frameLocator("iframe");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await plugin.getByRole("button", { name: "Concurrent", exact: true }).click();
  await expect(page.locator("#active")).toHaveText("2");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("error:E_HOST_UNAVAILABLE");
  await page.getByRole("button", { name: "Release writes", exact: true }).click();
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await plugin.getByRole("button", { name: "Roundtrip", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("roundtrip:300001:true:true", { timeout: 15000 });
  await expect(page.locator("#active")).toHaveText("0");
});

test("a duplicate connected notification does not abort a healthy active file transfer", async ({ page }) => {
  await page.goto(`${root}?mode=gate`);
  const plugin = page.frameLocator("iframe");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await plugin.getByRole("button", { name: "Concurrent", exact: true }).click();
  await expect(page.locator("#active")).toHaveText("2");
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await page.getByRole("button", { name: "Release writes", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("concurrent:done");
  await expect(page.locator("#active")).toHaveText("0");
});
