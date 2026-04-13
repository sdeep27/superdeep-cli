import type { Static, TSchema, Tool, ToolResultMessage } from "@mariozechner/pi-ai";
import type { AgentEvent } from "../events.js";
import type { RunState } from "../state.js";
import type { Logger } from "../logger.js";
import type { StepTrace, ToolTrace } from "../trace.js";

export interface SpawnSubagentArgs {
  taskTitle: string;
  taskPrompt: string;
  scope?: string;
}

export interface SpawnSubagentResult {
  summary: string;
  subagentId: string;
  findingsPath: string;
}

export interface ToolExecCtx {
  state: RunState;
  logger: Logger;
  emit: (event: AgentEvent) => void;
  spawnSubagent: (args: SpawnSubagentArgs, parent: ToolExecCtx) => Promise<SpawnSubagentResult>;
  stepTrace?: StepTrace;
  toolTrace?: ToolTrace;
}

export interface ToolHandlerResult {
  content: string;
  isError?: boolean;
  details?: unknown;
}

export type PreHookResult =
  | { veto: string }
  | Record<string, unknown>
  | void
  | undefined;

export type PreHook = (
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecCtx,
) => Promise<PreHookResult> | PreHookResult;

export type PostHook = (
  name: string,
  args: Record<string, unknown>,
  result: ToolHandlerResult,
  ctx: ToolExecCtx,
) => Promise<ToolHandlerResult | void> | ToolHandlerResult | void;

export interface RegisteredTool<P extends TSchema = TSchema> {
  tool: Tool<P>;
  handler: (args: Static<P>, ctx: ToolExecCtx) => Promise<ToolHandlerResult>;
  concurrent?: boolean;
  preHooks?: PreHook[];
  postHooks?: PostHook[];
}

export type ToolResult = ToolResultMessage;
