import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function getFirstText(result) {
  return result.content?.[0]?.text ?? "";
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
      })
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function main() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "acr-mcp-stdio-"));
  const client = new Client(
    {
      name: "acr-stdio-smoke",
      version: "1.0.0"
    },
    {
      capabilities: {}
    }
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve("dist/acr.js"),
      "mcp",
      "serve",
      "--project",
      projectRoot
    ],
    cwd: process.cwd(),
    stderr: "pipe"
  });

  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  try {
    await withTimeout(client.connect(transport), 5_000, "MCP stdio connect");

    const [resources, tools, prompts] = await withTimeout(
      Promise.all([
        client.listResources(),
        client.listTools(),
        client.listPrompts()
      ]),
      5_000,
      "MCP capability listing"
    );

    if (
      !resources.resources.some(
        (resource) => resource.uri === "acr://project/current-state"
      )
    ) {
      throw new Error("current-state resource was not listed over stdio");
    }

    if (!tools.tools.some((tool) => tool.name === "initialize_project")) {
      throw new Error("initialize_project tool was not listed over stdio");
    }

    if (!prompts.prompts.some((prompt) => prompt.name === "resume-project")) {
      throw new Error("resume-project prompt was not listed over stdio");
    }

    const initResult = await withTimeout(
      client.callTool({
        name: "initialize_project",
        arguments: { projectRoot, force: false }
      }),
      5_000,
      "initialize_project"
    );
    const initPayload = JSON.parse(getFirstText(initResult));

    if (
      initPayload.ok !== true ||
      typeof initPayload.stateRevision !== "number"
    ) {
      throw new Error("initialize_project did not return a successful payload");
    }

    const stateResource = await withTimeout(
      client.readResource({
        uri: "acr://project/current-state"
      }),
      5_000,
      "read current-state resource"
    );
    const stateText = stateResource.contents?.[0]?.text ?? "";
    const state = JSON.parse(stateText);

    if (state.revision !== initPayload.stateRevision) {
      throw new Error(
        "current-state resource did not reflect the initialized revision"
      );
    }

    process.stdout.write("MCP stdio smoke test passed.\n");
  } catch (error) {
    const stderrOutput = stderrChunks.join("").trim();
    if (stderrOutput.length > 0) {
      process.stderr.write(`${stderrOutput}\n`);
    }
    throw error;
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

await main();
