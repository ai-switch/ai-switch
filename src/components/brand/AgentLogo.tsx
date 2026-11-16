import { AgentBrandMark } from "./AgentBrandMark";
import { AgentIcon } from "./AgentIcon";
import { agentClientInfo } from "../../lib/agentClients";

export function AgentLogo({ clientKey, className = "h-8 w-8" }: {
  clientKey: string;
  className?: string;
}) {
  const info = agentClientInfo(clientKey);
  const localAsset: Record<string, string> = {
    deepseek_harness: "deepseek-harness.svg",
    deepseek_harness_desktop: "deepseek-harness-desktop.svg",
    hermes: "hermes-agent.png",
    workbuddy: "workbuddy.svg",
    workbuddy_ai: "workbuddy.svg",
    codebuddy_cli: "codebuddy.svg",
    zcode: "zcode.png",
    qoder_cli: "qoder.svg",
    qoder_cn_cli: "qoder.svg",
  };
  const asset = Object.prototype.hasOwnProperty.call(localAsset, clientKey) ? localAsset[clientKey] : undefined;
  return (
    <span role="img" aria-label={info.label} title={info.label} className={`inline-flex shrink-0 ${className}`}>
      {asset ? <img alt="" src={`${import.meta.env.BASE_URL}brand/${asset}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        : info.platform
          ? <AgentIcon platform={info.platform} className="h-full w-full" />
          : <AgentBrandMark clientKey={clientKey} className="h-full w-full" />}
    </span>
  );
}
