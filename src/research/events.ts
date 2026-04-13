import type { ToolCall, Usage } from "@mariozechner/pi-ai";

export interface Source {
  url: string;
  title?: string;
  citedBy: string;
  at: number;
}

export type AgentEvent =
  | { type: "step_start"; role: Role; depth: number; step: number; at: number }
  | { type: "text_delta"; role: Role; depth: number; delta: string; at: number }
  | { type: "thinking_delta"; role: Role; depth: number; delta: string; at: number }
  | { type: "assistant_message_done"; role: Role; depth: number; usage: Usage; at: number }
  | { type: "tool_call_start"; role: Role; depth: number; call: ToolCall; at: number }
  | {
      type: "tool_call_result";
      role: Role;
      depth: number;
      callId: string;
      toolName: string;
      isError: boolean;
      summary: string;
      at: number;
    }
  | { type: "file_written"; role: Role; depth: number; path: string; bytes: number; at: number }
  | { type: "source_cited"; role: Role; depth: number; source: Source; at: number }
  | {
      type: "subagent_spawn";
      role: Role;
      depth: number;
      subagentId: string;
      title: string;
      at: number;
    }
  | {
      type: "subagent_event";
      role: Role;
      depth: number;
      subagentId: string;
      event: AgentEvent;
      at: number;
    }
  | {
      type: "subagent_done";
      role: Role;
      depth: number;
      subagentId: string;
      summary: string;
      at: number;
    }
  | {
      type: "budget_warn";
      role: Role;
      depth: number;
      reason: "tokens" | "loops" | "depth";
      at: number;
    }
  | { type: "error"; role: Role; depth: number; message: string; at: number }
  | { type: "done"; role: Role; depth: number; reason: "stop" | "budget" | "error"; at: number };

export type Role = "coordinator" | "subagent";

export function now(): number {
  return Date.now();
}
