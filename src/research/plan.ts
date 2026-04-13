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
import {
  readMarkdownTool,
  updateMarkdownTool,
  writeMarkdownTool,
} from "./tools/markdown.js";
import { spawnSubagentTool } from "./tools/spawn.js";
import { webSearchOnPayload } from "./tools/web-search.js";

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

  const state = new RunState({
    runDir,
    role: "coordinator",
    depth: 0,
    budgets,
    permissions,
  });

  const runtime = new ToolRuntime();
  runtime.register(writeMarkdownTool);
  runtime.register(updateMarkdownTool);
  runtime.register(readMarkdownTool);
  runtime.register(fetchUrlTool);
  runtime.register(spawnSubagentTool);

  const logger = new Logger(runDir, "run.log");

  const sink: TraceSink = opts.sink ?? buildDefaultSink();
  const missionContent = readMissionIfAny(runDir);
  const runTrace: RunTrace = sink.startRun({
    name: slug,
    role: "coordinator",
    slug,
    input: missionContent,
    metadata: {
      runDir,
      budgets: { ...state.budgets, ...(budgets ?? {}) },
      modelId: model.id,
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
        content:
          "Mission.md has been written. Please read it, draft Plan.md, then begin executing the plan. Narrate your steps briefly between tool calls.",
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

function readMissionIfAny(runDir: string): string | undefined {
  const p = path.join(runDir, "Mission.md");
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return undefined;
  }
}
