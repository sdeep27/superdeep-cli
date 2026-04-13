import fs from "node:fs";
import path from "node:path";
import type { Api, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { runAgent } from "./agent.js";
import { now, type AgentEvent } from "./events.js";
import { Logger } from "./logger.js";
import type { RunState } from "./state.js";
import type { ToolRuntime } from "./tools/runtime.js";
import type { ToolExecCtx, SpawnSubagentArgs, SpawnSubagentResult } from "./tools/types.js";
import { subagentSystemPrompt } from "./prompts/subagent.js";
import { slugify } from "./run.js";

export interface SpawnFactoryDeps {
  model: Model<Api>;
  runtime: ToolRuntime;
  parentState: RunState;
  streamOptions?: SimpleStreamOptions;
  signal?: AbortSignal;
}

/**
 * Builds the `spawnSubagent` function injected into the parent's ToolExecCtx.
 * Subagent events are forwarded onto the parent's event stream via `parent.emit`.
 * Depth is enforced — attempts past maxDepth throw.
 */
export function makeSpawnSubagent(deps: SpawnFactoryDeps) {
  return async function spawnSubagent(
    args: SpawnSubagentArgs,
    parent: ToolExecCtx,
  ): Promise<SpawnSubagentResult> {
    const { model, runtime, parentState, streamOptions, signal } = deps;

    if (parent.state.depth + 1 > parentState.budgets.maxDepth) {
      throw new Error(
        `subagent depth limit reached (maxDepth=${parentState.budgets.maxDepth})`,
      );
    }

    const subagentId = makeId(args.taskTitle);
    const subDir = path.join(parentState.runDir, "subagents", subagentId);
    fs.mkdirSync(subDir, { recursive: true });

    fs.writeFileSync(
      path.join(subDir, "task.md"),
      buildTaskFile(args),
      "utf-8",
    );

    const childState = parent.state.childFor(subDir);
    const childLogger = new Logger(subDir, "run.log");

    parent.emit({
      type: "subagent_spawn",
      role: parent.state.role,
      depth: parent.state.depth,
      subagentId,
      title: args.taskTitle,
      at: now(),
    });

    const childContext: Context = {
      systemPrompt: subagentSystemPrompt({
        runDirRelative: path.relative(parentState.runDir, subDir),
        taskTitle: args.taskTitle,
      }),
      messages: [
        {
          role: "user",
          content: buildUserPrompt(args),
          timestamp: now(),
        },
      ],
      tools: runtime.toolList(),
    };

    const gen = runAgent({
      model,
      state: childState,
      runtime,
      logger: childLogger,
      context: childContext,
      streamOptions,
      spawnSubagent,
      signal,
    });

    for await (const event of gen) {
      parent.emit({
        type: "subagent_event",
        role: parent.state.role,
        depth: parent.state.depth,
        subagentId,
        event,
        at: now(),
      });
    }

    const findingsPath = path.join(subDir, "findings.md");
    const summary = readFindings(findingsPath);

    // Persist transcript
    fs.writeFileSync(
      path.join(subDir, "messages.jsonl"),
      childContext.messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
      "utf-8",
    );

    parent.emit({
      type: "subagent_done",
      role: parent.state.role,
      depth: parent.state.depth,
      subagentId,
      summary: truncate(summary, 400),
      at: now(),
    });

    return {
      subagentId,
      findingsPath: path.relative(parentState.runDir, findingsPath),
      summary,
    };
  };
}

function makeId(title: string): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  return `${ts}_${slugify(title).slice(0, 30)}`;
}

function buildTaskFile(args: SpawnSubagentArgs): string {
  return [
    `# Subagent Task: ${args.taskTitle}`,
    "",
    "## Prompt",
    "",
    args.taskPrompt,
    "",
    ...(args.scope ? ["## Scope", "", args.scope, ""] : []),
  ].join("\n");
}

function buildUserPrompt(args: SpawnSubagentArgs): string {
  return [
    `# Task: ${args.taskTitle}`,
    "",
    args.taskPrompt,
    ...(args.scope ? ["", "## Scope", args.scope] : []),
    "",
    "When you are done, make sure `findings.md` in your run folder contains the final summary for the parent coordinator. End your turn (no more tool calls) once findings.md is in place.",
  ].join("\n");
}

function readFindings(p: string): string {
  if (!fs.existsSync(p)) {
    return "(subagent did not produce findings.md)";
  }
  return fs.readFileSync(p, "utf-8");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
