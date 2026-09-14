import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:43171";

test("ready calls share one handshake, preserve hash routes, and support RPC", async ({ page }) => {
  await page.goto(`${origin}/?mode=normal`);
  const plugin = page.frameLocator("#plugin");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await expect(plugin.locator("#result")).toHaveText("hello");
  await expect(page.locator("#readies")).toHaveText("1");
  await expect(page.locator("#acks")).toHaveText("1");
  await expect(plugin.locator("#hash")).toHaveText("#/notes?q=1");
  await expect(plugin.locator("#private-info")).toHaveText("none");
});

test("the plugin does not become ready until the parent confirms its port acknowledgement", async ({ page }) => {
  await page.goto(`${origin}/?mode=manual-ack`);
  const plugin = page.frameLocator("#plugin");
  await expect(page.locator("#acks")).toHaveText("1");
  await expect(plugin.locator("#status")).toHaveText("connecting");
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(plugin.locator("#status")).toHaveText("ready");
});

for (const mode of ["bad-protocol", "extra-port", "missing-port", "private-info"]) test(`malformed trusted bootstrap fails closed: ${mode}`, async ({ page }) => {
  await page.goto(`${origin}/?mode=${mode}`);
  await expect(page.frameLocator("#plugin").locator("#status")).toHaveText("error:E_PROTOCOL_MISMATCH");
  await expect(page.locator("#calls")).toHaveText("0");
});

test("wrong nonce messages are ignored and cannot replace the valid connection", async ({ page }) => {
  await page.goto(`${origin}/?mode=wrong-nonce`);
  const plugin = page.frameLocator("#plugin");
  await expect(page.locator("#sent")).toHaveText("1");
  await expect(plugin.locator("#status")).toHaveText("connecting");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(plugin.locator("#status")).toHaveText("ready");
});

test("a same-origin sibling window cannot impersonate the parent", async ({ page }) => {
  await page.goto(`${origin}/?mode=manual`);
  await expect(page.locator("#readies")).toHaveText("1");
  await page.getByRole("button", { name: "Rogue connect" }).click();
  await expect(page.locator("#rogue-sent")).toHaveText("yes");
  await expect(page.frameLocator("#plugin").locator("#status")).toHaveText("connecting");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.frameLocator("#plugin").locator("#status")).toHaveText("ready");
});

test("a parent with a different origin cannot establish a session", async ({ page }) => {
  await page.goto("http://localhost:43171/?mode=wrong-origin");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.frameLocator("#plugin").locator("#status")).toHaveText("error:E_TIMEOUT", { timeout: 15000 });
  await expect(page.locator("#calls")).toHaveText("0");
});

test("missing bootstrap context is not replaced by an implicit mock host", async ({ page }) => {
  await page.goto(`${origin}/?mode=missing-context`);
  await expect(page.frameLocator("#plugin").locator("#status")).toHaveText("error:E_HOST_UNAVAILABLE");
});

test("duplicate connect messages cannot swap the established RPC port", async ({ page }) => {
  await page.goto(`${origin}/?mode=normal`);
  const plugin = page.frameLocator("#plugin");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await plugin.getByRole("button", { name: "Echo again" }).click();
  await expect(plugin.locator("#result")).toHaveText("again");
  await expect(page.locator("#acks")).toHaveText("1");
});

test("remote closure clears capabilities and rejects subsequent calls", async ({ page }) => {
  await page.goto(`${origin}/?mode=normal`);
  const plugin = page.frameLocator("#plugin");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(plugin.locator("#state")).toHaveText("closed");
  await plugin.getByRole("button", { name: "Echo again" }).click();
  await expect(plugin.locator("#result")).toHaveText("error:E_SESSION_CLOSED");
});

test("absent acknowledgement fails after the fixed handshake deadline", async ({ page }) => {
  await page.goto(`${origin}/?mode=manual-ack`);
  await expect(page.locator("#acks")).toHaveText("1");
  await expect(page.frameLocator("#plugin").locator("#status")).toHaveText("error:E_TIMEOUT", { timeout: 15000 });
  await expect(page.locator("#calls")).toHaveText("0");
});

test("the public connection works with browser code generation forbidden", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/?mode=normal`);
  const plugin = page.frameLocator("#plugin");
  await expect(plugin.locator("#status")).toHaveText("ready");
  await plugin.getByRole("button", { name: "Probe security" }).click();
  await expect(plugin.locator("#csp-result")).toHaveText("blocked");
  await expect(plugin.locator("#dom-result")).toHaveText("blocked");
  expect(errors).toEqual([]);
});
