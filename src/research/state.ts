import type { Usage } from "@mariozechner/pi-ai";
import type { Role, Source } from "./events.js";

export interface Budgets {
  maxLoops: number;
  maxDepth: number;
  maxInputTokens: number;
}

export interface Permissions {
  fetchAllow?: string[];
  fetchDeny?: string[];
}

export const DEFAULT_BUDGETS: Budgets = {
  maxLoops: 30,
  maxDepth: 1,
  maxInputTokens: 500_000,
};

export interface RunStateInit {
  runDir: string;
  role: Role;
  depth: number;
  budgets?: Partial<Budgets>;
  permissions?: Permissions;
  sources?: Source[];
  loopsUsed?: number;
  tokens?: { input: number; output: number; cacheRead: number; cost: number };
}

export class RunState {
  readonly runDir: string;
  readonly role: Role;
  readonly depth: number;
  readonly budgets: Budgets;
  readonly permissions: Permissions;

  loopsUsed = 0;
  tokens = { input: 0, output: 0, cacheRead: 0, cost: 0 };
  sources: Source[];

  constructor(init: RunStateInit) {
    this.runDir = init.runDir;
    this.role = init.role;
    this.depth = init.depth;
    this.budgets = { ...DEFAULT_BUDGETS, ...(init.budgets ?? {}) };
    this.permissions = init.permissions ?? {};
    this.sources = init.sources ?? [];
    if (typeof init.loopsUsed === "number") this.loopsUsed = init.loopsUsed;
    if (init.tokens) this.tokens = { ...init.tokens };
  }

  addUsage(u: Usage): void {
    this.tokens.input += u.input;
    this.tokens.output += u.output;
    this.tokens.cacheRead += u.cacheRead;
    this.tokens.cost += u.cost.total;
  }

  addSource(s: Source): void {
    if (!this.sources.find((x) => x.url === s.url)) {
      this.sources.push(s);
    }
  }

  incLoop(): void {
    this.loopsUsed += 1;
  }

  budgetExceeded(): "tokens" | "loops" | "depth" | null {
    if (this.loopsUsed >= this.budgets.maxLoops) return "loops";
    if (this.tokens.input >= this.budgets.maxInputTokens) return "tokens";
    if (this.depth > this.budgets.maxDepth) return "depth";
    return null;
  }

  /** Create a child state for a subagent. Shares runDir + sources; fresh loop count. */
  childFor(subagentDir: string, overrides?: Partial<Budgets>): RunState {
    return new RunState({
      runDir: subagentDir,
      role: "subagent",
      depth: this.depth + 1,
      budgets: {
        ...this.budgets,
        maxLoops: 15,
        ...(overrides ?? {}),
      },
      permissions: this.permissions,
      sources: this.sources,
    });
  }
}
