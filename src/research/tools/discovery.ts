import fs from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import { Type } from "@mariozechner/pi-ai";
import type { RegisteredTool } from "./types.js";

const ListParams = Type.Object({
  pattern: Type.Optional(
    Type.String({
      description:
        "Optional glob pattern (minimatch syntax: *, **, ?, {a,b}, [abc], !neg). Matches against paths relative to the run folder. Omit to list every file.",
    }),
  ),
});

const GrepParams = Type.Object({
  pattern: Type.String({
    description: "JavaScript regular expression to search for (case-insensitive).",
  }),
  path_glob: Type.Optional(
    Type.String({
      description:
        "Optional glob to narrow which files are searched (minimatch syntax). Defaults to all files in the run folder.",
    }),
  ),
  max_results: Type.Optional(
    Type.Number({ description: "Cap on number of match lines returned. Default 100." }),
  ),
});

const FILE_LIST_CAP = 500;
const SEARCH_FILE_CAP = 1000;
const MAX_FILE_BYTES = 512 * 1024;

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < SEARCH_FILE_CAP) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

export const listFilesTool: RegisteredTool<typeof ListParams> = {
  tool: {
    name: "list_files",
    description:
      "List files in the current run folder (recursive). Optionally filter with a glob pattern (e.g. 'notes/**', '**/findings.md'). Use this to discover what exists before guessing paths.",
    parameters: ListParams,
  },
  concurrent: true,
  handler: async ({ pattern }, ctx) => {
    const root = ctx.state.runDir;
    const files = walkFiles(root);
    const rels = files.map((f) => path.relative(root, f)).sort();
    const matched = pattern
      ? rels.filter((r) => minimatch(r, pattern, { dot: true }))
      : rels;

    if (matched.length === 0) {
      return {
        content: pattern
          ? `no files match pattern: ${pattern}\n(${rels.length} total files in run)`
          : "(run folder is empty)",
      };
    }

    const shown = matched.slice(0, FILE_LIST_CAP);
    const lines = shown.map((rel) => {
      let bytes = 0;
      try {
        bytes = fs.statSync(path.join(root, rel)).size;
      } catch {
        // ignore
      }
      return `${rel}\t${bytes}b`;
    });
    if (matched.length > FILE_LIST_CAP) {
      lines.push(
        `… (${matched.length - FILE_LIST_CAP} more, narrow with a more specific pattern)`,
      );
    }
    return { content: lines.join("\n") };
  },
};

export const grepFilesTool: RegisteredTool<typeof GrepParams> = {
  tool: {
    name: "grep_files",
    description:
      "Search file contents in the current run folder using a JavaScript regular expression (case-insensitive). Optionally narrow to a glob. Returns lines as `<rel>:<lineno>: <text>`. Use this to check whether a topic has been covered before duplicating work.",
    parameters: GrepParams,
  },
  concurrent: true,
  handler: async ({ pattern, path_glob, max_results }, ctx) => {
    const root = ctx.state.runDir;
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "i");
    } catch (err) {
      return {
        content: `invalid regex: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    const cap = typeof max_results === "number" && max_results > 0 ? max_results : 100;
    const files = walkFiles(root);
    const rels = files.map((f) => path.relative(root, f));
    const filtered = path_glob
      ? rels.filter((r) => minimatch(r, path_glob, { dot: true }))
      : rels;

    const hits: string[] = [];
    let scanned = 0;
    for (const rel of filtered) {
      if (hits.length >= cap) break;
      const abs = path.join(root, rel);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;
      let text: string;
      try {
        text = fs.readFileSync(abs, "utf-8");
      } catch {
        continue;
      }
      scanned++;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const trimmed = lines[i].trim().slice(0, 240);
          hits.push(`${rel}:${i + 1}: ${trimmed}`);
          if (hits.length >= cap) break;
        }
      }
    }

    if (hits.length === 0) {
      return {
        content: `no matches for /${pattern}/i in ${filtered.length} file(s)${path_glob ? ` (glob: ${path_glob})` : ""}`,
      };
    }
    const header = `${hits.length}${hits.length >= cap ? "+" : ""} match(es) across ${scanned} file(s):`;
    return { content: [header, ...hits].join("\n") };
  },
};
