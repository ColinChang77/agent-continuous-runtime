import type {
  AgentPlugin,
  AgentRegistry,
  AgentScheduler,
  RuntimeEventPipeline,
  RuntimeLauncher
} from "@acr/core";

import { createAgentRegistry } from "./agent-registry.js";
import { createAgentHealthStore } from "./health-store.js";
import { createAgentScheduler } from "./scheduler.js";

export interface RuntimeLauncherOptions {
  plugins?: AgentPlugin[];
  projectRoot?: string;
  eventPipeline?: RuntimeEventPipeline;
}

export class DefaultRuntimeLauncher implements RuntimeLauncher {
  private readonly agentRegistry: AgentRegistry;
  private readonly agentScheduler: AgentScheduler;

  private constructor(
    agentRegistry: AgentRegistry,
    agentScheduler: AgentScheduler
  ) {
    this.agentRegistry = agentRegistry;
    this.agentScheduler = agentScheduler;
  }

  static async create(options: RuntimeLauncherOptions = {}) {
    const registry = createAgentRegistry();
    const scheduler = createAgentScheduler();
    const healthStore = createAgentHealthStore();

    for (const plugin of options.plugins ?? []) {
      options.eventPipeline?.emit({
        type: "PluginDiscovered",
        agentId: null,
        pluginId: plugin.manifest.pluginId,
        pluginSource: plugin.source ?? "builtin",
        message: `Discovered plugin ${plugin.manifest.pluginId}.`
      });

      try {
        const registered = await registry.register(plugin);
        if (!registered) {
          options.eventPipeline?.emit({
            type: "PluginRejected",
            agentId: null,
            pluginId: plugin.manifest.pluginId,
            pluginSource: plugin.source ?? "builtin",
            message: `Rejected plugin ${plugin.manifest.pluginId} due to validation failure or identifier conflict.`
          });
          continue;
        }

        if (options.projectRoot) {
          registered.health = await healthStore.read(
            options.projectRoot,
            registered.id
          );
        }

        options.eventPipeline?.emit({
          type: "PluginLoaded",
          agentId: registered.id,
          pluginId: plugin.manifest.pluginId,
          pluginSource: plugin.source ?? "builtin",
          message: `Loaded plugin ${plugin.manifest.pluginId}.`
        });
      } catch (error) {
        options.eventPipeline?.emit({
          type: "PluginInitializationFailure",
          agentId: null,
          pluginId: plugin.manifest.pluginId,
          pluginSource: plugin.source ?? "builtin",
          message:
            error instanceof Error
              ? error.message
              : "Unknown plugin initialization failure."
        });
      }
    }

    return new DefaultRuntimeLauncher(registry, scheduler);
  }

  registry(): AgentRegistry {
    return this.agentRegistry;
  }

  scheduler(): AgentScheduler {
    return this.agentScheduler;
  }
}

export async function createRuntimeLauncher(options?: RuntimeLauncherOptions) {
  return DefaultRuntimeLauncher.create(options);
}
