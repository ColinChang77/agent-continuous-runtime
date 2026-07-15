import { createNamedFakeAgentAdapter } from "@acr/adapter-fake";
import type { AgentPlugin } from "@acr/adapter-sdk";
import { pluginApiVersion } from "@acr/core";

export const agentPlugin: AgentPlugin = {
  manifest: {
    pluginId: "example-external-plugin",
    displayName: "Example External Plugin",
    version: "2.0.0",
    acrApiVersion: pluginApiVersion,
    agentId: "external-fake-agent",
    agentDisplayName: "External Fake Agent",
    declaredCapabilities: ["testing", "external-plugin"],
    supportedTransports: ["pty", "stdio", "spawn"],
    executable: {
      command: process.execPath,
      args: ["--version"]
    },
    configurationSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  source: "@acr/example-external-plugin",
  createAdapter() {
    return createNamedFakeAgentAdapter({
      id: "external-fake-agent",
      displayName: "External Fake Agent"
    });
  }
};
