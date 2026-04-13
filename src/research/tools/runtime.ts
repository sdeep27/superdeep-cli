import type { TSchema, Tool, ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import { now } from "../events.js";
import type {
  PostHook,
  PreHook,
  RegisteredTool,
  ToolExecCtx,
  ToolHandlerResult,
} from "./types.js";

export class ToolRuntime {
  private readonly tools = new Map<string, RegisteredTool<TSchema>>();
  private readonly globalPre: PreHook[] = [];
  private readonly globalPost: PostHook[] = [];
  private readonly concurrencyCap: number;

  constructor(opts: { concurrencyCap?: number } = {}) {
    this.concurrencyCap = opts.concurrencyCap ?? 4;
  }

  register<P extends TSchema>(reg: RegisteredTool<P>): void {
    this.tools.set(reg.tool.name, reg as unknown as RegisteredTool<TSchema>);
  }

  addPreHook(hook: PreHook): void {
    this.globalPre.push(hook);
  }

  addPostHook(hook: PostHook): void {
    this.globalPost.push(hook);
  }

  toolList(): Tool[] {
    return [...this.tools.values()].map((r) => r.tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a batch of tool calls in the order the model produced them.
   * Tools flagged `concurrent` run in parallel up to `concurrencyCap`;
   * sequential tools act as barriers.
   */
  async execute(calls: ToolCall[], ctx: ToolExecCtx): Promise<ToolResultMessage[]> {
    const results = new Array<ToolResultMessage>(calls.length);
    let inFlight: Promise<void>[] = [];

    const drain = async () => {
      if (inFlight.length === 0) return;
      await Promise.all(inFlight);
      inFlight = [];
    };

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]!;
      const reg = this.tools.get(call.name);
      const runOne = async () => {
        results[i] = await this.runCall(call, reg, ctx);
      };

      if (reg?.concurrent) {
        inFlight.push(runOne());
        if (inFlight.length >= this.concurrencyCap) await drain();
      } else {
        await drain();
        await runOne();
      }
    }

    await drain();
    return results;
  }

  private async runCall(
    call: ToolCall,
    reg: RegisteredTool<TSchema> | undefined,
    ctx: ToolExecCtx,
  ): Promise<ToolResultMessage> {
    ctx.emit({
      type: "tool_call_start",
      role: ctx.state.role,
      depth: ctx.state.depth,
      call,
      at: now(),
    });

    let args = { ...call.arguments } as Record<string, unknown>;
    let result: ToolHandlerResult;

    if (!reg) {
      result = { content: `Unknown tool: ${call.name}`, isError: true };
    } else {
      try {
        // Pre-hooks (global then tool-local)
        const preChain = [...this.globalPre, ...(reg.preHooks ?? [])];
        let vetoed: string | undefined;
        for (const h of preChain) {
          const r = await h(call.name, args, ctx);
          if (r && typeof r === "object" && "veto" in r) {
            vetoed = (r as { veto: string }).veto;
            break;
          }
          if (r && typeof r === "object") args = r as Record<string, unknown>;
        }

        if (vetoed) {
          result = { content: `Tool vetoed: ${vetoed}`, isError: true };
        } else {
          result = await reg.handler(args, ctx);
          const postChain = [...(reg.postHooks ?? []), ...this.globalPost];
          for (const h of postChain) {
            const r = await h(call.name, args, result, ctx);
            if (r) result = r;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result = { content: `Tool error: ${msg}`, isError: true };
      }
    }

    ctx.emit({
      type: "tool_call_result",
      role: ctx.state.role,
      depth: ctx.state.depth,
      callId: call.id,
      toolName: call.name,
      isError: result.isError === true,
      summary: truncate(result.content, 240),
      at: now(),
    });

    return {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: "text", text: result.content }],
      details: result.details,
      isError: result.isError === true,
      timestamp: now(),
    };
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
