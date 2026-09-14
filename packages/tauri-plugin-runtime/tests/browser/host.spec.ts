import { expect, test } from "@playwright/test";

const root = "http://127.0.0.1:43171/runtime-host";
const view = (page: import("@playwright/test").Page, id: string) => page.frameLocator(`[data-view="${id}"] iframe`);
async function mount(page: import("@playwright/test").Page, id: string) {
  await page.getByRole("button", { name: `Mount ${id}`, exact: true }).click();
  await expect(page.locator(`#status-${id}`)).toHaveText("mounted");
}

test("two plugin instances use isolated state and disposal leaves the other alive", async ({ page }) => {
  await page.goto(root); await mount(page, "A"); await mount(page, "B");
  await view(page, "A").getByRole("textbox", { name: "Value" }).fill("only-a");
  await view(page, "A").getByRole("button", { name: "Save", exact: true }).click();
  await expect(view(page, "A").locator("#result")).toHaveText("saved");
  await view(page, "B").getByRole("button", { name: "Read", exact: true }).click();
  await expect(view(page, "B").locator("#result")).toHaveText("empty");
  await page.getByRole("button", { name: "Dispose A", exact: true }).click();
  await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
  await expect(page.locator("#active")).toHaveText("1");
  await view(page, "B").getByRole("button", { name: "Read", exact: true }).click();
  await expect(view(page, "B").locator("#result")).toHaveText("empty");
});

test("default origin policy rejects unapproved plugin assets before loading", async ({ page }) => {
  await page.goto(`${root}?mode=disallowed-origin`);
  await page.getByRole("button", { name: "Mount A", exact: true }).click();
  await expect(page.locator("#status-A")).toHaveText("error:E_PERMISSION_DENIED");
  await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
  await expect(page.locator("#active")).toHaveText("0");
});

test("timed-out opens are not mounted and late sessions are closed", async ({ page }) => {
  await page.goto(`${root}?mode=slow-open`);
  await page.getByRole("button", { name: "Mount A", exact: true }).click();
  await expect(page.locator("#status-A")).toHaveText("error:E_TIMEOUT");
  await page.getByRole("button", { name: "Resolve opens", exact: true }).click();
  await expect(page.locator("#closes")).toHaveText("1");
  await expect(page.locator("#active")).toHaveText("0");
  await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
});

test("disposing a host with an open in flight rejects mount and closes the late session", async ({ page }) => {
  await page.goto(`${root}?mode=slow-open`);
  await page.getByRole("button", { name: "Mount A", exact: true }).click();
  await expect(page.locator("#opens")).toHaveText("1");
  await page.getByRole("button", { name: "Dispose host", exact: true }).click();
  await expect(page.locator("#status-A")).toHaveText("error:E_SESSION_CLOSED");
  await page.getByRole("button", { name: "Resolve opens", exact: true }).click();
  await expect(page.locator("#closes")).toHaveText("1");
  await expect(page.locator("#listeners")).toHaveText("0");
});

test("a session closed before open returns is never mounted", async ({ page }) => {
  await page.goto(`${root}?mode=early-close`);
  await page.getByRole("button", { name: "Mount A", exact: true }).click();
  await expect(page.locator("#status-A")).toHaveText("error:E_SESSION_CLOSED");
  await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
  await expect(page.locator("#active")).toHaveText("0");
});

test("removing a container releases the session, requests and subscriptions", async ({ page }) => {
  await page.goto(root); await mount(page, "A");
  await view(page, "A").getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(view(page, "A").locator("#result")).toHaveText("subscribed");
  await page.getByRole("button", { name: "Remove A", exact: true }).click();
  await expect(page.locator("#active")).toHaveText("0");
  await expect(page.locator("#subscriptions")).toHaveText("0");
  await expect(page.locator("#listeners")).toHaveText("0");
});

test("events are routed by session and stable logical id across reconnects", async ({ page }) => {
  await page.goto(root); await mount(page, "A"); await mount(page, "B");
  await view(page, "A").getByRole("button", { name: "Subscribe", exact: true }).click();
  await view(page, "B").getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.locator("#subscriptions")).toHaveText("2");
  await page.getByRole("button", { name: "Emit A", exact: true }).click();
  await expect(view(page, "A").locator("#events")).toHaveText("1");
  await expect(view(page, "B").locator("#events")).toHaveText("0");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(view(page, "A").locator("#connection")).toHaveText("disconnected");
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(view(page, "A").locator("#connection")).toHaveText("connected");
  await page.getByRole("button", { name: "Emit stale A", exact: true }).click();
  await page.getByRole("button", { name: "Emit A", exact: true }).click();
  await expect(view(page, "A").locator("#events")).toHaveText("2");
  await view(page, "A").getByRole("button", { name: "Unsubscribe", exact: true }).click();
  await expect(page.locator("#subscriptions")).toHaveText("1");
});

test("early events arriving before backend subscription replies are delivered once", async ({ page }) => {
  await page.goto(`${root}?mode=early-event`); await mount(page, "A");
  await view(page, "A").getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(view(page, "A").locator("#events")).toHaveText("1");
  await page.getByRole("button", { name: "Emit duplicate A", exact: true }).click();
  await view(page, "A").getByRole("button", { name: "Read", exact: true }).click();
  await expect(view(page, "A").locator("#result")).toHaveText("empty");
  await expect(view(page, "A").locator("#events")).toHaveText("1");
});

test("remote session close removes the view and cancelling a request reaches its backend", async ({ page }) => {
  await page.goto(root); await mount(page, "A");
  await view(page, "A").getByRole("button", { name: "Wait", exact: true }).click();
  await expect(page.locator("#waiting")).toHaveText("1");
  await view(page, "A").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#cancels")).toHaveText("1");
  await expect(view(page, "A").locator("#result")).toHaveText("error:E_CANCELLED");
  await page.getByRole("button", { name: "Close A remotely", exact: true }).click();
  await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
  await expect(page.locator("#active")).toHaveText("0");
});

test("reload invalidates a view instead of reusing its old session", async ({ page }) => {
  await page.goto(root); await mount(page, "A");
  await view(page, "A").getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
  await expect(page.locator("#active")).toHaveText("0");
});

test("handshake timeout releases the session rather than leaving an inert iframe", async ({ page }) => {
  await page.goto(`${root}?mode=no-handshake`);
  await page.getByRole("button", { name: "Mount A", exact: true }).click();
  await expect(page.locator("#status-A")).toHaveText("error:E_TIMEOUT");
  await expect(page.locator("#active")).toHaveText("0");
  await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
  await expect(page.locator("#listeners")).toHaveText("0");
});

for (const [mode, expected] of [["attack-unknown", "E_CAPABILITY_UNAVAILABLE"], ["attack-subscription", "E_PERMISSION_DENIED"], ["attack-dom", "blocked"]]) {
  test(`host enforcement does not rely on the friendly plugin SDK: ${mode}`, async ({ page }) => {
    await page.goto(`${root}?mode=${mode}`); await mount(page, "A");
    await page.getByRole("button", { name: "Probe A", exact: true }).click();
    await expect(page.locator("#probe-result")).toHaveText(expected);
    await expect(page.locator("#denied")).toHaveText("0");
  });
}
for (const mode of ["attack-identity", "attack-ack"]) {
  test(`invalid plugin control messages invalidate the bound session: ${mode}`, async ({ page }) => {
    await page.goto(`${root}?mode=${mode}`); await mount(page, "A");
    await page.getByRole("button", { name: "Probe A", exact: true }).click();
    await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
    await expect(page.locator("#active")).toHaveText("0");
  });
}

test("reconnect never replays a completed write", async ({ page }) => {
  await page.goto(root); await mount(page, "A");
  await view(page, "A").getByRole("textbox", { name: "Value" }).fill("once");
  await view(page, "A").getByRole("button", { name: "Save", exact: true }).click();
  await expect(view(page, "A").locator("#result")).toHaveText("saved");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(view(page, "A").locator("#connection")).toHaveText("disconnected");
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(view(page, "A").locator("#connection")).toHaveText("connected");
  await view(page, "A").getByRole("button", { name: "Read", exact: true }).click();
  await expect(view(page, "A").locator("#result")).toHaveText("once");
  await expect(page.locator("#writes")).toHaveText("1");
});

test("a fresh mount can recover after the last offline view was disposed", async ({ page }) => {
  await page.goto(root); await mount(page, "A");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(view(page, "A").locator("#connection")).toHaveText("disconnected");
  await page.getByRole("button", { name: "Dispose A", exact: true }).click();
  await expect(page.locator("#listeners")).toHaveText("0");
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await mount(page, "B");
  await expect(page.locator("#active")).toHaveText("1");
});

test("moving a live container does not leave stale ancestor cleanup observers", async ({ page }) => {
  await page.goto(root); await mount(page, "A");
  await page.getByRole("button", { name: "Move A", exact: true }).click();
  await expect(page.locator('#move-parent [data-view="A"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Remove moved parent", exact: true }).click();
  await expect(page.locator("#active")).toHaveText("0");
  await expect(page.locator("#listeners")).toHaveText("0");
});

test("a reused backend session cannot close or replace the original plugin instance", async ({ page }) => {
  await page.goto(`${root}?mode=duplicate-session`); await mount(page, "A");
  await page.getByRole("button", { name: "Mount B", exact: true }).click();
  await expect(page.locator("#status-B")).toHaveText("error:E_PROTOCOL_MISMATCH");
  await expect(page.locator("#active")).toHaveText("1");
  await expect(page.locator("#closes")).toHaveText("0");
  await view(page, "A").getByRole("button", { name: "Read", exact: true }).click();
  await expect(view(page, "A").locator("#result")).toHaveText("empty");
});

test("transport unsubscribe failures cannot prevent session cleanup", async ({ page }) => {
  await page.goto(`${root}?mode=throwing-unsubscribe`); await mount(page, "A");
  await page.getByRole("button", { name: "Dispose A", exact: true }).click();
  await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
  await expect(page.locator("#closes")).toHaveText("1");
  await expect(page.locator("#active")).toHaveText("0");
});

test("bounded closed-session history fails pending mounts closed instead of forgetting revocations", async ({ page }) => {
  await page.goto(`${root}?mode=close-history-overflow`);
  await page.getByRole("button", { name: "Mount A", exact: true }).click();
  await expect(page.locator("#status-A")).toHaveText("error:E_LIMIT_EXCEEDED");
  await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
  await expect(page.locator("#active")).toHaveText("0");
});

test("host request timeout cancels the backend without hanging the plugin view", async ({ page }) => {
  await page.goto(root); await mount(page, "A");
  await view(page, "A").getByRole("button", { name: "Wait", exact: true }).click();
  await expect(view(page, "A").locator("#result")).toHaveText("error:E_TIMEOUT");
  await expect(page.locator("#cancels")).toHaveText("1");
  await expect(page.locator("#waiting")).toHaveText("0");
  await expect(page.locator("#active")).toHaveText("1");
});

test("disposing a view aborts and releases an in-flight backend request", async ({ page }) => {
  await page.goto(root); await mount(page, "A");
  await view(page, "A").getByRole("button", { name: "Wait", exact: true }).click();
  await expect(page.locator("#waiting")).toHaveText("1");
  await page.getByRole("button", { name: "Dispose A", exact: true }).click();
  await expect(page.locator("#waiting")).toHaveText("0");
  await expect(page.locator("#active")).toHaveText("0");
});

test("late transport listeners are released after startup times out", async ({ page }) => {
  await page.goto(`${root}?mode=slow-listener`);
  await page.getByRole("button", { name: "Mount A", exact: true }).click();
  await expect(page.locator("#listeners")).toHaveText("1");
  await expect(page.locator("#status-A")).toHaveText("error:E_TIMEOUT");
  await expect(page.locator("#opens")).toHaveText("0");
  await page.getByRole("button", { name: "Resolve opens", exact: true }).click();
  await expect(page.locator("#listeners")).toHaveText("0");
  await expect(page.locator('[data-view="A"] iframe')).toHaveCount(0);
});

test("concurrent duplicate session replies do not close the winning mounted view", async ({ page }) => {
  await page.goto(`${root}?mode=concurrent-duplicate`);
  await page.getByRole("button", { name: "Mount A", exact: true }).click();
  await page.getByRole("button", { name: "Mount B", exact: true }).click();
  await expect(page.locator("#opens")).toHaveText("2");
  await page.getByRole("button", { name: "Resolve opens", exact: true }).click();
  await expect(page.locator("#status-A")).toHaveText("mounted");
  await expect(page.locator("#status-B")).toHaveText("error:E_PROTOCOL_MISMATCH");
  await expect(page.locator("#active")).toHaveText("1");
  await expect(page.locator("#closes")).toHaveText("0");
});
