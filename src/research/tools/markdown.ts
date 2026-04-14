import fs from "node:fs";
import path from "node:path";
import { Type } from "@mariozechner/pi-ai";
import type { RegisteredTool } from "./types.js";
import { now } from "../events.js";
import { resolveInRun } from "../run.js";

const RelativePath = Type.String({
  description: "Path relative to the current run folder (e.g. 'notes/foo.md'). Must end in .md.",
});

const WriteParams = Type.Object({
  path: RelativePath,
  content: Type.String({ description: "Full markdown content to write." }),
});

const ReadParams = Type.Object({
  path: RelativePath,
});

const UpdateParams = Type.Object({
  path: RelativePath,
  content: Type.String({
    description:
      "Full replacement content. The file is overwritten. For appends, read first then write the combined content.",
  }),
});

function ensureMd(relPath: string): void {
  if (!relPath.endsWith(".md")) {
    throw new Error(`markdown tools only accept .md paths: ${relPath}`);
  }
}

export const writeMarkdownTool: RegisteredTool<typeof WriteParams> = {
  tool: {
    name: "write_markdown",
    description:
      "Create or overwrite a markdown file inside the current run folder. Use relative paths like 'notes/topic.md'. All research output is markdown.",
    parameters: WriteParams,
  },
  handler: async ({ path: rel, content }, ctx) => {
    ensureMd(rel);
    const abs = resolveInRun(ctx.state.runDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
    ctx.emit({
      type: "file_written",
      role: ctx.state.role,
      depth: ctx.state.depth,
      path: rel,
      bytes: Buffer.byteLength(content, "utf-8"),
      at: now(),
    });
    return { content: `wrote ${rel} (${content.length} chars)` };
  },
};

export const updateMarkdownTool: RegisteredTool<typeof UpdateParams> = {
  tool: {
    name: "update_markdown",
    description:
      "Overwrite an existing markdown file in the run folder with new full content. Use this to keep Plan.md and other living docs up to date.",
    parameters: UpdateParams,
  },
  handler: async ({ path: rel, content }, ctx) => {
    ensureMd(rel);
    const abs = resolveInRun(ctx.state.runDir, rel);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
    }
    fs.writeFileSync(abs, content, "utf-8");
    ctx.emit({
      type: "file_written",
      role: ctx.state.role,
      depth: ctx.state.depth,
      path: rel,
      bytes: Buffer.byteLength(content, "utf-8"),
      at: now(),
    });
    return { content: `updated ${rel} (${content.length} chars)` };
  },
};

export const readMarkdownTool: RegisteredTool<typeof ReadParams> = {
  tool: {
    name: "read_markdown",
    description:
      "Read a markdown file from the current run folder. If the file does not exist, the error response includes a listing of the nearest existing directory and any similarly-named files in the run — use that to retry with a corrected path or call list_files / grep_files to discover what exists.",
    parameters: ReadParams,
  },
  concurrent: true,
  handler: async ({ path: rel }, ctx) => {
    ensureMd(rel);
    const abs = resolveInRun(ctx.state.runDir, rel);
    if (!fs.existsSync(abs)) {
      const hint = describeMissingPath(ctx.state.runDir, abs, rel);
      return { content: hint, isError: true };
    }
    const text = fs.readFileSync(abs, "utf-8");
    return { content: text };
  },
};

function describeMissingPath(runDir: string, abs: string, rel: string): string {
  const lines: string[] = [`file not found: ${rel}`];

  let dir = path.dirname(abs);
  while (!fs.existsSync(dir) && dir.startsWith(runDir) && dir !== runDir) {
    dir = path.dirname(dir);
  }
  if (!fs.existsSync(dir)) dir = runDir;

  const ancestorRel = path.relative(runDir, dir) || ".";
  lines.push(`nearest existing directory: ${ancestorRel}/`);

  try {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
      .sort();
    const shown = entries.slice(0, 40);
    lines.push(`contents (${shown.length}${entries.length > 40 ? ` of ${entries.length}` : ""}):`);
    for (const e of shown) lines.push(`  ${e}`);
  } catch {
    // ignore
  }

  const base = path.basename(rel);
  if (base.length >= 4) {
    const similar = findSimilarBasenames(runDir, base, 10);
    if (similar.length > 0) {
      lines.push(`similarly-named files elsewhere in the run:`);
      for (const s of similar) lines.push(`  ${s}`);
    }
  }

  return lines.join("\n");
}

function findSimilarBasenames(runDir: string, target: string, cap: number): string[] {
  const targetLower = target.toLowerCase();
  const targetStem = targetLower.replace(/\.md$/, "");
  const hits: string[] = [];

  const walk = (dir: string): void => {
    if (hits.length >= cap) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= cap) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        const nameLower = e.name.toLowerCase();
        if (
          nameLower === targetLower ||
          nameLower.includes(targetStem) ||
          targetStem.includes(nameLower.replace(/\.md$/, ""))
        ) {
          hits.push(path.relative(runDir, full));
        }
      }
    }
  };
  walk(runDir);
  return hits;
}
