import fs from "node:fs";
import path from "node:path";
import type { AgentEvent, Source } from "./events.js";

export type RunStatus =
  | { status: "completed"; reason: "stop" | "budget" | "error" }
  | { status: "interrupted" };

export interface RunFolderSummary {
  slug: string;
  absDir: string;
  title: string;
  steps: number;
  lastEventAt: number;
  status: RunStatus;
}

export interface RehydratedRun {
  loopsUsed: number;
  tokens: { input: number; output: number; cacheRead: number; cost: number };
  sources: Source[];
  interruptedSubagentIds: string[];
  lastEventAt: number;
}

const RESEARCH_ROOT = "research";

export function listRunFolders(cwd = process.cwd()): RunFolderSummary[] {
  const root = path.join(cwd, RESEARCH_ROOT);
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const out: RunFolderSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const absDir = path.join(root, e.name);
    const logPath = path.join(absDir, "run.log");
    if (!fs.existsSync(logPath)) continue;
    const status = readRunStatus(absDir);
    const events = readEvents(logPath);
    const steps = events.reduce(
      (acc, ev) => (ev.type === "step_start" && ev.depth === 0 ? Math.max(acc, ev.step) : acc),
      0,
    );
    const lastEventAt =
      events.length > 0 ? events[events.length - 1].at : fs.statSync(logPath).mtimeMs;
    out.push({
      slug: e.name,
      absDir,
      title: readMissionTitle(absDir) ?? e.name,
      steps,
      lastEventAt,
      status,
    });
  }
  return out.sort((a, b) => b.lastEventAt - a.lastEventAt);
}

export function readRunStatus(runDir: string): RunStatus {
  const events = readEvents(path.join(runDir, "run.log"));
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === "done" && ev.depth === 0) {
      return { status: "completed", reason: ev.reason };
    }
  }
  return { status: "interrupted" };
}

export function rehydrateRun(runDir: string): RehydratedRun {
  const events = readEvents(path.join(runDir, "run.log"));

  let loopsUsed = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cost: 0 };
  const sourcesByUrl = new Map<string, Source>();
  const spawned = new Set<string>();
  const finished = new Set<string>();
  let lastEventAt = 0;

  for (const ev of events) {
    if (ev.at > lastEventAt) lastEventAt = ev.at;

    if (ev.type === "step_start" && ev.depth === 0) {
      if (ev.step > loopsUsed) loopsUsed = ev.step;
    } else if (ev.type === "assistant_message_done" && ev.depth === 0) {
      tokens.input += ev.usage.input;
      tokens.output += ev.usage.output;
      tokens.cacheRead += ev.usage.cacheRead;
      tokens.cost += ev.usage.cost.total;
    } else if (ev.type === "source_cited") {
      if (!sourcesByUrl.has(ev.source.url)) sourcesByUrl.set(ev.source.url, ev.source);
    } else if (ev.type === "subagent_spawn") {
      spawned.add(ev.subagentId);
    } else if (ev.type === "subagent_done") {
      finished.add(ev.subagentId);
    }
  }

  const interruptedSubagentIds = [...spawned].filter((id) => !finished.has(id));

  return {
    loopsUsed,
    tokens,
    sources: [...sourcesByUrl.values()],
    interruptedSubagentIds,
    lastEventAt,
  };
}

export function annotateInterruptedSubagents(
  runDir: string,
  interruptedIds: string[],
  at = Date.now(),
): void {
  const iso = new Date(at).toISOString();
  const marker = `\n\n> INTERRUPTED at ${iso} — findings.md may be incomplete. Coordinator will decide whether to re-spawn.\n`;
  for (const id of interruptedIds) {
    const taskPath = path.join(runDir, "subagents", id, "task.md");
    if (!fs.existsSync(taskPath)) continue;
    const current = fs.readFileSync(taskPath, "utf-8");
    if (current.includes("> INTERRUPTED at ")) continue;
    fs.appendFileSync(taskPath, marker, "utf-8");
  }
}

function readEvents(logPath: string): AgentEvent[] {
  if (!fs.existsSync(logPath)) return [];
  const raw = fs.readFileSync(logPath, "utf-8");
  const out: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as AgentEvent);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

function readMissionTitle(runDir: string): string | undefined {
  const p = path.join(runDir, "Mission.md");
  if (!fs.existsSync(p)) return undefined;
  const text = fs.readFileSync(p, "utf-8");
  for (const line of text.split("\n")) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return undefined;
}
