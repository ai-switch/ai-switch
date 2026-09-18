import { expect, test } from "@playwright/test";

test("the packed plugin completes the real runtime handshake and renders its upstream behavior", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "打开示例插件", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开示例插件", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("已连接");
  const plugin = page.frameLocator("#slot iframe");
  await expect(plugin.getByRole("heading", { name: "文本统计", exact: true })).toBeVisible();
  await plugin.getByRole("textbox", { name: "输入文本", exact: true }).fill("Hello, AI Switch!\n你好，插件世界。🙂");
  await expect(plugin.locator("#character-count")).toHaveText("27");
  await expect(plugin.locator("#non-whitespace-count")).toHaveText("24");
  await expect(plugin.locator("#line-count")).toHaveText("2");
  await expect(page.locator("#slot iframe")).toHaveAttribute("sandbox", "allow-scripts");
  expect(errors).toEqual([]);
});

test("the packaged iframe is opaque and cannot reach parent storage", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开示例插件", exact: true }).click();
  const iframe = page.locator("#slot iframe");
  const frame = page.frames().find((candidate) => candidate.parentFrame());
  expect(await frame!.evaluate(() => {
    const blocked = (read: () => unknown) => { try { read(); return false; } catch (error) { return (error as Error).name === "SecurityError"; } };
    return { parent: blocked(() => parent.document), storage: blocked(() => localStorage) };
  })).toEqual({ parent: true, storage: true });
});