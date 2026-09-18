import { expect, test } from "@playwright/test";

for (const origin of ["http://127.0.0.1:43171", "http://127.0.0.1:43172"]) {
  test(`built Node subset modules run without host globals: ${origin}`, async ({ page }) => {
    const errors: string[] = [];
    const external: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (!request.url().startsWith(origin)) external.push(request.url()); });
    await page.goto(`${origin}/node-builtins`);
    await expect(page.locator("#status")).toHaveText("ready");
    await expect(page.locator("#path")).toHaveText("/data/notes/a.txt");
    await expect(page.locator("#relative")).toHaveText("../b");
    await expect(page.locator("#buffer")).toHaveText("你好");
    await expect(page.locator("#events")).toHaveText("once:1,this:true,symbol:1");
    await expect(page.locator("#globals")).toHaveText("absent");
    await expect(page.locator("#unsupported")).toHaveText("absent");
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("Node subset imports do not initiate host RPC or access private parent state", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:43171/node-builtins-container");
  const iframe = page.frameLocator("iframe");
  await expect(iframe.locator("#status")).toHaveText("ready");
  await expect(iframe.locator("#globals")).toHaveText("absent");
  await expect(page.locator("#messages")).toHaveText("0");
  expect(errors).toEqual([]);
});
