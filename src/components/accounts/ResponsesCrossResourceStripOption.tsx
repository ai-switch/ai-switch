import {
  crossResourceStripMatchedHost,
  type ResponsesCrossResourceStripMode,
} from "../../lib/responsesCrossResourceStrip";

type Props = {
  mode: ResponsesCrossResourceStripMode;
  baseUrl: string;
  onChange: (value: ResponsesCrossResourceStripMode) => void;
};

export function ResponsesCrossResourceStripOption({ mode, baseUrl, onChange }: Props) {
  const matched = crossResourceStripMatchedHost(baseUrl);
  const effective = mode === "auto"
    ? matched ? `自动：已开启，命中 ${matched}（跨资源剥离）` : "自动：未开启，网站不在跨资源剥离名单中"
    : mode === "on" ? "已手动开启" : "已手动关闭（优先于自动名单）";
  return (
    <div className="grid gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12px] text-stone-700">
      <label className="flex items-center justify-between gap-3 font-medium">
        <span>跨资源状态剥离（Azure 多资源中转）</span>
        <select aria-label="跨资源状态剥离" value={mode}
          className="rounded-md border border-stone-200 bg-white px-2 py-1"
          onChange={(event) => onChange(event.target.value as ResponsesCrossResourceStripMode)}>
          <option value="auto">自动（默认）</option>
          <option value="on">开启</option>
          <option value="off">关闭</option>
        </select>
      </label>
      <p className="text-[11px] font-medium text-stone-600" aria-live="polite">{effective}</p>
      <p className="text-[11px] leading-5 text-stone-500">
        每次发送前删除 input 各项的服务端 id、所有 encrypted* 字段和 previous_response_id，让中转池里任何 Azure 资源都能接住这段历史，
        用于修复「The requested item was created under a different Azure OpenAI resource」。
        消息正文、工具 call_id 与参数、摘要和响应流原样保留；代价是模型每轮重新推理，不再跨轮接续隐藏思维链。自动模式精确匹配已验证网站，不包含子域名。直连模式不经过代理，此设置不生效。
      </p>
    </div>
  );
}
