import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createAcrMcpServer } from "../src/index.js";

async function createTempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "acr-mcp-test-"));
}

function getFirstText(result: unknown): string {
  const content = (result as { content: Array<{ text: string }> }).content;
  return content[0]?.text ?? "";
}

async function createConnectedClient(projectRoot: string) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const { server } = createAcrMcpServer({
    projectRoot,
    allowedRoots: [projectRoot]
  });

  const client = new Client(
    {
      name: "acr-test-client",
      version: "1.0.0"
    },
    {
      capabilities: {}
    }
  );

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);
  return { client, server };
}

describe("ACR MCP server", () => {
  it("lists resources, tools, and prompts", async () => {
    const projectRoot = await createTempProject();
    const { client, server } = await createConnectedClient(projectRoot);

    const [resources, tools, prompts, prompt] = await Promise.all([
      client.listResources(),
      client.listTools(),
      client.listPrompts(),
      client.getPrompt({ name: "resume-project" })
    ]);

    expect(
      resources.resources.some(
        (resource) => resource.uri === "acr://project/current-state"
      )
    ).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "initialize_project")).toBe(
      true
    );
    expect(
      prompts.prompts.some((prompt) => prompt.name === "resume-project")
    ).toBe(true);
    expect(prompt.messages.length).toBeGreaterThan(0);

    await Promise.all([client.close(), server.close()]);
  });

  it("initializes and inspects a project through tools", async () => {
    const projectRoot = await createTempProject();
    const { client, server } = await createConnectedClient(projectRoot);

    const initResult = await client.callTool({
      name: "initialize_project",
      arguments: { projectRoot, force: false }
    });
    const inspectResult = await client.callTool({
      name: "inspect_project",
      arguments: { projectRoot }
    });

    const initPayload = JSON.parse(getFirstText(initResult)) as {
      ok: boolean;
    };
    const inspectPayload = JSON.parse(getFirstText(inspectResult)) as {
      ok: boolean;
      data: { stateRevision: number };
    };

    expect(initPayload.ok).toBe(true);
    expect(inspectPayload.ok).toBe(true);
    expect(inspectPayload.data.stateRevision).toBeGreaterThan(0);

    await Promise.all([client.close(), server.close()]);
  });

  it("rejects paths outside the allowed root", async () => {
    const projectRoot = await createTempProject();
    const outsideRoot = await createTempProject();
    const { client, server } = await createConnectedClient(projectRoot);

    const result = await client.callTool({
      name: "initialize_project",
      arguments: { projectRoot: outsideRoot, force: false }
    });
    const payload = JSON.parse(getFirstText(result)) as {
      ok: boolean;
      error: { code: string };
    };

    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("ACR_PATH_OUTSIDE_ROOT");

    await Promise.all([client.close(), server.close()]);
  });

  it("surfaces revision conflicts through update_state", async () => {
    const projectRoot = await createTempProject();
    const { client, server } = await createConnectedClient(projectRoot);

    const initResult = await client.callTool({
      name: "initialize_project",
      arguments: { projectRoot, force: false }
    });
    const initPayload = JSON.parse(getFirstText(initResult)) as {
      stateRevision: number;
    };

    await client.callTool({
      name: "update_state",
      arguments: {
        projectRoot,
        expectedRevision: initPayload.stateRevision,
        reason: "first update",
        updatedBy: {
          agent: "test",
          adapterVersion: "1.0.0",
          sessionId: "session-1"
        },
        patch: {
          nextSteps: ["Do the first thing"]
        }
      }
    });

    const conflict = await client.callTool({
      name: "update_state",
      arguments: {
        projectRoot,
        expectedRevision: initPayload.stateRevision,
        reason: "stale update",
        updatedBy: {
          agent: "test",
          adapterVersion: "1.0.0",
          sessionId: "session-2"
        },
        patch: {
          nextSteps: ["Do the stale thing"]
        }
      }
    });
    const payload = JSON.parse(getFirstText(conflict)) as {
      ok: boolean;
      error: { code: string };
    };

    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("ACR_REVISION_CONFLICT");

    await Promise.all([client.close(), server.close()]);
  });

  it("completes the active task and emits a checkpoint", async () => {
    const projectRoot = await createTempProject();
    const { client, server } = await createConnectedClient(projectRoot);

    const initResult = await client.callTool({
      name: "initialize_project",
      arguments: { projectRoot, force: false }
    });
    const initPayload = JSON.parse(getFirstText(initResult)) as {
      stateRevision: number;
    };

    const completion = await client.callTool({
      name: "complete_task",
      arguments: {
        projectRoot,
        expectedRevision: initPayload.stateRevision,
        completedWork: ["Implemented the active task."],
        verificationPassed: ["npm test"],
        verificationFailed: [],
        verificationNotRunReason: null,
        nextAction: "Start the next queued task."
      }
    });
    const completionPayload = JSON.parse(getFirstText(completion)) as {
      ok: boolean;
      data: {
        state: { activeTask: { status: string } };
        checkpoint: { checkpointId: string };
      };
    };

    expect(completionPayload.ok).toBe(true);
    expect(completionPayload.data.state.activeTask.status).toBe("completed");
    expect(completionPayload.data.checkpoint.checkpointId).toContain(
      "complete-task"
    );

    await Promise.all([client.close(), server.close()]);
  });

  it("executes the remaining handoff and maintenance tools successfully", async () => {
    const projectRoot = await createTempProject();
    const { client, server } = await createConnectedClient(projectRoot);

    const initResult = await client.callTool({
      name: "initialize_project",
      arguments: { projectRoot, force: false }
    });
    const initPayload = JSON.parse(getFirstText(initResult)) as {
      stateRevision: number;
    };

    const progressResult = await client.callTool({
      name: "record_progress",
      arguments: {
        projectRoot,
        agent: "test-agent",
        task: "Audit runtime state",
        changes: "Added lifecycle coverage",
        verification: "vitest",
        remainingWork: "Review output"
      }
    });
    const progressPayload = JSON.parse(getFirstText(progressResult)) as {
      ok: boolean;
    };
    expect(progressPayload.ok).toBe(true);

    const decisionResult = await client.callTool({
      name: "record_decision",
      arguments: {
        projectRoot,
        expectedRevision: initPayload.stateRevision,
        id: "DEC-001",
        title: "Use runtime checkpoints",
        agent: "test-agent",
        status: "accepted",
        context: "Need durable handoff state",
        decision: "Persist checkpoints in .agent/checkpoints",
        alternatives: "Store only JSON state",
        consequences: "Checkpoint directories accumulate over time",
        relatedFiles: ["packages/runtime/src/supervisor.ts"]
      }
    });
    const decisionPayload = JSON.parse(getFirstText(decisionResult)) as {
      ok: boolean;
      stateRevision: number;
    };
    expect(decisionPayload.ok).toBe(true);

    const checkpointResult = await client.callTool({
      name: "checkpoint",
      arguments: {
        projectRoot,
        reason: "manual",
        summary: "Captured intermediate state",
        nextAction: "Continue the audit",
        safeToResume: true
      }
    });
    const checkpointPayload = JSON.parse(getFirstText(checkpointResult)) as {
      ok: boolean;
      data: { checkpoint: { checkpointId: string } };
    };
    expect(checkpointPayload.ok).toBe(true);
    expect(checkpointPayload.data.checkpoint.checkpointId).toContain("manual");

    const resumeResult = await client.callTool({
      name: "resume_project",
      arguments: { projectRoot, repairSafeDrift: true }
    });
    const resumePayload = JSON.parse(getFirstText(resumeResult)) as {
      ok: boolean;
      data: { brief: { nextAction: string } };
    };
    expect(resumePayload.ok).toBe(true);
    expect(resumePayload.data.brief.nextAction.length).toBeGreaterThan(0);

    const validateResult = await client.callTool({
      name: "validate_state",
      arguments: { projectRoot }
    });
    const validatePayload = JSON.parse(getFirstText(validateResult)) as {
      ok: boolean;
      data: { issues: unknown[] };
    };
    expect(validatePayload.ok).toBe(true);
    expect(Array.isArray(validatePayload.data.issues)).toBe(true);

    const repairResult = await client.callTool({
      name: "repair_state",
      arguments: { projectRoot, safe: true }
    });
    const repairPayload = JSON.parse(getFirstText(repairResult)) as {
      ok: boolean;
      data: { repaired: string[] };
    };
    expect(repairPayload.ok).toBe(true);
    expect(repairPayload.data.repaired).toContain(".agent/CURRENT_STATE.json");

    const handoffResult = await client.callTool({
      name: "prepare_handoff",
      arguments: {
        projectRoot,
        summary: "Ready to hand off",
        nextAction: "Resume from the prepared checkpoint"
      }
    });
    const handoffPayload = JSON.parse(getFirstText(handoffResult)) as {
      ok: boolean;
      data: {
        checkpoint: { checkpointId: string };
        resumeBrief: { summary: string };
      };
    };
    expect(handoffPayload.ok).toBe(true);
    expect(handoffPayload.data.checkpoint.checkpointId).toContain("handoff");
    expect(handoffPayload.data.resumeBrief.summary.length).toBeGreaterThan(0);

    await Promise.all([client.close(), server.close()]);
  });
});
