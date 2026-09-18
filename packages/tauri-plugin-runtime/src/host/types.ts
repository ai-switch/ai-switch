import type { HostTransport } from "../protocol/wire.js";

export interface PluginView {
  readonly pluginId: string;
  readonly element: HTMLIFrameElement;
  dispose(): Promise<void>;
}
export interface PluginHost {
  mount(options: { pluginId: string; container: HTMLElement }): Promise<PluginView>;
  dispose(): Promise<void>;
}
export interface PluginHostOptions {
  transport: HostTransport;
  allowedAssetOrigins?: string[];
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
}
