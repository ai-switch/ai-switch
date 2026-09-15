import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir:"tests/browser", timeout:25000, expect:{timeout:6000}, fullyParallel:true, workers:2,
  projects:[
    {name:"chromium",use:{browserName:"chromium",launchOptions:{channel:"chromium"}}},
    {name:"webkit",use:{browserName:"webkit"}},
  ],
  use:{headless:true},
  webServer:{command:"node tests/browser/fixture-server.mjs",url:"http://127.0.0.1:43271/health",reuseExistingServer:false,timeout:120000},
  reporter:"list",
});
