import { expect, test } from "@playwright/test";

const previewRoot = "http://127.0.0.1:43273/__aplg_preview__/";
const memoryPreviewRoot = "http://127.0.0.1:43274/__aplg_preview__/";

test.describe("Vite APLG preview", () => {
  test.describe.configure({ mode: "serial" });
  test("opens a loopback preview shell and mounts the plugin after the runtime handshake", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const response = await page.goto(previewRoot);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /模拟宿主.*内存数据/ })).toBeVisible();
    await expect(page.locator("#aplg-preview-status")).toHaveText("已连接（模拟宿主 / 内存数据）");
    const frame = page.frameLocator("#aplg-preview-slot iframe");
    await expect(frame.getByText("preview-business-started", { exact: true })).toBeVisible();
    await expect(frame.locator("#preview-connection")).toHaveText("connected");
    await expect(page.locator("#aplg-preview-slot iframe")).toHaveAttribute("sandbox", "allow-scripts");
    expect(await page.locator("#aplg-preview-slot iframe").getAttribute("allow")).not.toContain("same-origin");
    expect(requests.some((url) => url.includes("/@vite/client"))).toBe(false);
    const csp = (await page.request.get(previewRoot)).headers()["content-security-policy"];
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
  });

  test("disconnects and reconnects the real runtime view without losing the preview session", async ({ page }) => {
    await page.goto(previewRoot);
    await expect(page.locator("#aplg-preview-status")).toHaveText("已连接（模拟宿主 / 内存数据）");
    const firstSession = await page.locator("#aplg-preview-status").getAttribute("data-session-id");
    expect(firstSession).toMatch(/^test-session-/);
    const frame = page.frameLocator("#aplg-preview-slot iframe");
    await page.getByRole("button", { name: "断开模拟宿主" }).click();
    await expect(frame.locator("#preview-connection")).toHaveText("disconnected");
    await page.getByRole("button", { name: "重新连接模拟宿主" }).click();
    await expect(frame.locator("#preview-connection")).toHaveText("connected");
    await page.getByRole("button", { name: "重新挂载" }).click();
    await expect(page.locator("#aplg-preview-status")).toHaveText("已连接（模拟宿主 / 内存数据）");
    const secondSession = await page.locator("#aplg-preview-status").getAttribute("data-session-id");
    expect(secondSession).toMatch(/^test-session-/);
    expect(secondSession).not.toBe(firstSession);
  });

  test("optional filesystem remains unavailable without explicit memory files", async ({ page }) => {
    await page.goto(previewRoot);
    const frame = page.frameLocator("#aplg-preview-slot iframe");
    await frame.getByRole("button", { name: "检查文件能力" }).click();
    await expect(frame.locator("#preview-fs-result")).toHaveText("E_CAPABILITY_UNAVAILABLE");
  });

  test("explicit memory files are readable and writable without OS filesystem access", async ({ page }) => {
    await page.goto(memoryPreviewRoot);
    const frame = page.frameLocator("#aplg-preview-slot iframe");
    await frame.getByRole("button", { name: "检查内存文件" }).click();
    await expect(frame.locator("#preview-memory-read")).toHaveText("memory-only");
    await expect(frame.locator("#preview-memory-write")).toHaveText("7");
  });

  test("rejects a non-loopback Host header", async ({ request }) => {
    const response = await request.get(previewRoot, { headers: { Host: "192.168.1.20:43273" } });
    expect(response.status()).toBe(403);
    expect(await response.text()).toBe("Preview is loopback-only.");
  });

  test("production output does not contain the preview route or memory-host marker", async ({ request }) => {
    const response = await request.get("http://127.0.0.1:43272/normal/index.html");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("/__aplg_preview__/");
    expect(body).not.toContain("模拟宿主 / 内存数据");
    expect(body).not.toContain("createTestHost");
  });
});
