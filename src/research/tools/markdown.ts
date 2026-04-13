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
    description: "Read a markdown file from the current run folder.",
    parameters: ReadParams,
  },
  handler: async ({ path: rel }, ctx) => {
    ensureMd(rel);
    const abs = resolveInRun(ctx.state.runDir, rel);
    if (!fs.existsSync(abs)) {
      return { content: `file not found: ${rel}`, isError: true };
    }
    const text = fs.readFileSync(abs, "utf-8");
    return { content: text };
  },
};
