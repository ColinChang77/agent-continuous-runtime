import type {
  AgentPlugin,
  AgentPluginManifest,
  AgentRegistry,
  RegisteredAgent
} from "@acr/core";
import { pluginApiVersion } from "@acr/core";

const defaultMetadata = {
  priority: 100,
  health: "healthy",
  costTier: "medium",
  vendor: "unknown",
  capabilities: [] as string[],
  transportPreferences: ["pty", "stdio", "spawn"] as const
} satisfies RegisteredAgent["metadata"];

function validateManifest(manifest: AgentPluginManifest): string[] {
  const errors: string[] = [];
  if (!manifest.pluginId) errors.push("pluginId is required");
  if (!manifest.agentId) errors.push("agentId is required");
  if (!manifest.displayName) errors.push("displayName is required");
  if (!manifest.agentDisplayName) errors.push("agentDisplayName is required");
  if (!manifest.version) errors.push("version is required");
  if (manifest.acrApiVersion !== pluginApiVersion) {
    errors.push(
      `acrApiVersion ${manifest.acrApiVersion} is incompatible with runtime plugin API ${pluginApiVersion}`
    );
  }
  if (!manifest.executable?.command) {
    errors.push("executable.command is required");
  }
  if (manifest.supportedTransports.length === 0) {
    errors.push("supportedTransports must contain at least one transport");
  }
  return errors;
}

export class DefaultAgentRegistry implements AgentRegistry {
  private readonly agents = new Map<string, RegisteredAgent>();
  private readonly pluginIds = new Set<string>();

  async register(plugin: AgentPlugin): Promise<RegisteredAgent | null> {
    const manifest = plugin.manifest;
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      return null;
    }
    if (this.pluginIds.has(manifest.pluginId)) {
      return null;
    }
    if (this.agents.has(manifest.agentId)) {
      return null;
    }
    if (typeof plugin.createAdapter !== "function") {
      return null;
    }

    const adapter = plugin.createAdapter();
    if (
      !adapter ||
      typeof adapter.detectInstallation !== "function" ||
      typeof adapter.buildLaunchSpec !== "function" ||
      typeof adapter.buildResumeInstruction !== "function" ||
      typeof adapter.classifyTermination !== "function"
    ) {
      return null;
    }

    const installation = await adapter.detectInstallation();
    const agent: RegisteredAgent = {
      id: manifest.agentId,
      displayName: manifest.agentDisplayName,
      adapter,
      plugin,
      installation,
      metadata: {
        ...defaultMetadata,
        vendor: manifest.pluginId,
        capabilities: [...manifest.declaredCapabilities],
        transportPreferences: [...manifest.supportedTransports]
      },
      health: null
    };
    this.pluginIds.add(manifest.pluginId);
    this.agents.set(agent.id, agent);
    return agent;
  }

  get(id: string): RegisteredAgent | undefined {
    return this.agents.get(id);
  }

  list(): RegisteredAgent[] {
    return [...this.agents.values()];
  }
}

export function createAgentRegistry() {
  return new DefaultAgentRegistry();
}
