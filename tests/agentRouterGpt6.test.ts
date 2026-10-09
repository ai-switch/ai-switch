import { describe, expect, it } from "vitest";
import {
  agentRouterGpt6NeedsResponses,
  agentRouterGpt6ResponsesMessage,
} from "../src/lib/agentRouterGpt6";
import type { ModelMapping } from "../src/lib/api/types";

const GPT6: ModelMapping = { from: "gpt-6-astra", to: "gpt-6-astra" };
const GLM: ModelMapping = { from: "glm-5.3", to: "glm-5.3" };

describe("agentRouterGpt6NeedsResponses", () => {
  it("flags the primary line when gpt-6 is mapped onto Chat Completions", () => {
    const warning = agentRouterGpt6NeedsResponses({
      baseUrl: "https://agentrouter.org/v1",
      interfaceFormat: "openai",
      modelMappings: [GLM, GPT6],
    });

    expect(warning).toEqual({ models: ["gpt-6-astra"] });
  });

  it("flags the ps.air-outer.com backup line too", () => {
    const warning = agentRouterGpt6NeedsResponses({
      baseUrl: "https://ps.air-outer.com/v1",
      interfaceFormat: "openai",
      modelMappings: [GPT6],
    });

    expect(warning?.models).toEqual(["gpt-6-astra"]);
  });

  it("silences itself for every other interface format", () => {
    for (const interfaceFormat of ["openai-responses", "anthropic", "gemini", "", null, undefined]) {
      expect(
        agentRouterGpt6NeedsResponses({
          baseUrl: "https://agentrouter.org/v1",
          interfaceFormat,
          modelMappings: [GPT6],
        }),
      ).toBeNull();
    }
  });

  it("ignores hosts that are not AgentRouter", () => {
    for (const baseUrl of [
      "https://api.example.com/v1",
      "https://kktoken.cc/v1",
      "https://notagentrouter.org/v1",
      "https://agentrouter.org.evil.test/v1",
    ]) {
      expect(
        agentRouterGpt6NeedsResponses({ baseUrl, interfaceFormat: "openai", modelMappings: [GPT6] }),
      ).toBeNull();
    }
  });

  it("ignores AgentRouter accounts that never mention gpt-6", () => {
    expect(
      agentRouterGpt6NeedsResponses({
        baseUrl: "https://agentrouter.org/v1",
        interfaceFormat: "openai",
        modelMappings: [GLM, { from: "gpt-5.6-sol", to: "gpt-5.6-sol" }],
      }),
    ).toBeNull();
    expect(
      agentRouterGpt6NeedsResponses({
        baseUrl: "https://agentrouter.org/v1",
        interfaceFormat: "openai",
        modelMappings: [],
      }),
    ).toBeNull();
  });

  it("reads the upstream side of a mapping as well as the requested side", () => {
    const warning = agentRouterGpt6NeedsResponses({
      baseUrl: "https://agentrouter.org/v1",
      interfaceFormat: "openai",
      modelMappings: [{ from: "my-own-alias", to: "gpt-6-astra" }],
    });

    expect(warning).toEqual({ models: ["gpt-6-astra"] });
  });

  it("reports each gpt-6 id once, trimmed", () => {
    const warning = agentRouterGpt6NeedsResponses({
      baseUrl: "https://agentrouter.org/v1",
      interfaceFormat: "openai",
      modelMappings: [
        { from: " gpt-6-astra ", to: "GPT-6-astra" },
        { from: "gpt-6-astra", to: "gpt-6-terra" },
      ],
    });

    expect(warning).toEqual({ models: ["gpt-6-astra", "gpt-6-terra"] });
  });

  it("matches the host no matter the case, port, path or trailing space", () => {
    for (const baseUrl of [
      "https://AgentRouter.org/v1",
      "https://agentrouter.org:443/v1/",
      "  https://agentrouter.org  ",
      "https://agentrouter.org/openai/v1",
    ]) {
      expect(
        agentRouterGpt6NeedsResponses({ baseUrl, interfaceFormat: "openai", modelMappings: [GPT6] }),
      ).not.toBeNull();
    }
  });

  it("ignores base urls it cannot read a host out of", () => {
    for (const baseUrl of ["", "   ", "agentrouter.org/v1", "not a url"]) {
      expect(
        agentRouterGpt6NeedsResponses({ baseUrl, interfaceFormat: "openai", modelMappings: [GPT6] }),
      ).toBeNull();
    }
  });
});

describe("agentRouterGpt6ResponsesMessage", () => {
  it("names the models and both outcomes", () => {
    const message = agentRouterGpt6ResponsesMessage({ models: ["gpt-6-astra"] });

    expect(message).toContain("gpt-6-astra");
    expect(message).toContain("OpenAI Responses");
    expect(message).toContain("Chat Completions");
    expect(message).toContain("确定");
    expect(message).toContain("取消");
  });
});
