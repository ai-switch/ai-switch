import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGenerator } from "unocss";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelMappingSummary } from "../src/components/accounts/ModelMappingSummary";
import { UsageTrendChart } from "../src/components/accounts/UsageTrendChart";
import unoConfig from "../uno.config";

const translucentSurfaces = [55, 65, 84, 86, 88, 90, 95].map((opacity) => `bg-white/${opacity}`);
const statusStyles = [
  "bg-amber-50/80 text-amber-900 border-amber-200",
  "bg-red-50 text-red-700 border-red-200",
  "bg-blue-50/70 text-blue-900 border-blue-200",
  "bg-emerald-50 text-emerald-950 border-emerald-200",
  "bg-orange-100 text-orange-800 border-orange-200",
  "bg-sky-50/60 text-sky-800/80 border-sky-200",
  "bg-teal-50 text-teal-800",
  "bg-violet-50 text-violet-900 border-violet-200",
  "bg-indigo-50 text-indigo-800",
  "bg-cyan-50 text-cyan-800",
  "bg-rose-100 text-rose-900",
];
const neutralStyles = [
  "bg-stone-50/80 text-stone-500",
  "bg-stone-100/90 text-stone-600",
  "bg-slate-100 text-slate-700",
  "bg-white text-stone-400",
];
let stylesheet: HTMLStyleElement;
let host: HTMLDivElement;

// Composite transparent colors before checking contrast. These fixtures mirror
// actual cards, badges and dialogs, rather than merely checking CSS source text.
function rgb(color: string): number[] {
  if (/^#[0-9a-f]{6}$/i.test(color)) return [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
  const values = color.match(/[\d.]+/g)?.map(Number) ?? [];
  if (values.length < 3) throw new Error(`Unresolved color: ${color}`);
  return values;
}
function composite(color: number[], background: number[]): number[] {
  const alpha = color[3] ?? 1;
  return color.slice(0, 3).map((value, i) => value * alpha + background[i] * (1 - alpha));
}
function luminance(color: number[]): number {
  const linear = color.slice(0, 3).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function assertDarkReadable(element: HTMLElement) {
  const style = getComputedStyle(element);
  const background = composite(rgb(style.backgroundColor), [25, 22, 20]);
  const foreground = composite(rgb(style.color), background);
  const backgroundLight = luminance(background);
  const foregroundLight = luminance(foreground);
  expect(backgroundLight, `${element.className}: background must not stay light`).toBeLessThan(0.15);
  expect((foregroundLight + 0.05) / (backgroundLight + 0.05), `${element.className}: text contrast`).toBeGreaterThanOrEqual(4.5);
}
function sample(classes: string, parent: HTMLElement = host, tag = "div"): HTMLElement {
  const element = document.createElement(tag);
  element.className = classes;
  element.textContent = "Readable status";
  parent.append(element);
  return element;
}

beforeAll(async () => {
  const uno = await createGenerator(unoConfig);
  const utilities = await uno.generate([
    ...translucentSurfaces, ...statusStyles, ...neutralStyles,
    "bg-white text-stone-950 bg-stone-900 text-white bg-white/12",
    "border border-stone-200 divide-y divide-stone-100 ring-1 ring-red-200",
    await readFile("src/components/accounts/ModelMappingSummary.tsx", "utf8"),
    await readFile("src/components/accounts/UsageTrendChart.tsx", "utf8"),
  ].join(" "));
  stylesheet = document.createElement("style");
  stylesheet.textContent = utilities.css + (await readFile("src/styles.css", "utf8")).replace(/^@import[^;]+;/gm, "");
  stylesheet.textContent += await readFile("src/imagegen/imagegen.css", "utf8");
  document.head.append(stylesheet);
});
afterAll(() => stylesheet.remove());
afterEach(() => {
  host?.remove();
  document.documentElement.classList.remove("dark");
});

function mount(dark = true) {
  document.documentElement.classList.toggle("dark", dark);
  host = document.createElement("div");
  host.className = "app-shell";
  document.body.append(host);
}

describe("dark theme colors", () => {
  it.each(translucentSurfaces)("keeps %s cards dark without losing their opacity", (surface) => {
    mount();
    const element = sample(`${surface} text-stone-950`);
    assertDarkReadable(element);
    expect(rgb(getComputedStyle(element).backgroundColor)[3]).toBeCloseTo(Number(surface.split("/")[1]) / 100);
  });

  it.each(statusStyles)("keeps the status palette readable: %s", (classes) => {
    mount();
    assertDarkReadable(sample(classes));
  });

  it.each(neutralStyles)("keeps neutral surfaces and muted text readable: %s", (classes) => {
    mount();
    assertDarkReadable(sample(classes));
  });

  it("themes dialogs outside AppLayout, including the update and deep-link prompts", () => {
    mount();
    host.className = "motion-dialog";
    assertDarkReadable(sample("bg-white text-stone-950"));
  });

  it("retains white action labels and translucent highlights on solid buttons", () => {
    mount();
    const button = sample("bg-stone-900 text-white");
    expect(rgb(getComputedStyle(button).color).slice(0, 3)).toEqual([255, 255, 255]);
    expect(getComputedStyle(sample("bg-white/12", button)).backgroundColor).toBe("rgba(255, 255, 255, 0.12)");
    assertDarkReadable(button);
  });

  it("keeps Vibe's light and skin utilities independent of the document theme", () => {
    mount(false);
    const vibe = sample("text-stone-950");
    vibe.setAttribute("data-vibe-theme", "light");
    const card = sample("bg-white text-stone-950 border border-stone-200", vibe);
    const input = sample("bg-white text-stone-950 border border-stone-200", vibe, "input");
    const before = [vibe, card, input].map((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.backgroundColor, style.borderColor];
    });
    document.documentElement.classList.add("dark");
    for (const theme of ["light", "dark", "skin"]) {
      vibe.setAttribute("data-vibe-theme", theme);
      expect([vibe, card, input].map((element) => {
        const style = getComputedStyle(element);
        return [style.color, style.backgroundColor, style.borderColor];
      })).toEqual(before);
    }
  });

  it("does not override a SaaS panel's independent theme", () => {
    mount(false);
    const saas = sample("saas-root");
    const input = sample("bg-white text-stone-950 border border-stone-200", saas, "input");
    const before = getComputedStyle(input).cssText;
    document.documentElement.classList.add("dark");
    expect(getComputedStyle(input).cssText).toBe(before);
  });

  it("renders model mapping badges with a dark readable surface", () => {
    mount();
    host.innerHTML = renderToStaticMarkup(createElement(ModelMappingSummary, {
      platform: "codex", mappings: [{ from: "alias", to: "upstream" }],
    }));
    const badge = host.querySelector<HTMLElement>("span[title]")!;
    expect(badge.textContent).toBe("alias");
    assertDarkReadable(badge);
  });

  it("adapts image generation panels, user messages and composer surfaces", () => {
    mount();
    host.innerHTML = `<section class="imagegen-shell">
      <aside class="imagegen-sessions"><div class="imagegen-panel-title"><h1>Images</h1></div></aside>
      <main class="imagegen-workspace"><header><h2>Session</h2></header>
        <div class="imagegen-timeline"><article>Assistant</article><article class="user">Prompt</article></div>
        <footer class="imagegen-composer">Composer</footer>
      </main></section>`;
    for (const selector of [".imagegen-shell", ".imagegen-sessions", ".imagegen-workspace", ".imagegen-timeline article", ".imagegen-timeline article.user", ".imagegen-composer"]) {
      assertDarkReadable(host.querySelector<HTMLElement>(selector)!);
    }
  });

  it("adapts SVG usage chart labels and grid lines without changing data colors", () => {
    mount();
    host.innerHTML = renderToStaticMarkup(createElement(UsageTrendChart, {
      buckets: [{ start: "2026-09-14", label: "09-14", title: "2026-09-14", request_count: 1, input_tokens: 100, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, cost_micros: 0 }],
      dimensionLabel: "Model", rows: [{ key: "test-model", tokens: [100] }], undatedRequestCount: 0, unit: "day",
    }));
    const total = [...host.querySelectorAll("text")].find((element) => element.getAttribute("text-anchor") === "middle" && Number(element.getAttribute("y")) < 186)!;
    const style = getComputedStyle(total);
    const fill = style.fill || total.getAttribute("fill")!;
    const foreground = rgb(fill === "currentColor" ? style.color : fill);
    expect((luminance(foreground) + 0.05) / (luminance([34, 31, 28]) + 0.05)).toBeGreaterThanOrEqual(4.5);
    const baseline = host.querySelector("line")!;
    const baselineStyle = getComputedStyle(baseline);
    const stroke = baselineStyle.stroke || baseline.getAttribute("stroke")!;
    expect(luminance(rgb(stroke === "currentColor" ? baselineStyle.color : stroke))).toBeLessThan(0.3);
  });

  it("does not replace validation borders on input fields with neutral gray", () => {
    mount();
    const badge = sample("border-red-200");
    const input = sample("border-red-200", host, "input");
    expect(getComputedStyle(input).borderColor).toBe(getComputedStyle(badge).borderColor);
  });

  it("preserves the existing light palette", () => {
    mount(false);
    const card = sample("bg-white text-stone-950");
    expect(rgb(getComputedStyle(card).backgroundColor).slice(0, 3)).toEqual([255, 255, 255]);
    const warning = sample("bg-amber-50/80 text-amber-900");
    expect(getComputedStyle(warning).backgroundColor).toBe("rgba(255, 251, 235, 0.8)");
  });
});
