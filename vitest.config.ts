import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@acr/core": path.resolve("./packages/core/src/index.ts"),
      "@acr/adapter-sdk": path.resolve("./packages/adapter-sdk/src/index.ts"),
      "@acr/storage-local": path.resolve(
        "./packages/storage-local/src/index.ts"
      ),
      "@acr/mcp-server": path.resolve("./packages/mcp-server/src/index.ts"),
      "@acr/runtime": path.resolve("./packages/runtime/src/index.ts"),
      "@acr/adapter-fake": path.resolve("./packages/adapter-fake/src/index.ts"),
      "@acr/adapter-claude-code": path.resolve(
        "./packages/adapter-claude-code/src/index.ts"
      ),
      "@acr/adapter-codex": path.resolve(
        "./packages/adapter-codex/src/index.ts"
      ),
      "@acr/adapter-gemini": path.resolve(
        "./packages/adapter-gemini/src/index.ts"
      ),
      "@acr/example-external-plugin": path.resolve(
        "./packages/example-external-plugin/src/index.ts"
      )
    }
  },
  test: {
    environment: "node",
    coverage: {
      enabled: false
    }
  }
});
