import type { AssistantMessage, Message, ToolCall, Usage } from "@mariozechner/pi-ai";

export interface StartRunInput {
  name: string;
  role: "coordinator" | "subagent";
  slug?: string;
  input?: string;
  metadata?: Record<string, unknown>;
}

export interface RunEndInput {
  reason: "stop" | "budget" | "error";
  tokens: { input: number; output: number; cacheRead: number; cost: number };
  sourcesCount: number;
  summary?: string;
}

export interface StepStartInput {
  stepNumber: number;
  modelId: string;
  messages: Message[];
  systemPrompt?: string;
}

export interface GenerationEndInput {
  finalMessage: AssistantMessage;
  usage: Usage;
  stopReason: string;
  modelId: string;
  startTime: Date;
}

export interface ToolEndInput {
  content: string;
  isError: boolean;
  details?: unknown;
}

export interface TraceSink {
  startRun(input: StartRunInput): RunTrace;
  shutdown(): Promise<void>;
}

export interface RunTrace {
  startStep(input: StepStartInput): StepTrace;
  logError(message: string): void;
  logBudgetWarn(reason: string): void;
  end(input: RunEndInput): void;
}

export interface StepTrace {
  endGeneration(input: GenerationEndInput): void;
  startTool(call: ToolCall, opts?: { concurrent?: boolean }): ToolTrace;
  end(): void;
}

export interface ToolTrace {
  end(input: ToolEndInput): void;
  startSubagentRun(input: Omit<StartRunInput, "role">): RunTrace;
  logFileWritten(path: string, bytes: number): void;
}

class NoopToolTrace implements ToolTrace {
  end(): void {}
  startSubagentRun(): RunTrace {
    return new NoopRunTrace();
  }
  logFileWritten(): void {}
}

class NoopStepTrace implements StepTrace {
  endGeneration(): void {}
  startTool(): ToolTrace {
    return new NoopToolTrace();
  }
  end(): void {}
}

class NoopRunTrace implements RunTrace {
  startStep(): StepTrace {
    return new NoopStepTrace();
  }
  logError(): void {}
  logBudgetWarn(): void {}
  end(): void {}
}

export class NoopSink implements TraceSink {
  startRun(): RunTrace {
    return new NoopRunTrace();
  }
  async shutdown(): Promise<void> {}
}
