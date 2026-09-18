import { connectPlugin, getPluginClient, onConnectionChange, supportsCapability } from "./connection.js";
import type { PluginApi } from "./types.js";

export { connectPlugin };
export type { CallOptions, ConnectionState, DirectorySelection, PluginApi } from "./types.js";

/** Importing the public entry never connects or touches browser globals. */
export const aplg: PluginApi = {
  ready: connectPlugin,
  capabilities: { supports: supportsCapability },
  async call(capability, method, params, options) { return (await getPluginClient()).call(capability, method, params, options); },
  async subscribe(capability, topic, callback) { return (await getPluginClient()).subscribe(capability, topic, callback); },
  onConnectionChange,
  storage: {
    async get(key) { return (await getPluginClient()).storage.get(key); },
    async set(key, value) { return (await getPluginClient()).storage.set(key, value); },
    async remove(key) { return (await getPluginClient()).storage.remove(key); },
  },
  dialog: { async pickDirectory(options) { return (await getPluginClient()).dialog.pickDirectory(options); } },
};
