import { plaintextReasoningMatchedHost, type ResponsesPlaintextReasoningMode } from "../../lib/responsesPlaintextReasoning";

type Props = {
  mode: ResponsesPlaintextReasoningMode;
  baseUrl: string;
  onChange: (value: ResponsesPlaintextReasoningMode) => void;
};

export function ResponsesPlaintextReasoningOption({ mode, baseUrl, onChange }: Props) {
  const matched = plaintextReasoningMatchedHost(baseUrl);
  const effective = mode === "auto"
    ? matched ? `自动：已开启，命中 ${matched}` : "自动：未开启，网站未在兼容名单中"
    : mode === "on" ? "已手动开启" : "已手动关闭（优先于自动名单）";
  return (
    <div className="grid gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12px] text-stone-700">
      <label className="flex items-center justify-between gap-3 font-medium">
        <span>Responses 明文推理兼容</span>
        <select aria-label="Responses 明文推理兼容" value={mode}
          className="rounded-md border border-stone-200 bg-white px-2 py-1"
          onChange={(event) => onChange(event.target.value as ResponsesPlaintextReasoningMode)}>
          <option value="auto">自动（默认）</option>
          <option value="on">开启</option>
          <option value="off">关闭</option>
        </select>
      </label>
      <p className="text-[11px] font-medium text-stone-600" aria-live="polite">{effective}</p>
      <p className="text-[11px] leading-5 text-stone-500">
        仅在发往此账号的 Responses 请求中，将可识别的 reasoning.content 明文转为 summary_text，保留已有摘要；不改原始会话历史、普通消息或工具结果。自动模式精确匹配已验证网站，不包含子域名。密文清理仍由下面的独立设置控制，未知内容不会强制转换。直连模式不经过代理，此设置不生效。
      </p>
    </div>
  );
}
