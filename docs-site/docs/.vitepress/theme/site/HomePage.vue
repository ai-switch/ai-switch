<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useData, withBase } from "vitepress";
import AppShowcase from "./AppShowcase.vue";
import {
  COPY,
  PLATFORMS,
  STACK,
  REPO,
  RELEASES,
  ISSUES,
  DISCUSSIONS,
  LINUX_INSTALL_COMMAND,
} from "./copy";

const { localeIndex } = useData();
const isEn = computed(() => localeIndex.value === "en");
const t = computed(() => (isEn.value ? COPY.en : COPY.root));

// cleanUrls is false, so internal links need their .html suffix. Directory
// links already end with "/" and map to index.html on GitHub Pages.
const doc = (path: string) =>
  withBase(
    `${isEn.value ? "/en" : ""}${path.endsWith("/") ? path : `${path}.html`}`,
  );

const PLATFORM_ICONS: Record<string, string> = {
  codex: `<svg viewBox="2 2 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z" fill="url(#hp-codex-g)"/><defs><linearGradient gradientUnits="userSpaceOnUse" id="hp-codex-g" x1="12" x2="12" y1="3" y2="21"><stop stop-color="#B1A7FF"/><stop offset=".5" stop-color="#7A9DFF"/><stop offset="1" stop-color="#3941FF"/></linearGradient></defs></svg>`,
  claude: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path clip-rule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95H3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" fill="#D97757" fill-rule="evenodd"/></svg>`,
  gemini: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 4.391A4.391 4.391 0 014.391 0h15.217A4.391 4.391 0 0124 4.391v15.217A4.391 4.391 0 0119.608 24H4.391A4.391 4.391 0 010 19.608V4.391z" fill="url(#hp-gemini-g)"/><path clip-rule="evenodd" d="M19.74 1.444a2.816 2.816 0 012.816 2.816v15.48a2.816 2.816 0 01-2.816 2.816H4.26a2.816 2.816 0 01-2.816-2.816V4.26A2.816 2.816 0 014.26 1.444h15.48zM7.236 8.564l7.752 3.728-7.752 3.727v2.802l9.557-4.596v-3.866L7.236 5.763v2.801z" fill="#1E1E2E" fill-rule="evenodd"/><defs><linearGradient gradientUnits="userSpaceOnUse" id="hp-gemini-g" x1="24" x2="0" y1="6.587" y2="16.494"><stop stop-color="#EE4D5D"/><stop offset=".328" stop-color="#B381DD"/><stop offset=".476" stop-color="#207CFE"/></linearGradient></defs></svg>`,
  grok: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect fill="#0B0F14" height="24" rx="5" width="24"/><path d="M6.2 7.4h2.1l2.1 5.2 2.1-5.2h2.1l-3.4 8.1H9.6L6.2 7.4zm10.1 0H18v8.1h-1.7V7.4z" fill="#F8FAFC"/><circle cx="18.4" cy="16.8" fill="#22D3EE" r="1.1"/></svg>`,
  opencode: `<svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M16 6H8v12h8V6zm4 16H4V2h16v20z"/></svg>`,
  openclaw: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.568c-6.33 0-9.495 5.275-9.495 9.495 0 4.22 3.165 8.44 6.33 9.494v2.11h2.11v-2.11s1.055.422 2.11 0v2.11h2.11v-2.11c3.165-1.055 6.33-5.274 6.33-9.494S18.33 2.568 12 2.568z" fill="#FF4D4D"/><path d="M3.56 9.953C.396 8.898-.66 11.008.396 13.118c1.055 2.11 3.164 1.055 4.22-1.055.632-1.477 0-2.11-1.056-2.11zM20.44 9.953c3.164-1.055 4.22 1.055 3.164 3.165-1.055 2.11-3.164 1.055-4.22-1.055-.632-1.477 0-2.11 1.056-2.11z" fill="#FF4D4D"/><path d="M8.835 9.109a1.266 1.266 0 100-2.532 1.266 1.266 0 000 2.532zM15.165 9.109a1.266 1.266 0 100-2.532 1.266 1.266 0 000 2.532z" fill="#050810"/><path d="M9.046 8.16a.527.527 0 100-1.056.527.527 0 100 1.055zM15.376 8.16a.527.527 0 100-1.055.527.527 0 100 1.054z" fill="#00E5CC"/></svg>`,
  hermes: `<svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect height="20" rx="6" stroke="currentColor" stroke-width="2" width="20" x="2" y="2"/><path d="M7 16V8M17 8v8M8 12h8M5 7.2l2.4-2.1M19 7.2l-2.4-2.1" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`,
};

const stroke = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const ICONS: Record<string, string> = {
  pool: stroke('<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="7" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>'),
  bridge: stroke('<path d="M4 7h5a3 3 0 013 3v4a3 3 0 003 3h5"/><path d="M4 17h5a3 3 0 003-3v-4a3 3 0 013-3h5"/><circle cx="4" cy="7" r="1.4"/><circle cx="20" cy="17" r="1.4"/>'),
  shield: stroke('<path d="M12 3l7 3v5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>'),
  chart: stroke('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  write: stroke('<path d="M12 20H5a2 2 0 01-2-2V6a2 2 0 012-2h9"/><path d="M8 9h6M8 13h4"/><path d="M17 4l3 3-8 8-3 1 1-3 7-9z"/>'),
  test: stroke('<path d="M4 5h16v11H9l-5 4V5z"/><path d="M8 10l2 2 4-4"/>'),
  terminal: stroke('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 9l3 3-3 3M12 15h5"/>'),
  plugin: stroke('<path d="M9 3v4M15 3v4M6 7h12v5a6 6 0 01-6 6 6 6 0 01-6-6V7z"/><path d="M12 18v3"/>'),
  globe: stroke('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
};

/* Scroll reveal — progressive enhancement, never hides content if JS is off
   in a browser without IntersectionObserver or with reduced motion. */
let observer: IntersectionObserver | undefined;
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(LINUX_INSTALL_COMMAND);
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied.value = false), 2000);
  } catch {
    copied.value = false;
  }
}

onMounted(() => {
  const els = Array.from(document.querySelectorAll<HTMLElement>(".hp-reveal"));
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    els.forEach((el) => el.classList.add("hp-in"));
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("hp-in");
          observer?.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -40px 0px", threshold: 0.08 },
  );
  els.forEach((el) => observer?.observe(el));
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<template>
  <div class="hp-home">
    <!-- ============================ HERO ============================ -->
    <section class="hp-hero">
      <div class="hp-hero-glow hp-glow-1" />
      <div class="hp-hero-glow hp-glow-2" />
      <div class="hp-hero-glow hp-glow-3" />
      <div class="hp-wrap">
        <a class="hp-announce" :href="RELEASES" target="_blank" rel="noreferrer">
          <span class="hp-announce-dot" />
          <span class="hp-announce-text">{{ t.announcement }}</span>
          <span class="hp-announce-link">{{ t.announcementLink }} <b>→</b></span>
        </a>

        <div class="hp-hero-grid">
          <div class="hp-hero-copy">
            <p class="hp-eyebrow"><span class="hp-eyebrow-line" />{{ t.hero.eyebrow }}</p>
            <h1 class="hp-hero-title">
              <span>{{ t.hero.titleA }}</span>
              <em>{{ t.hero.titleB }}</em>
            </h1>
            <p class="hp-hero-lead">{{ t.hero.lead }}</p>
            <div class="hp-cta-row">
              <a class="hp-btn hp-btn-primary" :href="RELEASES" target="_blank" rel="noreferrer">
                {{ t.hero.primary }} <span aria-hidden="true">↗</span>
              </a>
              <a class="hp-btn hp-btn-ghost" :href="doc('/guide/quick-start')">
                {{ t.hero.secondary }} <span aria-hidden="true">→</span>
              </a>
              <a class="hp-hero-link" :href="REPO" target="_blank" rel="noreferrer">
                {{ t.hero.tertiary }} <span aria-hidden="true">↗</span>
              </a>
            </div>
            <p class="hp-hero-hint"><span class="hp-hint-check">✓</span> {{ t.hero.hint }}</p>
            <dl class="hp-stats">
              <div v-for="s in t.hero.stats" :key="s.label" class="hp-stat">
                <dt>{{ s.value }}</dt>
                <dd>{{ s.label }}</dd>
              </div>
            </dl>
          </div>

          <div class="hp-hero-visual">
            <div class="hp-visual-ring" />
            <AppShowcase
              compact
              :tabs="t.showcase.tabs"
              :window-label="t.hero.windowLabel"
              :window-badge="t.hero.windowBadge"
              :is-en="isEn"
            />
            <div class="hp-float hp-float-a"><span>◈</span> 4 <small>protocols</small></div>
            <div class="hp-float hp-float-b"><span>●</span> auto failover</div>
          </div>
        </div>
      </div>
      <div class="hp-hero-fade" />
    </section>

    <!-- ========================== TRUST =========================== -->
    <section class="hp-section hp-trust hp-reveal">
      <div class="hp-wrap">
        <div class="hp-trust-head">
          <h2 class="hp-h2">{{ t.trust.title }}</h2>
          <p class="hp-lead">{{ t.trust.note }}</p>
        </div>
        <ul class="hp-platforms">
          <li v-for="p in PLATFORMS" :key="p.key" class="hp-platform">
            <span class="hp-platform-icon" v-html="PLATFORM_ICONS[p.key]" />
            <span class="hp-platform-name">{{ p.name }}</span>
            <span class="hp-tier-dot" :class="p.tier === 'full' ? 'hp-tier-full' : 'hp-tier-generic'" />
          </li>
        </ul>
        <div class="hp-trust-bottom">
          <ul class="hp-badges">
            <li v-for="b in t.trust.badges" :key="b"><span>✓</span>{{ b }}</li>
          </ul>
          <a class="hp-textlink" :href="doc('/guide/platform-support')">{{ t.trust.matrix }} →</a>
        </div>
      </div>
    </section>

    <!-- =========================== PAIN =========================== -->
    <section class="hp-section hp-alt hp-reveal">
      <div class="hp-wrap">
        <p class="hp-kicker">{{ t.pain.eyebrow }}</p>
        <h2 class="hp-h2 hp-h2-lg">{{ t.pain.title }}</h2>
        <p class="hp-lead">{{ t.pain.lead }}</p>
        <div class="hp-pain-grid">
          <div class="hp-pain-col hp-pain-before">
            <div class="hp-pain-head">
              <span class="hp-pain-mark hp-mark-no">×</span>
              <h3>{{ t.pain.beforeTitle }}</h3>
            </div>
            <ul>
              <li v-for="(item, i) in t.pain.before" :key="i"><span class="hp-li-no">—</span>{{ item }}</li>
            </ul>
          </div>
          <div class="hp-pain-arrow" aria-hidden="true"><span>→</span></div>
          <div class="hp-pain-col hp-pain-after">
            <div class="hp-pain-head">
              <span class="hp-pain-mark hp-mark-yes">✓</span>
              <h3>{{ t.pain.afterTitle }}</h3>
              <span class="hp-pain-badge">{{ t.pain.switchLabel }}</span>
            </div>
            <ul>
              <li v-for="(item, i) in t.pain.after" :key="i"><span class="hp-li-yes">✓</span>{{ item }}</li>
            </ul>
            <p class="hp-pain-note">{{ t.pain.safeNote }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ========================= FEATURES ======================== -->
    <section id="features" class="hp-section hp-reveal">
      <div class="hp-wrap">
        <p class="hp-kicker">{{ t.features.eyebrow }}</p>
        <h2 class="hp-h2 hp-h2-lg">{{ t.features.title }}</h2>
        <p class="hp-lead">{{ t.features.lead }}</p>
        <div class="hp-feature-grid">
          <a v-for="(f, i) in t.features.items" :key="f.title" class="hp-feature" :href="doc(f.to)">
            <span class="hp-feature-icon" :class="`hp-icon-${i % 4}`" v-html="ICONS[f.icon]" />
            <h3>{{ f.title }}</h3>
            <p>{{ f.body }}</p>
            <span class="hp-feature-more">→</span>
          </a>
        </div>
        <div class="hp-section-foot">
          <a class="hp-textlink" :href="doc('/guide/introduction')">{{ t.features.more }} →</a>
        </div>
      </div>
    </section>

    <!-- ========================= SHOWCASE ======================== -->
    <section class="hp-section hp-alt hp-reveal">
      <div class="hp-wrap hp-center">
        <p class="hp-kicker">{{ t.showcase.eyebrow }}</p>
        <h2 class="hp-h2 hp-h2-lg">{{ t.showcase.title }}</h2>
        <p class="hp-lead hp-lead-center">{{ t.showcase.lead }}</p>
      </div>
      <div class="hp-wrap hp-showcase-wrap">
        <div class="hp-showcase-frame">
          <AppShowcase
            :tabs="t.showcase.tabs"
            :window-label="t.hero.windowLabel"
            :window-badge="t.hero.windowBadge"
            :is-en="isEn"
          />
        </div>
        <div class="hp-section-foot hp-center">
          <a class="hp-textlink" :href="doc('/guide/quick-start')">{{ t.showcase.more }} →</a>
        </div>
      </div>
    </section>

    <!-- =========================== FLOW ========================== -->
    <section class="hp-section hp-reveal">
      <div class="hp-wrap">
        <p class="hp-kicker">{{ t.flow.eyebrow }}</p>
        <h2 class="hp-h2 hp-h2-lg">{{ t.flow.title }}</h2>
        <p class="hp-lead">{{ t.flow.lead }}</p>
        <ol class="hp-flow">
          <li v-for="s in t.flow.steps" :key="s.idx" class="hp-step">
            <span class="hp-step-idx">{{ s.idx }}</span>
            <h3>{{ s.name }}</h3>
            <p>{{ s.body }}</p>
            <code>{{ s.tag }}</code>
          </li>
        </ol>
        <div class="hp-flow-panels">
          <div class="hp-chips-panel">
            <p class="hp-panel-label">{{ t.flow.dialectTitle }}</p>
            <ul class="hp-chips hp-chips-dialect">
              <li v-for="d in t.flow.dialects" :key="d"><code>{{ d }}</code></li>
            </ul>
          </div>
          <div class="hp-chips-panel">
            <p class="hp-panel-label">{{ t.flow.bridgeTitle }}</p>
            <ul class="hp-chips">
              <li v-for="b in t.flow.bridges" :key="b">{{ b }}</li>
            </ul>
          </div>
        </div>
        <div class="hp-section-foot">
          <a class="hp-textlink" :href="doc('/guide/protocol-routing')">{{ t.flow.more }} →</a>
        </div>
      </div>
    </section>

    <!-- ========================= TUTORIALS ====================== -->
    <section class="hp-section hp-alt hp-reveal">
      <div class="hp-wrap">
        <div class="hp-section-head-row">
          <div>
            <p class="hp-kicker">{{ t.tutorials.eyebrow }}</p>
            <h2 class="hp-h2 hp-h2-lg">{{ t.tutorials.title }}</h2>
            <p class="hp-lead">{{ t.tutorials.lead }}</p>
          </div>
          <a class="hp-btn hp-btn-outline" :href="doc('/tutorials/')">{{ t.tutorials.more }} →</a>
        </div>
        <div class="hp-tutorial-grid">
          <a v-for="(item, i) in t.tutorials.items" :key="item.title" class="hp-tutorial" :href="doc(item.to)">
            <div class="hp-tutorial-top">
              <span class="hp-tag">{{ item.tag }}</span>
              <span class="hp-minutes">◷ {{ item.minutes }}</span>
            </div>
            <span class="hp-tutorial-idx">{{ String(i + 1).padStart(2, "0") }}</span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.body }}</p>
            <span class="hp-tutorial-go">{{ isEn ? "Read guide" : "阅读教程" }} <b>→</b></span>
          </a>
        </div>
      </div>
    </section>

    <!-- ========================== DEPLOY ======================== -->
    <section class="hp-section hp-reveal">
      <div class="hp-wrap">
        <p class="hp-kicker">{{ t.deploy.eyebrow }}</p>
        <h2 class="hp-h2 hp-h2-lg">{{ t.deploy.title }}</h2>
        <p class="hp-lead">{{ t.deploy.lead }}</p>
        <div class="hp-deploy-grid">
          <a v-for="(d, i) in t.deploy.items" :key="d.name" class="hp-deploy" :href="doc(d.to)">
            <span class="hp-deploy-idx">0{{ i + 1 }}</span>
            <span class="hp-deploy-icon" v-html="ICONS.globe" />
            <h3>{{ d.name }}</h3>
            <p>{{ d.body }}</p>
          </a>
        </div>
        <p class="hp-note">{{ t.deploy.note }}</p>
        <div class="hp-section-foot">
          <a class="hp-textlink" :href="doc('/deploy/desktop')">{{ t.deploy.more }} →</a>
        </div>
      </div>
    </section>

    <!-- ========================== COMPARE ======================= -->
    <section class="hp-section hp-alt hp-reveal">
      <div class="hp-wrap">
        <p class="hp-kicker">{{ t.compare.eyebrow }}</p>
        <h2 class="hp-h2 hp-h2-lg">{{ t.compare.title }}</h2>
        <p class="hp-lead">{{ t.compare.lead }}</p>
        <div class="hp-compare">
          <div class="hp-compare-head">
            <span />
            <span class="hp-compare-manual">{{ t.compare.headManual }}</span>
            <span class="hp-compare-switch"><span class="hp-logo-mini">AS</span>{{ t.compare.headSwitch }}</span>
          </div>
          <div v-for="row in t.compare.rows" :key="row.label" class="hp-compare-row">
            <span class="hp-compare-label">{{ row.label }}</span>
            <span class="hp-compare-manual">{{ row.manual }}</span>
            <span class="hp-compare-switch"><b>✓</b>{{ row.value }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ============================ FAQ ========================= -->
    <section class="hp-section hp-reveal">
      <div class="hp-wrap hp-faq-wrap">
        <p class="hp-kicker">{{ t.faq.eyebrow }}</p>
        <h2 class="hp-h2 hp-h2-lg">{{ t.faq.title }}</h2>
        <p class="hp-lead">{{ t.faq.lead }}</p>
        <div class="hp-faq">
          <details v-for="(item, i) in t.faq.items" :key="item.q" class="hp-faq-item" :open="i === 0">
            <summary>
              <span class="hp-faq-q">{{ item.q }}</span>
              <span class="hp-faq-toggle" aria-hidden="true">+</span>
            </summary>
            <div class="hp-faq-a">
              <p>{{ item.a }}</p>
              <a :href="doc(item.to)">{{ isEn ? "Related docs" : "查看相关文档" }} →</a>
            </div>
          </details>
        </div>
        <div class="hp-section-foot">
          <a class="hp-textlink" :href="doc('/faq')">{{ t.faq.more }} →</a>
        </div>
      </div>
    </section>

    <!-- ======================== OPEN SOURCE ===================== -->
    <section class="hp-opensource hp-reveal">
      <div class="hp-wrap hp-opensource-inner">
        <div class="hp-opensource-copy">
          <p class="hp-kicker hp-kicker-dark">{{ t.opensource.eyebrow }}</p>
          <h2 class="hp-h2 hp-h2-lg">{{ t.opensource.title }}</h2>
          <p class="hp-lead">{{ t.opensource.lead }}</p>
          <div class="hp-cta-row">
            <a class="hp-btn hp-btn-primary" :href="REPO" target="_blank" rel="noreferrer">{{ t.opensource.primary }} ↗</a>
            <a class="hp-btn hp-btn-ghost" :href="ISSUES" target="_blank" rel="noreferrer">{{ t.opensource.secondary }} ↗</a>
            <a class="hp-hero-link" :href="doc('/sponsor')">{{ t.opensource.sponsor }} →</a>
          </div>
        </div>
        <div class="hp-opensource-points">
          <div v-for="p in t.opensource.points" :key="p.title" class="hp-os-point">
            <span class="hp-os-icon">✦</span>
            <h3>{{ p.title }}</h3>
            <p>{{ p.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ========================== DOWNLOAD ====================== -->
    <section class="hp-download">
      <div class="hp-download-glow" />
      <div class="hp-wrap hp-center">
        <p class="hp-kicker hp-kicker-dark">{{ t.download.eyebrow }}</p>
        <h2 class="hp-h2 hp-h2-lg">{{ t.download.title }}</h2>
        <p class="hp-lead hp-lead-center">{{ t.download.lead }}</p>
        <div class="hp-cta-row hp-cta-center">
          <a class="hp-btn hp-btn-primary hp-btn-lg" :href="RELEASES" target="_blank" rel="noreferrer">{{ t.download.primary }} ↗</a>
          <a class="hp-btn hp-btn-ghost hp-btn-lg" :href="doc('/guide/installation')">{{ t.download.secondary }} →</a>
        </div>
        <ul class="hp-os-list">
          <li v-for="os in t.download.os" :key="os.name">
            <b>{{ os.name }}</b>
            <span>{{ os.format }}</span>
          </li>
        </ul>
        <div class="hp-command">
          <div class="hp-command-head">
            <span>{{ t.download.commandTitle }}</span>
            <button type="button" class="hp-copy" @click="copyCommand">{{ copied ? t.download.copied : t.download.copy }}</button>
          </div>
          <code>{{ LINUX_INSTALL_COMMAND }}</code>
          <p>{{ t.download.commandNote }}</p>
        </div>
        <p class="hp-download-note">{{ t.download.note }}</p>
      </div>
    </section>

    <!-- =========================== FOOTER ======================= -->
    <footer class="hp-footer">
      <div class="hp-wrap">
        <div class="hp-footer-top">
          <div class="hp-brand">
            <a class="hp-brand-logo" :href="withBase('/')">
              <span class="hp-logo-mini hp-logo-lg">AS</span>
              <b>AI Switch</b>
            </a>
            <p>{{ t.footer.tagline }}</p>
            <div class="hp-social">
              <a :href="REPO" target="_blank" rel="noreferrer" aria-label="GitHub">GitHub ↗</a>
              <a :href="RELEASES" target="_blank" rel="noreferrer" aria-label="Releases">{{ isEn ? "Releases" : "更新日志" }} ↗</a>
              <a :href="DISCUSSIONS" target="_blank" rel="noreferrer" aria-label="Discussions">{{ isEn ? "Discussions" : "社区" }} ↗</a>
            </div>
          </div>
          <div class="hp-footer-links">
            <div v-for="col in t.footer.columns" :key="col.title" class="hp-footer-col">
              <h3>{{ col.title }}</h3>
              <ul>
                <li v-for="l in col.links" :key="l.text">
                  <a
                    :href="l.href || doc(l.to)"
                    :target="l.href ? '_blank' : undefined"
                    :rel="l.href ? 'noreferrer' : undefined"
                  >{{ l.text }}</a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div class="hp-footer-stack">
          <span class="hp-stack-label">{{ isEn ? "Built with" : "技术栈" }}</span>
          <span v-for="s in STACK" :key="s" class="hp-stack-chip">{{ s }}</span>
        </div>
        <div class="hp-footer-bottom">
          <span>{{ t.footer.built }}</span>
          <span>{{ t.footer.disclaimer }}</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.hp-home {
  --hp-ink: #14201c;
  --hp-muted: #5c6b65;
  --hp-line: rgba(20, 45, 36, 0.11);
  --hp-panel: #ffffff;
  --hp-bg: #fbfdfc;
  --hp-bg-alt: #f1f7f4;
  --hp-emerald: #10b981;
  --hp-emerald-deep: #059669;
  --hp-amber: #f59e0b;
  --hp-violet: #8b5cf6;
  --hp-sky: #0ea5e9;
  --hp-dark: #07110e;
  --hp-radius: 16px;
  color: var(--hp-ink);
  background: var(--hp-bg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  overflow: hidden;
}

.dark .hp-home {
  --hp-ink: #e9f3ee;
  --hp-muted: #9fb2a9;
  --hp-line: rgba(220, 245, 232, 0.11);
  --hp-panel: #121c17;
  --hp-bg: #0a120e;
  --hp-bg-alt: #0e1813;
}

.hp-wrap { width: min(1200px, 100% - 48px); margin: 0 auto; }
.hp-center { text-align: center; }
.hp-section { padding: 88px 0; border-top: 1px solid var(--hp-line); }
.hp-alt { background: var(--hp-bg-alt); }
.hp-reveal { opacity: 0; transform: translateY(22px); transition: opacity 0.65s ease, transform 0.65s cubic-bezier(0.22, 1, 0.36, 1); }
.hp-reveal.hp-in { opacity: 1; transform: none; }

.hp-kicker { margin: 0 0 14px; font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--hp-emerald-deep); }
.dark .hp-kicker { color: #6ee7b7; }
.hp-kicker-dark { color: #6ee7b7; }
.hp-h2 { margin: 0; font-size: 32px; line-height: 1.28; font-weight: 780; letter-spacing: -0.02em; }
.hp-h2-lg { font-size: clamp(28px, 3.4vw, 40px); max-width: 22ch; }
.hp-lead { margin: 16px 0 0; max-width: 74ch; font-size: 15.5px; line-height: 1.78; color: var(--hp-muted); }
.hp-lead-center { margin-left: auto; margin-right: auto; text-align: center; }
.hp-note { margin: 28px 0 0; padding: 14px 18px; border-left: 3px solid var(--hp-emerald); border-radius: 0 10px 10px 0; background: var(--hp-panel); font-size: 13px; line-height: 1.75; color: var(--hp-muted); }
.hp-textlink { display: inline-block; margin-top: 26px; font-size: 14px; font-weight: 650; color: var(--hp-emerald-deep); text-decoration: none; }
.dark .hp-textlink { color: #6ee7b7; }
.hp-textlink:hover { text-decoration: underline; }
.hp-section-foot { margin-top: 30px; }
.hp-section-foot.hp-center { text-align: center; }
.hp-section-head-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; flex-wrap: wrap; }

.hp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 46px; padding: 0 24px; border: 1px solid transparent; border-radius: 999px; font-size: 14.5px; font-weight: 650; text-decoration: none; white-space: nowrap; transition: transform 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease, border-color 0.18s ease; }
.hp-btn:hover { transform: translateY(-2px); }
.hp-btn-primary { background: linear-gradient(135deg, #10b981, #059669); color: #041710; box-shadow: 0 10px 26px -10px rgba(16, 185, 129, 0.85); }
.hp-btn-primary:hover { background: linear-gradient(135deg, #34d399, #10b981); box-shadow: 0 16px 34px -12px rgba(16, 185, 129, 0.9); }
.hp-btn-ghost { border-color: rgba(250, 250, 249, 0.3); color: #f5faf7; background: rgba(255, 255, 255, 0.05); }
.hp-btn-ghost:hover { border-color: #6ee7b7; background: rgba(16, 185, 129, 0.14); }
.hp-btn-outline { border-color: var(--hp-line); color: var(--hp-ink); background: var(--hp-panel); height: 42px; font-size: 13.5px; }
.hp-btn-outline:hover { border-color: var(--hp-emerald); box-shadow: 0 10px 24px -14px rgba(16, 185, 129, 0.8); }
.hp-btn-lg { height: 50px; padding: 0 28px; font-size: 15px; }
.hp-cta-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 30px; }
.hp-cta-center { justify-content: center; }
.hp-hero-link { font-size: 13.5px; font-weight: 600; color: #c7d8cf; text-decoration: none; padding-left: 8px; }
.hp-hero-link:hover { color: #6ee7b7; }

/* ---------------------------------- hero --------------------------------- */
.hp-hero { position: relative; padding: 30px 0 96px; background: radial-gradient(1100px 620px at 8% -18%, rgba(16, 185, 129, 0.24), transparent 60%), radial-gradient(900px 520px at 92% 4%, rgba(14, 165, 233, 0.16), transparent 62%), radial-gradient(700px 460px at 62% 100%, rgba(139, 92, 246, 0.14), transparent 65%), linear-gradient(155deg, #0a1712 0%, #07110e 48%, #0a1419 100%); color: #f2f8f5; isolation: isolate; }
.hp-hero::before { content: ""; position: absolute; inset: 0; z-index: -1; background-image: linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px); background-size: 46px 46px; mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.85), transparent 78%); }
.hp-hero-glow { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.42; pointer-events: none; z-index: -1; }
.hp-glow-1 { width: 340px; height: 340px; top: 60px; left: -80px; background: #10b981; animation: hp-drift 16s ease-in-out infinite; }
.hp-glow-2 { width: 300px; height: 300px; top: 260px; right: -60px; background: #0ea5e9; animation: hp-drift 19s ease-in-out infinite reverse; }
.hp-glow-3 { width: 260px; height: 260px; bottom: -80px; left: 46%; background: #8b5cf6; animation: hp-drift 22s ease-in-out infinite; }
@keyframes hp-drift { 50% { transform: translate(28px, -26px) scale(1.12); } }
.hp-hero-fade { position: absolute; left: 0; right: 0; bottom: 0; height: 70px; background: linear-gradient(180deg, transparent, var(--hp-bg)); pointer-events: none; }

.hp-announce { display: inline-flex; align-items: center; gap: 10px; max-width: 100%; padding: 7px 8px 7px 14px; border: 1px solid rgba(110, 231, 183, 0.28); border-radius: 999px; background: rgba(16, 185, 129, 0.1); color: #c7f5df; font-size: 12.5px; text-decoration: none; transition: border-color 0.2s ease, background-color 0.2s ease; }
.hp-announce:hover { border-color: #6ee7b7; background: rgba(16, 185, 129, 0.18); }
.hp-announce-dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.18); flex: none; }
.hp-announce-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hp-announce-link { padding: 3px 12px; border-radius: 999px; background: rgba(52, 211, 153, 0.18); color: #a7f3d0; font-size: 11.5px; font-weight: 650; white-space: nowrap; }

.hp-hero-grid { display: grid; grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.12fr); gap: 54px; align-items: center; margin-top: 46px; }
.hp-eyebrow { display: flex; align-items: center; gap: 12px; margin: 0 0 20px; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #6ee7b7; }
.hp-eyebrow-line { width: 26px; height: 1px; background: #6ee7b7; }
.hp-hero-title { margin: 0; font-size: clamp(36px, 4.2vw, 55px); line-height: 1.14; font-weight: 820; letter-spacing: -0.032em; }
.hp-hero-title span { display: block; color: #f4fbf7; }
.hp-hero-title em { display: block; font-style: normal; background: linear-gradient(100deg, #6ee7b7 4%, #7dd3fc 48%, #fcd34d 96%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
.hp-hero-lead { margin: 24px 0 0; max-width: 57ch; font-size: 15.5px; line-height: 1.82; color: #b7c9c1; }
.hp-hero-hint { margin: 18px 0 0; font-size: 12.5px; color: #8fa89c; }
.hp-hint-check { color: #6ee7b7; font-weight: 700; }
.hp-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 40px 0 0; padding-top: 24px; border-top: 1px solid rgba(255, 255, 255, 0.13); }
.hp-stat dt { font-size: 27px; font-weight: 760; line-height: 1.1; color: #f4fbf7; letter-spacing: -0.02em; }
.hp-stat dd { margin: 6px 0 0; font-size: 12px; line-height: 1.45; color: #90a89d; }

.hp-hero-visual { position: relative; min-width: 0; }
.hp-visual-ring { position: absolute; inset: -26px -22px; border-radius: 30px; background: radial-gradient(closest-side, rgba(16, 185, 129, 0.2), transparent 72%); filter: blur(18px); pointer-events: none; }
.hp-hero-visual :deep(.sw-window) { position: relative; transform: perspective(1400px) rotateY(-3deg) rotateX(1.5deg); box-shadow: 0 46px 100px -28px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(110, 231, 183, 0.12); }
.hp-float { position: absolute; display: flex; align-items: center; gap: 7px; padding: 8px 14px; border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 12px; background: rgba(16, 28, 24, 0.82); backdrop-filter: blur(12px); box-shadow: 0 14px 34px -14px rgba(0, 0, 0, 0.9); font-size: 12px; font-weight: 650; color: #e8f6ee; white-space: nowrap; animation: hp-float 5s ease-in-out infinite; }
.hp-float span { color: #6ee7b7; }
.hp-float small { color: #93aa9f; font-weight: 500; }
.hp-float-a { top: -18px; right: -10px; }
.hp-float-b { bottom: -16px; left: -18px; animation-delay: 1.4s; }
.hp-float-b span { color: #fcd34d; }
@keyframes hp-float { 50% { transform: translateY(-8px); } }

/* -------------------------------- trust --------------------------------- */
.hp-trust { padding: 66px 0; }
.hp-trust-head { display: flex; align-items: baseline; justify-content: space-between; gap: 32px; flex-wrap: wrap; }
.hp-trust-head .hp-h2 { font-size: 23px; }
.hp-trust-head .hp-lead { margin: 0; max-width: 62ch; font-size: 13.5px; }
.hp-platforms { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; margin: 30px 0 0; padding: 0; list-style: none; }
.hp-platform { display: flex; align-items: center; gap: 9px; padding: 12px 11px; border: 1px solid var(--hp-line); border-radius: 11px; background: var(--hp-panel); box-shadow: 0 6px 18px -16px rgba(0, 0, 0, 0.5); transition: transform 0.18s ease, border-color 0.18s ease; }
.hp-platform:hover { transform: translateY(-3px); border-color: var(--hp-emerald); }
.hp-platform-icon { display: inline-flex; width: 24px; height: 24px; flex: none; color: var(--hp-muted); }
.hp-platform-icon :deep(svg) { width: 100%; height: 100%; }
.hp-platform-name { font-size: 12.5px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hp-tier-dot { width: 6px; height: 6px; border-radius: 50%; margin-left: auto; flex: none; }
.hp-tier-full { background: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.16); }
.hp-tier-generic { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.16); }
.hp-trust-bottom { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; margin-top: 26px; }
.hp-badges { display: flex; flex-wrap: wrap; gap: 10px 20px; margin: 0; padding: 0; list-style: none; }
.hp-badges li { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--hp-muted); }
.hp-badges span { color: var(--hp-emerald-deep); font-weight: 800; }
.dark .hp-badges span { color: #6ee7b7; }
.hp-trust-bottom .hp-textlink { margin-top: 0; }

/* --------------------------------- pain --------------------------------- */
.hp-pain-grid { display: grid; grid-template-columns: minmax(0, 1fr) 54px minmax(0, 1fr); gap: 0; align-items: stretch; margin-top: 40px; }
.hp-pain-col { padding: 28px 28px 26px; border: 1px solid var(--hp-line); border-radius: var(--hp-radius); background: var(--hp-panel); }
.hp-pain-before { border-color: rgba(148, 163, 184, 0.28); }
.hp-pain-after { border-color: rgba(16, 185, 129, 0.4); box-shadow: 0 24px 60px -40px rgba(16, 185, 129, 0.7); }
.hp-pain-head { display: flex; align-items: center; gap: 11px; flex-wrap: wrap; }
.hp-pain-head h3 { margin: 0; font-size: 17px; font-weight: 720; }
.hp-pain-mark { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; font-size: 15px; font-weight: 800; flex: none; }
.hp-mark-no { background: rgba(100, 116, 139, 0.16); color: #64748b; }
.hp-mark-yes { background: rgba(16, 185, 129, 0.16); color: var(--hp-emerald-deep); }
.dark .hp-mark-yes { color: #6ee7b7; }
.hp-pain-badge { margin-left: auto; padding: 3px 10px; border-radius: 999px; background: rgba(16, 185, 129, 0.14); color: var(--hp-emerald-deep); font-size: 11px; font-weight: 700; }
.dark .hp-pain-badge { color: #6ee7b7; }
.hp-pain-col ul { margin: 20px 0 0; padding: 0; list-style: none; }
.hp-pain-col li { display: flex; gap: 11px; padding: 10px 0; border-top: 1px solid var(--hp-line); font-size: 13.5px; line-height: 1.68; color: var(--hp-muted); }
.hp-pain-col li:first-child { border-top: 0; }
.hp-li-no, .hp-li-yes { flex: none; font-weight: 800; }
.hp-li-no { color: #94a3b8; }
.hp-li-yes { color: var(--hp-emerald-deep); }
.dark .hp-li-yes { color: #6ee7b7; }
.hp-pain-after li { color: var(--hp-ink); }
.hp-pain-note { margin: 18px 0 0; padding: 11px 14px; border-radius: 9px; background: rgba(16, 185, 129, 0.09); font-size: 12.5px; line-height: 1.7; color: var(--hp-muted); }
.hp-pain-arrow { display: grid; place-items: center; }
.hp-pain-arrow span { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--hp-line); background: var(--hp-panel); color: var(--hp-emerald-deep); font-size: 18px; }
.dark .hp-pain-arrow span { color: #6ee7b7; }

/* ------------------------------- features ------------------------------- */
.hp-feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 40px; }
.hp-feature { position: relative; display: block; padding: 26px 24px 28px; border: 1px solid var(--hp-line); border-radius: var(--hp-radius); background: var(--hp-panel); text-decoration: none; overflow: hidden; transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease; }
.hp-feature::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 2px; background: linear-gradient(90deg, #10b981, #0ea5e9, transparent); opacity: 0; transition: opacity 0.2s ease; }
.hp-feature:hover { transform: translateY(-4px); border-color: rgba(16, 185, 129, 0.5); box-shadow: 0 22px 46px -30px rgba(16, 185, 129, 0.75); }
.hp-feature:hover::before { opacity: 1; }
.hp-feature-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 11px; background: rgba(16, 185, 129, 0.12); color: var(--hp-emerald-deep); }
.hp-feature-icon :deep(svg) { width: 21px; height: 21px; }
.hp-icon-1 { background: rgba(14, 165, 233, 0.12); color: #0284c7; }
.hp-icon-2 { background: rgba(139, 92, 246, 0.12); color: #7c3aed; }
.hp-icon-3 { background: rgba(245, 158, 11, 0.14); color: #b45309; }
.dark .hp-feature-icon { color: #6ee7b7; }
.dark .hp-icon-1 { color: #7dd3fc; }
.dark .hp-icon-2 { color: #c4b5fd; }
.dark .hp-icon-3 { color: #fcd34d; }
.hp-feature h3 { margin: 18px 0 0; font-size: 16.5px; font-weight: 700; color: var(--hp-ink); }
.hp-feature p { margin: 10px 0 0; font-size: 13.5px; line-height: 1.72; color: var(--hp-muted); }
.hp-feature-more { position: absolute; right: 20px; bottom: 18px; font-size: 16px; color: var(--hp-emerald-deep); opacity: 0; transform: translateX(-6px); transition: opacity 0.2s ease, transform 0.2s ease; }
.dark .hp-feature-more { color: #6ee7b7; }
.hp-feature:hover .hp-feature-more { opacity: 1; transform: none; }

/* ------------------------------- showcase ------------------------------ */
.hp-showcase-wrap { margin-top: 42px; }
.hp-showcase-frame { position: relative; max-width: 1000px; margin: 0 auto; padding: 10px; border: 1px solid var(--hp-line); border-radius: 22px; background: linear-gradient(140deg, rgba(16, 185, 129, 0.12), rgba(14, 165, 233, 0.08), rgba(139, 92, 246, 0.1)); }
.hp-showcase-frame::before { content: ""; position: absolute; inset: -50px; background: radial-gradient(closest-side, rgba(16, 185, 129, 0.16), transparent 72%); filter: blur(30px); z-index: -1; }
.hp-showcase-frame :deep(.sw-window) { border-radius: 13px; }

/* --------------------------------- flow --------------------------------- */
.hp-flow { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin: 40px 0 0; padding: 0; list-style: none; }
.hp-step { position: relative; padding: 22px 18px 20px; border: 1px solid var(--hp-line); border-radius: var(--hp-radius); background: var(--hp-panel); }
.hp-step::after { content: ""; position: absolute; top: 34px; right: -12px; width: 12px; height: 1px; background: var(--hp-line); }
.hp-step:last-child::after { display: none; }
.hp-step-idx { font-size: 12px; font-weight: 800; letter-spacing: 0.08em; color: var(--hp-emerald-deep); }
.dark .hp-step-idx { color: #6ee7b7; }
.hp-step h3 { margin: 12px 0 0; font-size: 15px; font-weight: 700; }
.hp-step p { margin: 9px 0 0; font-size: 12.5px; line-height: 1.68; color: var(--hp-muted); }
.hp-step code { display: inline-block; margin-top: 14px; padding: 4px 9px; border-radius: 6px; background: var(--hp-bg-alt); font-size: 10.5px; color: var(--hp-emerald-deep); }
.dark .hp-step code { color: #7dd3fc; }
.hp-flow-panels { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: 16px; margin-top: 22px; }
.hp-chips-panel { padding: 20px 22px; border: 1px solid var(--hp-line); border-radius: var(--hp-radius); background: var(--hp-panel); }
.hp-panel-label { margin: 0 0 12px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--hp-muted); }
.hp-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.hp-chips li { padding: 5px 11px; border: 1px solid var(--hp-line); border-radius: 999px; background: var(--hp-bg-alt); font-size: 11.5px; color: var(--hp-muted); }
.hp-chips-dialect code { font-size: 11.5px; color: var(--hp-emerald-deep); }
.dark .hp-chips-dialect code { color: #7dd3fc; }

/* ------------------------------ tutorials ------------------------------ */
.hp-tutorial-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 40px; }
.hp-tutorial { position: relative; display: flex; flex-direction: column; padding: 24px 24px 22px; border: 1px solid var(--hp-line); border-radius: var(--hp-radius); background: var(--hp-panel); text-decoration: none; overflow: hidden; transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease; }
.hp-tutorial:hover { transform: translateY(-4px); border-color: rgba(16, 185, 129, 0.5); box-shadow: 0 24px 48px -32px rgba(16, 185, 129, 0.8); }
.hp-tutorial-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.hp-tag { padding: 4px 10px; border-radius: 999px; background: rgba(16, 185, 129, 0.14); color: var(--hp-emerald-deep); font-size: 11px; font-weight: 700; }
.dark .hp-tag { color: #6ee7b7; }
.hp-minutes { font-size: 11.5px; color: var(--hp-muted); }
.hp-tutorial-idx { position: absolute; top: 12px; right: 18px; font-size: 42px; font-weight: 800; line-height: 1; color: var(--hp-ink); opacity: 0.045; }
.hp-tutorial h3 { margin: 22px 0 0; font-size: 17px; font-weight: 720; color: var(--hp-ink); }
.hp-tutorial p { margin: 10px 0 0; flex: 1; font-size: 13.5px; line-height: 1.72; color: var(--hp-muted); }
.hp-tutorial-go { margin-top: 20px; font-size: 12.5px; font-weight: 650; color: var(--hp-emerald-deep); }
.dark .hp-tutorial-go { color: #6ee7b7; }
.hp-tutorial-go b { display: inline-block; transition: transform 0.2s ease; }
.hp-tutorial:hover .hp-tutorial-go b { transform: translateX(4px); }

/* -------------------------------- deploy -------------------------------- */
.hp-deploy-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-top: 40px; }
.hp-deploy { display: block; padding: 24px 22px; border: 1px solid var(--hp-line); border-radius: var(--hp-radius); background: var(--hp-panel); text-decoration: none; transition: transform 0.2s ease, border-color 0.2s ease; }
.hp-deploy:hover { transform: translateY(-4px); border-color: rgba(14, 165, 233, 0.5); }
.hp-deploy-idx { font-size: 12px; font-weight: 800; letter-spacing: 0.08em; color: var(--hp-sky); }
.hp-deploy-icon { display: grid; place-items: center; width: 36px; height: 36px; margin-top: 14px; border-radius: 10px; background: rgba(14, 165, 233, 0.12); color: #0284c7; }
.dark .hp-deploy-icon { color: #7dd3fc; }
.hp-deploy-icon :deep(svg) { width: 19px; height: 19px; }
.hp-deploy h3 { margin: 14px 0 0; font-size: 15.5px; font-weight: 700; color: var(--hp-ink); }
.hp-deploy p { margin: 9px 0 0; font-size: 13px; line-height: 1.7; color: var(--hp-muted); }

/* -------------------------------- compare ------------------------------- */
.hp-compare { margin-top: 40px; border: 1px solid var(--hp-line); border-radius: var(--hp-radius); background: var(--hp-panel); overflow: hidden; }
.hp-compare-head, .hp-compare-row { display: grid; grid-template-columns: 180px minmax(0, 1fr) minmax(0, 1.1fr); gap: 0; }
.hp-compare-head > span { padding: 16px 20px; font-size: 13px; font-weight: 750; border-bottom: 1px solid var(--hp-line); }
.hp-compare-head .hp-compare-manual { color: var(--hp-muted); }
.hp-compare-head .hp-compare-switch { display: flex; align-items: center; gap: 9px; background: rgba(16, 185, 129, 0.09); color: var(--hp-emerald-deep); }
.dark .hp-compare-head .hp-compare-switch { color: #6ee7b7; }
.hp-logo-mini { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, #34d399, #0ea5e9); color: #041710; font-size: 9px; font-weight: 850; letter-spacing: -0.04em; flex: none; }
.hp-compare-row > span { padding: 15px 20px; border-bottom: 1px solid var(--hp-line); font-size: 13.5px; line-height: 1.65; }
.hp-compare-row:last-child > span { border-bottom: 0; }
.hp-compare-label { font-weight: 650; color: var(--hp-ink); }
.hp-compare-manual { color: var(--hp-muted); }
.hp-compare-row .hp-compare-switch { display: flex; align-items: flex-start; gap: 9px; background: rgba(16, 185, 129, 0.055); color: var(--hp-ink); }
.hp-compare-row .hp-compare-switch b { color: var(--hp-emerald-deep); flex: none; }
.dark .hp-compare-row .hp-compare-switch b { color: #6ee7b7; }

/* ---------------------------------- faq --------------------------------- */
.hp-faq-wrap { max-width: 940px; }
.hp-faq { margin-top: 36px; border: 1px solid var(--hp-line); border-radius: var(--hp-radius); background: var(--hp-panel); overflow: hidden; }
.hp-faq-item { border-bottom: 1px solid var(--hp-line); }
.hp-faq-item:last-child { border-bottom: 0; }
.hp-faq-item summary { display: flex; align-items: center; gap: 18px; padding: 18px 22px; cursor: pointer; list-style: none; font-size: 14.5px; font-weight: 650; color: var(--hp-ink); }
.hp-faq-item summary::-webkit-details-marker { display: none; }
.hp-faq-item summary:hover { background: var(--hp-bg-alt); }
.hp-faq-q { flex: 1; }
.hp-faq-toggle { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 7px; border: 1px solid var(--hp-line); color: var(--hp-emerald-deep); font-size: 17px; font-weight: 500; flex: none; transition: transform 0.2s ease, background-color 0.2s ease; }
.dark .hp-faq-toggle { color: #6ee7b7; }
.hp-faq-item[open] .hp-faq-toggle { transform: rotate(45deg); background: rgba(16, 185, 129, 0.14); }
.hp-faq-a { padding: 0 22px 20px; }
.hp-faq-a p { margin: 0; font-size: 13.5px; line-height: 1.8; color: var(--hp-muted); }
.hp-faq-a a { display: inline-block; margin-top: 12px; font-size: 12.5px; font-weight: 650; color: var(--hp-emerald-deep); text-decoration: none; }
.dark .hp-faq-a a { color: #6ee7b7; }
.hp-faq-a a:hover { text-decoration: underline; }

/* ------------------------------ open source ----------------------------- */
.hp-opensource { padding: 76px 0; background: radial-gradient(700px 340px at 90% 0%, rgba(139, 92, 246, 0.16), transparent 65%), linear-gradient(140deg, #0d1c16, #091310 70%); color: #f2f8f5; }
.hp-opensource-inner { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 56px; align-items: center; }
.hp-opensource .hp-lead { color: #b0c5ba; }
.hp-opensource-points { display: grid; gap: 12px; }
.hp-os-point { display: grid; grid-template-columns: 34px minmax(0, 1fr); column-gap: 14px; padding: 16px 18px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; background: rgba(255, 255, 255, 0.04); }
.hp-os-icon { grid-row: span 2; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: rgba(52, 211, 153, 0.16); color: #6ee7b7; }
.hp-os-point h3 { margin: 0; font-size: 14.5px; font-weight: 700; }
.hp-os-point p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.65; color: #9db3a8; }

/* -------------------------------- download ------------------------------ */
.hp-download { position: relative; padding: 88px 0 92px; background: radial-gradient(760px 360px at 50% -20%, rgba(16, 185, 129, 0.24), transparent 66%), linear-gradient(160deg, #0a1712, #07110e 70%, #0a1419); color: #f2f8f5; isolation: isolate; }
.hp-download-glow { position: absolute; width: 520px; height: 260px; bottom: -120px; left: 50%; transform: translateX(-50%); background: rgba(14, 165, 233, 0.24); filter: blur(90px); z-index: -1; }
.hp-download .hp-h2 { color: #f6fbf8; margin-left: auto; margin-right: auto; }
.hp-download .hp-lead { color: #b0c5ba; }
.hp-os-list { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; margin: 36px 0 0; padding: 0; list-style: none; }
.hp-os-list li { display: flex; flex-direction: column; gap: 5px; min-width: 176px; padding: 14px 18px; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 12px; background: rgba(255, 255, 255, 0.045); }
.hp-os-list b { font-size: 14px; }
.hp-os-list span { font-size: 11.5px; color: #9db3a8; }
.hp-command { max-width: 860px; margin: 30px auto 0; padding: 18px 20px; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 14px; background: rgba(2, 8, 6, 0.5); text-align: left; }
.hp-command-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; font-size: 12.5px; font-weight: 650; color: #c7f5df; }
.hp-copy { appearance: none; border: 1px solid rgba(110, 231, 183, 0.35); border-radius: 7px; background: rgba(16, 185, 129, 0.14); color: #a7f3d0; font: inherit; font-size: 11.5px; padding: 5px 12px; cursor: pointer; }
.hp-copy:hover { background: rgba(16, 185, 129, 0.26); }
.hp-command code { display: block; font-size: 12.5px; line-height: 1.7; color: #e2f5ea; white-space: pre-wrap; overflow-wrap: anywhere; }
.hp-command p { margin: 12px 0 0; font-size: 12px; line-height: 1.65; color: #8fa89c; }
.hp-download-note { margin: 24px auto 0; max-width: 74ch; font-size: 12px; line-height: 1.7; color: #83a094; }

/* --------------------------------- footer ------------------------------- */
.hp-footer { padding: 62px 0 28px; background: #060d0a; color: #c9d9d0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.hp-footer-top { display: grid; grid-template-columns: minmax(0, 0.82fr) minmax(0, 2.4fr); gap: 48px; }
.hp-brand-logo { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: #f2f8f5; }
.hp-logo-lg { width: 34px; height: 34px; border-radius: 10px; font-size: 12px; }
.hp-brand-logo b { font-size: 18px; font-weight: 760; letter-spacing: -0.01em; }
.hp-brand > p { margin: 16px 0 0; max-width: 34ch; font-size: 12.5px; line-height: 1.75; color: #8ca99b; }
.hp-social { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.hp-social a { padding: 5px 11px; border: 1px solid rgba(255, 255, 255, 0.13); border-radius: 999px; font-size: 11.5px; color: #b6ccc0; text-decoration: none; }
.hp-social a:hover { border-color: #6ee7b7; color: #a7f3d0; }
.hp-footer-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 30px 22px; }
.hp-footer-col h3 { margin: 0 0 12px; font-size: 12px; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; color: #6ee7b7; }
.hp-footer-col ul { margin: 0; padding: 0; list-style: none; }
.hp-footer-col li { margin-bottom: 8px; }
.hp-footer-col a { font-size: 12.5px; color: #9cb3a7; text-decoration: none; }
.hp-footer-col a:hover { color: #a7f3d0; text-decoration: underline; }
.hp-footer-stack { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 42px; padding-top: 24px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.hp-stack-label { margin-right: 6px; font-size: 11.5px; font-weight: 700; color: #6ee7b7; }
.hp-stack-chip { padding: 4px 10px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 999px; font-size: 11px; color: #8ca99b; }
.hp-footer-bottom { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px 24px; margin-top: 24px; font-size: 11.5px; line-height: 1.6; color: #718b7e; }

/* -------------------------------- responsive ---------------------------- */
@media (max-width: 1100px) {
  .hp-hero-grid { grid-template-columns: minmax(0, 1fr); gap: 44px; }
  .hp-hero-visual { max-width: 720px; }
  .hp-platforms { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .hp-feature-grid, .hp-tutorial-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hp-flow { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .hp-step:nth-child(3)::after { display: none; }
  .hp-deploy-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hp-footer-top { grid-template-columns: minmax(0, 1fr); gap: 34px; }
  .hp-opensource-inner { grid-template-columns: minmax(0, 1fr); gap: 34px; }
}

@media (max-width: 860px) {
  .hp-section { padding: 64px 0; }
  .hp-pain-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .hp-pain-arrow { transform: rotate(90deg); }
  .hp-flow-panels { grid-template-columns: minmax(0, 1fr); }
  .hp-compare-head, .hp-compare-row { grid-template-columns: 130px minmax(0, 1fr) minmax(0, 1fr); }
  .hp-compare-head > span, .hp-compare-row > span { padding: 13px 14px; font-size: 12px; }
  .hp-float { display: none; }
}

@media (max-width: 640px) {
  .hp-wrap { width: min(100% - 32px, 1200px); }
  .hp-hero { padding: 22px 0 70px; }
  .hp-hero-grid { margin-top: 34px; }
  .hp-hero-title { font-size: 34px; }
  .hp-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 14px; }
  .hp-hero-visual :deep(.sw-window) { transform: none; }
  .hp-section { padding: 54px 0; }
  .hp-h2-lg { font-size: 26px; max-width: none; }
  .hp-lead { font-size: 14px; }
  .hp-platforms { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hp-feature-grid, .hp-tutorial-grid, .hp-deploy-grid, .hp-flow { grid-template-columns: minmax(0, 1fr); }
  .hp-step::after { display: none; }
  .hp-footer-links { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hp-btn { width: 100%; }
  .hp-cta-center .hp-btn { width: auto; }
  .hp-hero-link { padding-left: 0; }
  .hp-os-list li { min-width: 140px; flex: 1; }
  .hp-compare { border-radius: 12px; }
  .hp-compare-head { display: none; }
  .hp-compare-row { grid-template-columns: minmax(0, 1fr); }
  .hp-compare-row > span { border-bottom: 0; padding: 8px 16px; }
  .hp-compare-row { padding: 14px 0; border-bottom: 1px solid var(--hp-line); }
  .hp-compare-row:last-child { border-bottom: 0; }
  .hp-compare-label { font-size: 13px; font-weight: 750; }
  .hp-compare-row .hp-compare-manual { color: var(--hp-muted); }
  .hp-compare-row .hp-compare-switch { background: transparent; }
  .hp-showcase-frame { padding: 6px; border-radius: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .hp-reveal { opacity: 1; transform: none; transition: none; }
  .hp-hero-glow, .hp-float, .sw-pulse { animation: none !important; }
  .hp-btn:hover, .hp-feature:hover, .hp-tutorial:hover, .hp-deploy:hover, .hp-platform:hover { transform: none; }
}
</style>
