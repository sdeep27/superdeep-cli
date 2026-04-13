import fs from "node:fs";
import path from "node:path";
import type { AgentEvent } from "./events.js";

export class Logger {
  private readonly file: string;

  constructor(runDir: string, filename = "run.log") {
    this.file = path.join(runDir, filename);
    fs.mkdirSync(runDir, { recursive: true });
  }

  log(event: AgentEvent): void {
    const line = JSON.stringify(compact(event)) + "\n";
    fs.appendFileSync(this.file, line, "utf-8");
  }
}

function compact(event: AgentEvent): unknown {
  // Keep event shape but trim noisy deltas in the log itself — we aggregate
  // the assistant message on `assistant_message_done` already.
  if (event.type === "text_delta" || event.type === "thinking_delta") {
    return {
      type: event.type,
      role: event.role,
      depth: event.depth,
      at: event.at,
      len: event.delta.length,
    };
  }
  return event;
}
