import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { schemaVersion } from "@acr/core";

import { AcrToolError } from "./errors.js";
import { ProjectService } from "./project-service.js";
import { toolFailure, toolSuccess } from "./results.js";
import { ensureAllowedRoot } from "./roots.js";

export interface AcrMcpServerOptions {
  projectRoot: string;
  allowedRoots?: string[];
}

const resourceUris = {
  summary: "acr://project/summary",
  context: "acr://project/context",
  currentState: "acr://project/current-state",
  tasks: "acr://project/tasks",
  decisions: "acr://project/decisions",
  recentContext: "acr://project/recent-context",
  progress: "acr://project/progress",
  repositoryStatus: "acr://project/repository-status",
  resumeBrief: "acr://project/resume-brief",
  checkpoints: "acr://project/checkpoints"
} as const;

export function createAcrMcpServer(options: AcrMcpServerOptions) {
  const projectService = new ProjectService();
  const allowedRoots = options.allowedRoots ?? [options.projectRoot];
  const server = new McpServer({
    name: "acr-continuity",
    version: schemaVersion
  });

  async function resolveProjectRoot(
    inputProjectRoot?: string
  ): Promise<string> {
    return ensureAllowedRoot(
      inputProjectRoot ?? options.projectRoot,
      allowedRoots
    );
  }

  async function withTool<T>(
    operation: string,
    projectRoot: string | undefined,
    handler: (resolvedRoot: string) => Promise<{
      stateRevision: number | null;
      data: T;
      warnings?: string[];
    }>
  ) {
    try {
      const resolvedRoot = await resolveProjectRoot(projectRoot);
      const result = await handler(resolvedRoot);
      return toolSuccess(
        operation,
        resolvedRoot,
        result.stateRevision,
        result.data,
        result.warnings ?? []
      );
    } catch (error) {
      return toolFailure(operation, projectRoot ?? options.projectRoot, error);
    }
  }

  server.registerResource(
    "project-summary",
    resourceUris.summary,
    {
      title: "Project Summary",
      description: "Compact project continuity summary",
      mimeType: "text/plain"
    },
    async () => {
      const resolvedRoot = await resolveProjectRoot();
      const brief = await projectService.resumeProject(resolvedRoot);
      return {
        contents: [{ uri: resourceUris.summary, text: brief.brief.summary }]
      };
    }
  );

  server.registerResource(
    "project-context",
    resourceUris.context,
    {
      title: "Project Context",
      description: "Durable project context document",
      mimeType: "text/markdown"
    },
    async () => {
      const resolvedRoot = await resolveProjectRoot();
      return {
        contents: [
          {
            uri: resourceUris.context,
            text: await projectService.readResource(
              resolvedRoot,
              "PROJECT_CONTEXT.md"
            )
          }
        ]
      };
    }
  );

  server.registerResource(
    "project-current-state",
    resourceUris.currentState,
    {
      title: "Current State",
      description: "Canonical continuity state",
      mimeType: "application/json"
    },
    async () => {
      const resolvedRoot = await resolveProjectRoot();
      const state = await projectService.store.readCurrentState(resolvedRoot);
      return {
        contents: [
          {
            uri: resourceUris.currentState,
            mimeType: "application/json",
            text: JSON.stringify(state, null, 2)
          }
        ]
      };
    }
  );

  for (const [name, uri, docName, mimeType] of [
    ["project-tasks", resourceUris.tasks, "TASKS.md", "text/markdown"],
    [
      "project-decisions",
      resourceUris.decisions,
      "DECISIONS.md",
      "text/markdown"
    ],
    [
      "project-recent-context",
      resourceUris.recentContext,
      "RECENT_CONTEXT.md",
      "text/markdown"
    ],
    ["project-progress", resourceUris.progress, "PROGRESS.md", "text/markdown"]
  ] as const) {
    server.registerResource(
      name,
      uri,
      { title: name, description: docName, mimeType },
      async () => {
        const resolvedRoot = await resolveProjectRoot();
        return {
          contents: [
            {
              uri,
              mimeType,
              text: await projectService.readResource(resolvedRoot, docName)
            }
          ]
        };
      }
    );
  }

  server.registerResource(
    "project-repository-status",
    resourceUris.repositoryStatus,
    {
      title: "Repository Status",
      description: "Fresh repository inspection snapshot",
      mimeType: "application/json"
    },
    async () => {
      const resolvedRoot = await resolveProjectRoot();
      const snapshot = await projectService.inspector.inspect(resolvedRoot);
      return {
        contents: [
          {
            uri: resourceUris.repositoryStatus,
            mimeType: "application/json",
            text: JSON.stringify(snapshot, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "project-resume-brief",
    resourceUris.resumeBrief,
    {
      title: "Resume Brief",
      description: "Evidence-backed cross-agent resume brief",
      mimeType: "text/markdown"
    },
    async () => {
      const resolvedRoot = await resolveProjectRoot();
      const brief = await projectService.resumeProject(resolvedRoot);
      return {
        contents: [{ uri: resourceUris.resumeBrief, text: brief.brief.summary }]
      };
    }
  );

  server.registerResource(
    "project-checkpoints",
    resourceUris.checkpoints,
    {
      title: "Checkpoints",
      description: "Recent project checkpoints",
      mimeType: "application/json"
    },
    async () => {
      const resolvedRoot = await resolveProjectRoot();
      const checkpoints = await projectService.listCheckpoints(resolvedRoot);
      return {
        contents: [
          {
            uri: resourceUris.checkpoints,
            mimeType: "application/json",
            text: JSON.stringify(checkpoints, null, 2)
          }
        ]
      };
    }
  );

  server.registerTool(
    "initialize_project",
    {
      description: "Initialize ACR continuity state in a repository.",
      inputSchema: {
        projectRoot: z.string(),
        force: z.boolean().optional().default(false)
      }
    },
    async ({ projectRoot }) =>
      withTool("initialize_project", projectRoot, async (resolvedRoot) => {
        const result = await projectService.store.initialize(resolvedRoot);
        const state =
          await projectService.refreshRepositoryEvidence(resolvedRoot);
        return {
          stateRevision: state.revision,
          warnings: result.warnings,
          data: result
        };
      })
  );

  server.registerTool(
    "inspect_project",
    {
      description: "Inspect repository and continuity state without mutation.",
      inputSchema: {
        projectRoot: z.string()
      }
    },
    async ({ projectRoot }) =>
      withTool("inspect_project", projectRoot, async (resolvedRoot) => {
        const result = await projectService.inspectProject(resolvedRoot);
        return {
          stateRevision: result.stateRevision,
          warnings: result.warnings,
          data: result
        };
      })
  );

  server.registerTool(
    "resume_project",
    {
      description: "Generate a fresh evidence-backed resume brief.",
      inputSchema: {
        projectRoot: z.string(),
        repairSafeDrift: z.boolean().optional().default(false),
        maxContextChars: z.number().optional()
      }
    },
    async ({ projectRoot, repairSafeDrift }) =>
      withTool("resume_project", projectRoot, async (resolvedRoot) => {
        const result = await projectService.resumeProject(
          resolvedRoot,
          repairSafeDrift
        );
        return {
          stateRevision: result.stateRevision,
          warnings: result.brief.warnings,
          data: result
        };
      })
  );

  server.registerTool(
    "update_state",
    {
      description:
        "Apply a typed patch to CURRENT_STATE.json with optimistic concurrency.",
      inputSchema: {
        projectRoot: z.string(),
        expectedRevision: z.number().int().nonnegative(),
        reason: z.string(),
        updatedBy: z.object({
          agent: z.string(),
          adapterVersion: z.string(),
          sessionId: z.string()
        }),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ projectRoot, expectedRevision, reason, updatedBy, patch }) =>
      withTool("update_state", projectRoot, async (resolvedRoot) => {
        void reason;
        const nextState = await projectService.updateState(
          resolvedRoot,
          expectedRevision,
          {
            ...patch,
            updatedBy
          }
        );
        return {
          stateRevision: nextState.revision,
          data: nextState
        };
      })
  );

  server.registerTool(
    "checkpoint",
    {
      description:
        "Create a fresh checkpoint with repository evidence captured by the server.",
      inputSchema: {
        projectRoot: z.string(),
        reason: z.string(),
        summary: z.string(),
        nextAction: z.string(),
        safeToResume: z.boolean().optional().default(true)
      }
    },
    async ({ projectRoot, reason, summary, nextAction, safeToResume }) =>
      withTool("checkpoint", projectRoot, async (resolvedRoot) => {
        const result = await projectService.createCheckpoint(
          resolvedRoot,
          reason,
          summary,
          nextAction,
          safeToResume
        );
        return {
          stateRevision: result.state.revision,
          data: result
        };
      })
  );

  server.registerTool(
    "record_decision",
    {
      description:
        "Append a structured ADR entry and link it from current state.",
      inputSchema: {
        projectRoot: z.string(),
        expectedRevision: z.number().int().nonnegative(),
        id: z.string(),
        title: z.string(),
        agent: z.string(),
        status: z.enum(["proposed", "accepted", "superseded", "rejected"]),
        context: z.string(),
        decision: z.string(),
        alternatives: z.string(),
        consequences: z.string(),
        relatedFiles: z.array(z.string()).default([])
      }
    },
    async (args) =>
      withTool("record_decision", args.projectRoot, async (resolvedRoot) => {
        await projectService.appendDecision(resolvedRoot, {
          id: args.id,
          title: args.title,
          agent: args.agent,
          status: args.status,
          context: args.context,
          decision: args.decision,
          alternatives: args.alternatives,
          consequences: args.consequences,
          relatedFiles: args.relatedFiles
        });
        const current =
          await projectService.store.readCurrentState(resolvedRoot);
        const next = await projectService.updateState(
          resolvedRoot,
          args.expectedRevision,
          {
            decisions: [...current.decisions, args.id]
          }
        );
        return {
          stateRevision: next.revision,
          data: { decisionId: args.id }
        };
      })
  );

  server.registerTool(
    "record_progress",
    {
      description: "Append a concise progress log entry.",
      inputSchema: {
        projectRoot: z.string(),
        agent: z.string(),
        task: z.string(),
        changes: z.string(),
        verification: z.string(),
        remainingWork: z.string()
      }
    },
    async ({
      projectRoot,
      agent,
      task,
      changes,
      verification,
      remainingWork
    }) =>
      withTool("record_progress", projectRoot, async (resolvedRoot) => {
        await projectService.appendProgress(resolvedRoot, {
          agent,
          task,
          changes,
          verification,
          remainingWork
        });
        const state = await projectService.store.readCurrentState(resolvedRoot);
        return {
          stateRevision: state.revision,
          data: { appended: true }
        };
      })
  );

  server.registerTool(
    "record_memory",
    {
      description:
        "Persist structured user-intent memory for future handoffs and resume briefs.",
      inputSchema: {
        projectRoot: z.string(),
        expectedRevision: z.number().int().nonnegative(),
        userIntent: z.string().optional(),
        userConstraints: z.array(z.string()).optional(),
        userPreferences: z.array(z.string()).optional(),
        rejectedApproaches: z.array(z.string()).optional(),
        openQuestions: z.array(z.string()).optional(),
        importantContext: z.array(z.string()).optional()
      }
    },
    async (args) =>
      withTool("record_memory", args.projectRoot, async (resolvedRoot) => {
        const next = await projectService.recordConversationMemory(
          resolvedRoot,
          args.expectedRevision,
          {
            ...(args.userIntent !== undefined
              ? { userIntent: args.userIntent }
              : {}),
            ...(args.userConstraints !== undefined
              ? { userConstraints: args.userConstraints }
              : {}),
            ...(args.userPreferences !== undefined
              ? { userPreferences: args.userPreferences }
              : {}),
            ...(args.rejectedApproaches !== undefined
              ? { rejectedApproaches: args.rejectedApproaches }
              : {}),
            ...(args.openQuestions !== undefined
              ? { openQuestions: args.openQuestions }
              : {}),
            ...(args.importantContext !== undefined
              ? { importantContext: args.importantContext }
              : {})
          }
        );
        return {
          stateRevision: next.revision,
          data: {
            conversationMemory: next.conversationMemory
          }
        };
      })
  );

  server.registerTool(
    "complete_task",
    {
      description: "Mark the active task completed with verification evidence.",
      inputSchema: {
        projectRoot: z.string(),
        expectedRevision: z.number().int().nonnegative(),
        completedWork: z.array(z.string()).default([]),
        verificationPassed: z.array(z.string()).default([]),
        verificationFailed: z.array(z.string()).default([]),
        verificationNotRunReason: z.string().nullable().optional(),
        nextAction: z.string()
      }
    },
    async ({
      projectRoot,
      expectedRevision,
      completedWork,
      verificationPassed,
      verificationFailed,
      verificationNotRunReason,
      nextAction
    }) =>
      withTool("complete_task", projectRoot, async (resolvedRoot) => {
        if (
          verificationPassed.length === 0 &&
          verificationFailed.length === 0 &&
          !verificationNotRunReason
        ) {
          throw new AcrToolError(
            "ACR_INVALID_INPUT",
            "Verification evidence or a not-run reason is required."
          );
        }

        const next = await projectService.updateState(
          resolvedRoot,
          expectedRevision,
          {
            completedSteps: completedWork,
            verification: {
              commands: [],
              passed: verificationPassed,
              failed: verificationFailed,
              notRunReason: verificationNotRunReason ?? null
            },
            activeTask: {
              status: "completed"
            },
            recovery: {
              resumeFrom: nextAction
            }
          }
        );
        const checkpoint = await projectService.createCheckpoint(
          resolvedRoot,
          "complete-task",
          "Completed the active task.",
          nextAction,
          true
        );
        return {
          stateRevision: checkpoint.state.revision,
          data: {
            state: next,
            checkpoint: checkpoint.checkpoint
          }
        };
      })
  );

  server.registerTool(
    "validate_state",
    {
      description:
        "Validate continuity state, managed blocks, and repository drift.",
      inputSchema: {
        projectRoot: z.string()
      }
    },
    async ({ projectRoot }) =>
      withTool("validate_state", projectRoot, async (resolvedRoot) => {
        const current =
          await projectService.store.readCurrentState(resolvedRoot);
        const result = await projectService.validate(resolvedRoot);
        return {
          stateRevision: current.revision,
          data: result,
          warnings: result.issues
            .filter((issue) => issue.severity === "warning")
            .map((issue) => issue.message)
        };
      })
  );

  server.registerTool(
    "repair_state",
    {
      description: "Run safe, deterministic repairs only.",
      inputSchema: {
        projectRoot: z.string(),
        safe: z.boolean().optional().default(false)
      }
    },
    async ({ projectRoot, safe }) =>
      withTool("repair_state", projectRoot, async (resolvedRoot) => {
        const result = await projectService.repair(resolvedRoot, safe);
        return {
          stateRevision: result.stateRevision,
          data: result
        };
      })
  );

  server.registerTool(
    "prepare_handoff",
    {
      description:
        "Create a fresh handoff checkpoint and provider-neutral resume brief.",
      inputSchema: {
        projectRoot: z.string(),
        summary: z.string(),
        nextAction: z.string()
      }
    },
    async ({ projectRoot, summary, nextAction }) =>
      withTool("prepare_handoff", projectRoot, async (resolvedRoot) => {
        const memoryState = await projectService.autoRecordHandoffMemory(
          resolvedRoot,
          {
            failureKind: "switch",
            handoffSummary: summary,
            nextAction
          }
        );
        const [resume, checkpoint] = await Promise.all([
          projectService.resumeProject(resolvedRoot, true),
          projectService.createCheckpoint(
            resolvedRoot,
            "handoff",
            summary,
            nextAction,
            true
          )
        ]);
        return {
          stateRevision: Math.max(checkpoint.state.revision, memoryState.revision),
          warnings: resume.brief.warnings,
          data: {
            checkpoint: checkpoint.checkpoint,
            resumeBrief: resume.brief
          }
        };
      })
  );

  for (const [name, description, text] of [
    [
      "initialize-repository",
      "Initialize continuity state in a repository.",
      "Inspect the repository first, initialize continuity state, preserve user instructions, and avoid destructive actions."
    ],
    [
      "resume-project",
      "Resume work from continuity state and repository evidence.",
      "Inspect repository truth before editing, use the resume brief as guidance, and continue from the exact next action."
    ],
    [
      "checkpoint-project",
      "Create a continuity checkpoint after meaningful work.",
      "Capture a concise summary, verification evidence, and the exact next action without storing transcripts."
    ],
    [
      "prepare-handoff",
      "Prepare a handoff to another agent.",
      "Create a fresh checkpoint, automatically persist high-signal handoff memory, and state the next exact action."
    ],
    [
      "repair-continuity-state",
      "Safely repair deterministic state drift.",
      "Only perform safe deterministic repairs and never overwrite repository truth to satisfy stale state."
    ]
  ] as const) {
    server.registerPrompt(name, { description }, async () => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text }
        }
      ]
    }));
  }

  return {
    server,
    async startStdio() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    }
  };
}
