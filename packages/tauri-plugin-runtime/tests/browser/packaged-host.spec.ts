import { expect, test } from "@playwright/test";

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  for (const frame of page.frames()) {
    console.error("Packaged-host failure diagnostics:", frame.url(), await frame.locator("body").innerText().catch(() => "frame detached"));
  }
});

async function open(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByText("模拟宿主，仅内存数据", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开插件", exact: true }).click();
  const plugin = page.frameLocator("#plugin-slot iframe");
  await expect(plugin.locator("#connection")).toHaveText("已连接");
  return plugin;
}

test("a real npm-installed plugin roundtrips memory storage and renders text safely", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const plugin = await open(page);
  await expect(plugin.locator("#fs-capability")).toHaveText("不可用（未声明、未授权）");
  await plugin.getByLabel("便笺内容").fill('<img src=x onerror="alert(1)"> 你好');
  await plugin.getByRole("button", { name: "保存到内存", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("已保存到本次会话");
  await plugin.getByRole("button", { name: "读取", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText('<img src=x onerror="alert(1)"> 你好');
  await expect(plugin.locator("#result img")).toHaveCount(0);
  await expect(page.locator("#entries")).toHaveText("1");
  await plugin.getByRole("button", { name: "清除", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("已清除");
  await plugin.getByRole("button", { name: "读取", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("尚未保存");
  expect(errors).toEqual([]);
});

test("closing the view frees its session, listener and memory and supports a fresh mount", async ({ page }) => {
  const plugin = await open(page);
  await plugin.getByLabel("便笺内容").fill("temporary");
  await plugin.getByRole("button", { name: "保存到内存", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("已保存到本次会话");
  await expect(page.locator("#entries")).toHaveText("1");
  await page.getByRole("button", { name: "关闭插件", exact: true }).click();
  await expect(page.locator("#plugin-slot iframe")).toHaveCount(0);
  for (const name of ["sessions", "listeners", "entries"]) await expect(page.locator(`#${name}`)).toHaveText("0");
  await page.getByRole("button", { name: "打开插件", exact: true }).click();
  await expect(plugin.locator("#connection")).toHaveText("已连接");
  await plugin.getByRole("button", { name: "读取", exact: true }).click();
  await expect(plugin.locator("#result")).toHaveText("尚未保存");
});

test("the packaged iframe is opaque, cross-origin and served under a non-eval CSP", async ({ page, request }) => {
  await open(page);
  const iframe = page.locator("#plugin-slot iframe");
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  const src = await iframe.getAttribute("src");
  expect(new URL(src!).origin).not.toBe(new URL(page.url()).origin);
  const frame = page.frames().find((candidate) => candidate.parentFrame());
  expect(await frame!.evaluate(() => {
    const blocked = (read: () => unknown) => { try { read(); return false; } catch (error) { return (error as Error).name === "SecurityError"; } };
    return { parent: blocked(() => parent.document), storage: blocked(() => localStorage) };
  })).toEqual({ parent: true, storage: true });
  const response = await request.get(src!);
  const csp = response.headers()["content-security-policy"];
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'none'");
  expect(csp).not.toContain("unsafe-eval"); expect(csp).not.toContain("unsafe-inline");
  expect(response.headers()["access-control-allow-origin"]).toBe("*");
  expect((await request.get("/")).headers()["access-control-allow-origin"]).toBeUndefined();
  expect((await request.get(new URL("/", src!).href)).status()).toBe(404);
});

test("the example remains usable at a narrow viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const plugin = await open(page);
  await expect(page.getByRole("button", { name: "关闭插件", exact: true })).toBeVisible();
  await expect(plugin.getByLabel("便笺内容")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
