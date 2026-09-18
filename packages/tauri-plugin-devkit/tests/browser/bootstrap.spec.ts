import { expect, test } from "@playwright/test";

const root="http://127.0.0.1:43271/bootstrap-fixture";
test("business module is not evaluated until the real host handshake completes", async ({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(root);
  const plugin=page.frameLocator("#slot iframe");
  await expect(page.locator("#waiting")).toHaveText("ready intercepted");
  await expect(plugin.getByText("business-started",{exact:true})).toHaveCount(0);
  await expect(page.locator("#calls")).toHaveText("0");
  await page.getByRole("button",{name:"Connect plugin",exact:true}).click();
  await expect(plugin.getByText("business-started",{exact:true})).toBeVisible();
  await expect(page.locator("#calls")).toHaveText("1");
  await page.getByRole("button",{name:"Connect plugin",exact:true}).click();
  await expect(page.locator("#calls")).toHaveText("1");
  expect(errors).toEqual([]);
});
test("a rejected bootstrap displays a safe error and never falls back to business execution",async({page})=>{
  await page.goto(root);const plugin=page.frameLocator("#slot iframe");
  await expect(page.locator("#waiting")).toHaveText("ready intercepted");
  await page.getByRole("button",{name:"Reject connection",exact:true}).click();
  await expect(plugin.getByRole("alert")).toHaveText("Plugin connection failed.");
  await expect(plugin.getByText("business-started",{exact:true})).toHaveCount(0);
  await expect(page.locator("#calls")).toHaveText("0");
});
test("business exceptions are reported without leaking the thrown message",async({page})=>{
  await page.goto(root+"?variant=throws");const plugin=page.frameLocator("#slot iframe");
  await expect(page.locator("#waiting")).toHaveText("ready intercepted");
  await page.getByRole("button",{name:"Connect plugin",exact:true}).click();
  await expect(plugin.getByRole("alert")).toHaveText("Plugin startup failed.");
  await expect(plugin.locator("body")).not.toContainText("PRIVATE_EXCEPTION");
});
test("opening built output without a host reports failure rather than running business",async({page})=>{
  await page.goto("http://127.0.0.1:43272/normal/index.html");
  await expect(page.getByRole("alert")).toHaveText("Plugin connection failed.");
  await expect(page.getByText("business-started",{exact:true})).toHaveCount(0);
});
test("static HTML retains its content and reports lack of host when opened standalone",async({page,request})=>{
  await page.goto("http://127.0.0.1:43272/static/index.html");
  await expect(page.getByText("Static plugin",{exact:true})).toBeVisible();
  await expect(page.locator("script")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveText("Plugin connection failed.");
  const response=await request.get("http://127.0.0.1:43272/static/index.html");
  expect(response.headers()["content-security-policy"]).not.toMatch(/unsafe-(eval|inline)/);
});
test("a normal public host mounts automatically under CSP and cleans the view",async({page})=>{
  await page.goto(root+"?automatic=true");const plugin=page.frameLocator("#slot iframe");
  await expect(plugin.getByText("business-started",{exact:true})).toBeVisible();
  await expect(page.locator("#slot iframe")).toHaveAttribute("sandbox","allow-scripts");
  await page.getByRole("button",{name:"Dispose",exact:true}).click();
  await expect(page.locator("#slot iframe")).toHaveCount(0);
  await expect(page.locator("#sessions")).toHaveText("0");
});

test("a source HTML page with no business script still completes the host session handshake",async({page})=>{
  await page.goto(root+"?variant=static&automatic=true");
  await expect(page.locator("#status")).toHaveText("mounted");
  await expect(page.frameLocator("#slot iframe").getByText("Static plugin",{exact:true})).toBeVisible();
  await expect(page.locator("#calls")).toHaveText("0");
});