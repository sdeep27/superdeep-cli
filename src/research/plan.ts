import fs from "node:fs";
import path from "node:path";
import type { Api, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { resolveLangfuseConfig } from "../config.js";
import { runAgent } from "./agent.js";
import type { AgentEvent } from "./events.js";
import { createLangfuseSink } from "./langfuse.js";
import { Logger } from "./logger.js";
import { coordinatorSystemPrompt } from "./prompts/coordinator.js";
import { makeSpawnSubagent } from "./spawn.js";
import { RunState, type Budgets, type Permissions } from "./state.js";
import { NoopSink, type RunTrace, type TraceSink } from "./trace.js";
import { ToolRuntime } from "./tools/runtime.js";
import { fetchUrlTool } from "./tools/fetch-url.js";
import { grepFilesTool, listFilesTool } from "./tools/discovery.js";
import {
  readMarkdownTool,
  updateMarkdownTool,
  writeMarkdownTool,
} from "./tools/markdown.js";
import { spawnSubagentTool } from "./tools/spawn.js";
import { webSearchOnPayload } from "./tools/web-search.js";

export interface ResumeOpts {
  loopsUsed: number;
  tokens: { input: number; output: number; cacheRead: number; cost: number };
  sources: import("./events.js").Source[];
  interruptedSubagentIds: string[];
  lastEventAt: number;
}

export interface StartCoordinatorOpts {
  model: Model<Api>;
  runDir: string;
  slug: string;
  budgets?: Partial<Budgets>;
  permissions?: Permissions;
  webSearch?: boolean;
  streamOptions?: SimpleStreamOptions;
  signal?: AbortSignal;
  sink?: TraceSink;
  resume?: ResumeOpts;
}

export interface CoordinatorHandle {
  events: AsyncGenerator<AgentEvent>;
  state: RunState;
  runtime: ToolRuntime;
  shutdown: () => Promise<void>;
}

export function startCoordinator(opts: StartCoordinatorOpts): CoordinatorHandle {
  const {
    model,
    runDir,
    slug,
    budgets,
    permissions,
    webSearch = true,
    streamOptions,
    signal,
  } = opts;

  const resume = opts.resume;
  const state = new RunState({
    runDir,
    role: "coordinator",
    depth: 0,
    budgets,
    permissions,
    sources: resume?.sources,
    loopsUsed: resume?.loopsUsed,
    tokens: resume?.tokens,
  });

  const runtime = new ToolRuntime();
  runtime.register(writeMarkdownTool);
  runtime.register(updateMarkdownTool);
  runtime.register(readMarkdownTool);
  runtime.register(listFilesTool);
  runtime.register(grepFilesTool);
  runtime.register(fetchUrlTool);
  runtime.register(spawnSubagentTool);

  const logger = new Logger(runDir, "run.log");

  const sink: TraceSink = opts.sink ?? buildDefaultSink();
  const missionContent = readMissionIfAny(runDir);
  const runTrace: RunTrace = sink.startRun({
    name: resume ? `${slug} (resumed)` : slug,
    role: "coordinator",
    slug,
    input: missionContent,
    metadata: {
      runDir,
      budgets: { ...state.budgets, ...(budgets ?? {}) },
      modelId: model.id,
      ...(resume
        ? {
            resumeOf: {
              slug,
              previousLastEventAt: new Date(resume.lastEventAt).toISOString(),
              carriedLoops: resume.loopsUsed,
              carriedTokens: resume.tokens,
              interruptedSubagentIds: resume.interruptedSubagentIds,
            },
          }
        : {}),
    },
  });

  const spawnSubagent = makeSpawnSubagent({
    model,
    runtime,
    parentState: state,
    streamOptions,
    signal,
  });

  const context: Context = {
    systemPrompt: coordinatorSystemPrompt({ runDir, slug }),
    messages: [
      {
        role: "user",
        content: resume
          ? buildResumeUserPrompt(resume)
          : "Mission.md has been written. Please read it, draft Plan.md, then begin executing the plan. Narrate your steps briefly between tool calls.",
        timestamp: Date.now(),
      },
    ],
    tools: runtime.toolList(),
  };

  const mergedStreamOptions: SimpleStreamOptions = {
    reasoning: "medium",
    ...(streamOptions ?? {}),
    ...(webSearch
      ? {
          onPayload: (payload, m) => webSearchOnPayload(payload, m),
        }
      : {}),
  };

  const rawEvents = runAgent({
    model,
    state,
    runtime,
    logger,
    context,
    streamOptions: mergedStreamOptions,
    spawnSubagent,
    signal,
    runTrace,
  });

  const events = wrapForRunEnd(rawEvents, state, runTrace);

  return {
    events,
    state,
    runtime,
    shutdown: () => sink.shutdown(),
  };
}

async function* wrapForRunEnd(
  source: AsyncGenerator<AgentEvent>,
  state: RunState,
  runTrace: RunTrace,
): AsyncGenerator<AgentEvent> {
  let reason: "stop" | "budget" | "error" = "stop";
  try {
    for await (const event of source) {
      if (event.type === "done" && event.depth === 0) {
        reason = event.reason;
      }
      yield event;
    }
  } finally {
    runTrace.end({
      reason,
      tokens: state.tokens,
      sourcesCount: state.sources.length,
    });
  }
}

function buildDefaultSink(): TraceSink {
  const cfg = resolveLangfuseConfig();
  if (!cfg) return new NoopSink();
  return createLangfuseSink({
    publicKey: cfg.publicKey,
    secretKey: cfg.secretKey,
    baseUrl: cfg.host,
  });
}

function buildResumeUserPrompt(resume: ResumeOpts): string {
  const lines = [
    "RESUMING this research run. The previous coordinator was interrupted (laptop sleep, kill, or crash) — there is no in-memory state from the prior session, only what's on disk.",
    "",
    "Re-orient before acting:",
    "1. `read_markdown` `Mission.md` to refresh the goal.",
    "2. `read_markdown` `Plan.md` to see the task list and progress log.",
    "3. `list_files` to see the current shape of the knowledge base (notes/, subagents/, etc.).",
    "4. Spot-check the most recent notes with `read_markdown` so you understand what's already covered.",
    "5. Decide what's left, then update `Plan.md`'s Progress Log with a `## Resumed at " +
      new Date().toISOString() +
      "` entry summarizing your re-orientation, and continue executing.",
    "",
    `Carried-forward state from the prior session: ${resume.loopsUsed} steps used, ${resume.tokens.input} input tokens, ${resume.tokens.cacheRead} cache-read tokens, ${resume.sources.length} unique sources cited. Budgets are continuous — don't reset them.`,
  ];
  if (resume.interruptedSubagentIds.length > 0) {
    lines.push(
      "",
      "The following subagents were in-flight when the previous run died and may have incomplete `findings.md`. Their `task.md` has been annotated with an INTERRUPTED note. Read each one's findings.md to judge whether to salvage what's there or re-spawn the task:",
      ...resume.interruptedSubagentIds.map((id) => `- subagents/${id}/`),
    );
  }
  return lines.join("\n");
}

function readMissionIfAny(runDir: string): string | undefined {
  const p = path.join(runDir, "Mission.md");
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return undefined;
  }
}
