import {
  streamSimple,
  type Api,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
} from "@mariozechner/pi-ai";
import { now, type AgentEvent } from "./events.js";
import type { Logger } from "./logger.js";
import type { RunState } from "./state.js";
import type { ToolRuntime } from "./tools/runtime.js";
import type { ToolExecCtx } from "./tools/types.js";
import { extractSourcesFromMessage } from "./tools/web-search.js";

export interface RunAgentOptions {
  model: Model<Api>;
  state: RunState;
  runtime: ToolRuntime;
  logger: Logger;
  context: Context;
  streamOptions?: SimpleStreamOptions;
  spawnSubagent: ToolExecCtx["spawnSubagent"];
  signal?: AbortSignal;
}

/**
 * Main async generator loop for coordinator and subagents.
 * Yields AgentEvents and keeps appending to the shared `context.messages`
 * so the caller can persist the final transcript.
 */
export async function* runAgent(opts: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const { model, state, runtime, logger, context, streamOptions, spawnSubagent, signal } =
    opts;

  const pending: AgentEvent[] = [];
  const emit = (event: AgentEvent) => {
    logger.log(event);
    pending.push(event);
  };

  const drain = function* (): Generator<AgentEvent> {
    while (pending.length) yield pending.shift()!;
  };

  const toolCtx: ToolExecCtx = {
    state,
    logger,
    emit,
    spawnSubagent,
  };

  // Make sure tools from runtime are attached to the context.
  context.tools = runtime.toolList();

  while (true) {
    const trip = state.budgetExceeded();
    if (trip) {
      emit({
        type: "budget_warn",
        role: state.role,
        depth: state.depth,
        reason: trip,
        at: now(),
      });
      yield* drain();
      emit({
        type: "done",
        role: state.role,
        depth: state.depth,
        reason: "budget",
        at: now(),
      });
      yield* drain();
      return;
    }

    state.incLoop();
    const stepNumber = state.loopsUsed;
    emit({
      type: "step_start",
      role: state.role,
      depth: state.depth,
      step: stepNumber,
      at: now(),
    });
    yield* drain();

    let finalMessage: Message | null = null;
    let stopReason: "stop" | "length" | "toolUse" | "error" | "aborted" = "stop";

    try {
      const stream = streamSimple(model, context, {
        ...(streamOptions ?? {}),
        signal,
      });
      for await (const event of stream) {
        if (event.type === "text_delta") {
          emit({
            type: "text_delta",
            role: state.role,
            depth: state.depth,
            delta: event.delta,
            at: now(),
          });
          yield* drain();
        } else if (event.type === "thinking_delta") {
          emit({
            type: "thinking_delta",
            role: state.role,
            depth: state.depth,
            delta: event.delta,
            at: now(),
          });
          yield* drain();
        } else if (event.type === "done") {
          finalMessage = event.message;
          stopReason = event.reason;
        } else if (event.type === "error") {
          finalMessage = event.error;
          stopReason = event.reason;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({
        type: "error",
        role: state.role,
        depth: state.depth,
        message,
        at: now(),
      });
      yield* drain();
      emit({
        type: "done",
        role: state.role,
        depth: state.depth,
        reason: "error",
        at: now(),
      });
      yield* drain();
      return;
    }

    if (!finalMessage || finalMessage.role !== "assistant") {
      emit({
        type: "error",
        role: state.role,
        depth: state.depth,
        message: "stream ended without assistant message",
        at: now(),
      });
      yield* drain();
      emit({
        type: "done",
        role: state.role,
        depth: state.depth,
        reason: "error",
        at: now(),
      });
      yield* drain();
      return;
    }

    state.addUsage(finalMessage.usage);
    extractSourcesFromMessage(finalMessage, state);
    context.messages.push(finalMessage);

    emit({
      type: "assistant_message_done",
      role: state.role,
      depth: state.depth,
      usage: finalMessage.usage,
      at: now(),
    });
    yield* drain();

    if (stopReason === "toolUse") {
      const toolCalls: ToolCall[] = finalMessage.content.filter(
        (c): c is ToolCall => c.type === "toolCall",
      );
      const results = await runtime.execute(toolCalls, toolCtx);
      yield* drain();
      for (const r of results) context.messages.push(r);
      continue;
    }

    emit({
      type: "done",
      role: state.role,
      depth: state.depth,
      reason: stopReason === "error" || stopReason === "aborted" ? "error" : "stop",
      at: now(),
    });
    yield* drain();
    return;
  }
}
