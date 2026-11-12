import type { ReactNode } from "react";

/**
 * Brand-coloured vector monograms for the third-party agents whose official
 * artwork is not shipped with the app.
 *
 * The seven first-party ecosystems (Codex / Claude / Gemini / Grok / OpenCode /
 * OpenClaw / Hermes) use their real inline SVG in `AgentIcon`. These smaller
 * tools do not publish a stable, redistributable SVG endpoint, and the app must
 * work fully offline, so instead of a generic outline icon each one gets
 * a deterministic mark built from its own brand colour and initials. They are
 * monograms, not reproductions of the official logos.
 */
export type AgentBrandKey =
  | "zcode"
  | "deepseek_harness"
  | "deepseek_harness_desktop"
  | "workbuddy"
  | "workbuddy_ai"
  | "codebuddy_cli"
  | "qoder_cli"
  | "qoder_cn_cli";

type BrandSpec = {
  color: string;
  label: string;
  /** Short text or a tiny path drawn inside the rounded square. */
  glyph: ReactNode;
};

function textGlyph(text: string, fontSize = 13) {
  return (
    <text
      fill="#ffffff"
      fontFamily="var(--font-sans)"
      fontSize={fontSize}
      fontWeight="700"
      textAnchor="middle"
      x="16"
      y="16.5"
      dominantBaseline="central"
    >
      {text}
    </text>
  );
}

const BRANDS: Record<AgentBrandKey, BrandSpec> = {
  zcode: { color: "#5B5BD6", label: "ZCode", glyph: textGlyph("Z") },
  deepseek_harness: {
    color: "#4D6BFE",
    label: "DeepSeek Harness",
    glyph: textGlyph("DS", 11),
  },
  deepseek_harness_desktop: {
    color: "#3C55D9",
    label: "DeepSeek Harness Desktop",
    glyph: textGlyph("DS", 11),
  },
  workbuddy: { color: "#F2662A", label: "WorkBuddy", glyph: textGlyph("W") },
  workbuddy_ai: { color: "#D9531E", label: "WorkBuddy AI", glyph: textGlyph("W") },
  codebuddy_cli: {
    color: "#0A6CFF",
    label: "CodeBuddy CLI",
    glyph: textGlyph("CB", 10),
  },
  qoder_cli: { color: "#7C4DFF", label: "Qoder CLI", glyph: textGlyph("Q") },
  qoder_cn_cli: { color: "#6A3FD6", label: "Qoder CN CLI", glyph: textGlyph("Q") },
};

export function isAgentBrandKey(value: string): value is AgentBrandKey {
  return Object.prototype.hasOwnProperty.call(BRANDS, value);
}

export function AgentBrandMark({
  clientKey,
  className = "h-8 w-8",
}: {
  clientKey: string;
  className?: string;
}) {
  const brand = isAgentBrandKey(clientKey) ? BRANDS[clientKey] : null;
  const spec: BrandSpec = brand ?? {
    color: "#57534E",
    label: clientKey,
    glyph: textGlyph("AI", 10),
  };
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 ${className}`} title={spec.label}>
      <svg height="100%" viewBox="0 0 32 32" width="100%" xmlns="http://www.w3.org/2000/svg">
        <rect fill={spec.color} height="32" rx="9" width="32" />
        {spec.glyph}
      </svg>
    </span>
  );
}
