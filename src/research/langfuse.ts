import { Langfuse, type LangfuseTraceClient } from "langfuse";
import type {
  GenerationEndInput,
  RunEndInput,
  RunTrace,
  StartRunInput,
  StepStartInput,
  StepTrace,
  ToolEndInput,
  ToolTrace,
  TraceSink,
} from "./trace.js";
import type { ToolCall } from "@mariozechner/pi-ai";

export interface LangfuseSinkOptions {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

interface LfObservation {
  span: (body: Record<string, unknown>) => LfObservation;
  generation: (body: Record<string, unknown>) => {
    end: (body?: Record<string, unknown>) => unknown;
  };
  event: (body: Record<string, unknown>) => unknown;
  end: (body?: Record<string, unknown>) => unknown;
}

export function createLangfuseSink(opts: LangfuseSinkOptions): TraceSink {
  const lf = new Langfuse({
    publicKey: opts.publicKey,
    secretKey: opts.secretKey,
    baseUrl: opts.baseUrl,
    flushAt: 1,
  });
  return new LangfuseSink(lf);
}

class LangfuseSink implements TraceSink {
  constructor(private readonly lf: Langfuse) {}

  startRun(input: StartRunInput): RunTrace {
    const trace = this.lf.trace({
      name: input.name,
      input: input.input,
      metadata: {
        role: input.role,
        slug: input.slug,
        ...(input.metadata ?? {}),
      },
    });
    return new LfRootRunTrace(trace);
  }

  async shutdown(): Promise<void> {
    await this.lf.shutdownAsync();
  }
}

class LfRootRunTrace implements RunTrace {
  constructor(private readonly trace: LangfuseTraceClient) {}

  startStep(input: StepStartInput): StepTrace {
    const span = this.trace.span({
      name: `step ${input.stepNumber}`,
      input: { messages: input.messages, systemPrompt: input.systemPrompt },
      metadata: { stepNumber: input.stepNumber, modelId: input.modelId },
    }) as LfObservation;
    return new LfStepTrace(span, input);
  }

  logError(message: string): void {
    this.trace.event({ name: "error", level: "ERROR", statusMessage: message });
    this.trace.update({ metadata: { lastError: message } });
  }

  logBudgetWarn(reason: string): void {
    this.trace.event({ name: "budget_warn", level: "WARNING", statusMessage: reason });
  }

  end(input: RunEndInput): void {
    this.trace.update({
      output: input.summary ?? { reason: input.reason, tokens: input.tokens },
      metadata: {
        reason: input.reason,
        tokens: input.tokens,
        sourcesCount: input.sourcesCount,
      },
    });
  }
}

class LfSubagentRunTrace implements RunTrace {
  constructor(private readonly span: LfObservation) {}

  startStep(input: StepStartInput): StepTrace {
    const span = this.span.span({
      name: `step ${input.stepNumber}`,
      input: { messages: input.messages, systemPrompt: input.systemPrompt },
      metadata: { stepNumber: input.stepNumber, modelId: input.modelId },
    }) as LfObservation;
    return new LfStepTrace(span, input);
  }

  logError(message: string): void {
    this.span.event({ name: "error", level: "ERROR", statusMessage: message });
  }

  logBudgetWarn(reason: string): void {
    this.span.event({ name: "budget_warn", level: "WARNING", statusMessage: reason });
  }

  end(input: RunEndInput): void {
    this.span.end({
      output: input.summary ?? { reason: input.reason, tokens: input.tokens },
      level: input.reason === "error" ? "ERROR" : undefined,
      metadata: {
        reason: input.reason,
        tokens: input.tokens,
        sourcesCount: input.sourcesCount,
      },
    });
  }
}

class LfStepTrace implements StepTrace {
  constructor(
    private readonly span: LfObservation,
    private readonly stepInput: StepStartInput,
  ) {}

  endGeneration(input: GenerationEndInput): void {
    const gen = this.span.generation({
      name: "llm_call",
      model: input.modelId,
      input: {
        systemPrompt: this.stepInput.systemPrompt,
        messages: this.stepInput.messages,
      },
      startTime: input.startTime,
    });
    gen.end({
      output: input.finalMessage.content,
      endTime: new Date(),
      usage: {
        input: input.usage.input,
        output: input.usage.output,
        total: input.usage.input + input.usage.output,
        unit: "TOKENS",
      },
      metadata: {
        stopReason: input.stopReason,
        cost: input.usage.cost,
        cacheRead: input.usage.cacheRead,
      },
    });
  }

  startTool(call: ToolCall, opts?: { concurrent?: boolean }): ToolTrace {
    const toolSpan = this.span.span({
      name: `tool:${call.name}`,
      input: call.arguments,
      metadata: {
        toolCallId: call.id,
        concurrent: opts?.concurrent ?? false,
      },
    }) as LfObservation;
    return new LfToolTrace(toolSpan);
  }

  end(): void {
    this.span.end();
  }
}

class LfToolTrace implements ToolTrace {
  constructor(private readonly span: LfObservation) {}

  end(input: ToolEndInput): void {
    this.span.end({
      output: input.content,
      level: input.isError ? "ERROR" : undefined,
      statusMessage: input.isError ? "tool error" : undefined,
      metadata: input.details ? { details: input.details } : undefined,
    });
  }

  startSubagentRun(input: Omit<StartRunInput, "role">): RunTrace {
    const subSpan = this.span.span({
      name: input.name,
      input: input.input,
      metadata: {
        role: "subagent",
        slug: input.slug,
        ...(input.metadata ?? {}),
      },
    }) as LfObservation;
    return new LfSubagentRunTrace(subSpan);
  }

  logFileWritten(path: string, bytes: number): void {
    this.span.event({
      name: "file_written",
      metadata: { path, bytes },
    });
  }
}
