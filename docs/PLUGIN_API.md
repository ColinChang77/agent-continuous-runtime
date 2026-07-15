# Plugin API

ACR V2 Phase 2 exposes a stable plugin contract through `@acr/adapter-sdk`.

## Public Package

- Package: `@acr/adapter-sdk`
- Stable exports:
  - `AgentPlugin`
  - `AgentAdapter`
  - `AgentCapabilities`
  - `AgentLaunchRequest`
  - `AgentResumeRequest`
  - `AgentHealth`
  - `RuntimeEvent`
  - `FailureClassification`
  - `AdapterConfigurationSchema`
  - `TransportMode`
  - `detectExecutableInstallation`
  - `allowEnv`
  - `safeArgs`

## Plugin Contract

Every plugin must export `agentPlugin` or `agentPlugins`.

Required manifest fields:

- `pluginId`
- `displayName`
- `version`
- `acrApiVersion`
- `agentId`
- `agentDisplayName`
- `declaredCapabilities`
- `supportedTransports`
- `executable`

Optional fields:

- `configurationSchema`
- `healthCheck`
- `source`

## Validation

The runtime rejects a plugin when:

- the manifest is incomplete;
- `acrApiVersion` does not match the runtime plugin API version;
- the adapter factory does not return the required adapter methods;
- `pluginId` conflicts with an already loaded plugin;
- `agentId` conflicts with an already registered agent.

Plugin failures are isolated. Rejected or failing plugins emit normalized plugin
events and do not crash runtime startup.

## Lifecycle

1. A plugin module is discovered from built-ins or `ACR_AGENT_PLUGINS`.
2. The launcher emits `PluginDiscovered`.
3. The registry validates the manifest and adapter factory.
4. On success, the plugin is registered and `PluginLoaded` is emitted.
5. On validation failure, `PluginRejected` is emitted.
6. On adapter construction or initialization failure, `PluginInitializationFailure` is emitted.

## Example

`packages/example-external-plugin` is a working external plugin package.

It is verified by automated CLI integration:

```bash
ACR_AGENT_PLUGINS=@acr/example-external-plugin npm test
```
