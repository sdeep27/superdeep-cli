import type { Api, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { runAgent } from "./agent.js";
import type { AgentEvent } from "./events.js";
import { Logger } from "./logger.js";
import { coordinatorSystemPrompt } from "./prompts/coordinator.js";
import { makeSpawnSubagent } from "./spawn.js";
import { RunState, type Budgets, type Permissions } from "./state.js";
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
}

export interface CoordinatorHandle {
  events: AsyncGenerator<AgentEvent>;
  state: RunState;
  runtime: ToolRuntime;
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

  const events = runAgent({
    model,
    state,
    runtime,
    logger,
    context,
    streamOptions: mergedStreamOptions,
    spawnSubagent,
    signal,
  });

  return { events, state, runtime };
}
