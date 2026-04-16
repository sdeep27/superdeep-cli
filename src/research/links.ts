import fs from "node:fs";
import path from "node:path";

interface LinkRef {
  fromFile: string;
  text: string;
  rawTarget: string;
  resolvedTarget: string;
  anchor?: string;
  line: number;
}

const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const SKIP_PROTOCOLS = /^(https?:|mailto:|ftp:|data:|#)/i;
const SKIP_NAMES = new Set(["Links.md"]);

function walkMarkdown(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  }
  return out;
}

function extractLinks(runDir: string, absFile: string): LinkRef[] {
  const fromFile = path.relative(runDir, absFile);
  let text: string;
  try {
    text = fs.readFileSync(absFile, "utf-8");
  } catch {
    return [];
  }
  const lines = text.split("\n");
  const refs: LinkRef[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINK_RE.exec(line)) !== null) {
      const linkText = m[1].trim();
      const target = m[2].trim();
      if (SKIP_PROTOCOLS.test(target)) continue;
      const [pathPart, anchor] = target.split("#", 2);
      if (!pathPart || !pathPart.toLowerCase().endsWith(".md")) continue;
      const sourceDir = path.dirname(absFile);
      const absResolved = path.resolve(sourceDir, pathPart);
      const rel = path.relative(runDir, absResolved);
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
      if (rel === fromFile) continue;
      refs.push({
        fromFile,
        text: linkText,
        rawTarget: target,
        resolvedTarget: rel,
        anchor: anchor || undefined,
        line: i + 1,
      });
    }
  }
  return refs;
}

export function buildLinksIndex(runDir: string): { path: string; bytes: number } | null {
  if (!fs.existsSync(runDir)) return null;
  const files = walkMarkdown(runDir)
    .map((abs) => ({ abs, rel: path.relative(runDir, abs) }))
    .filter((f) => !SKIP_NAMES.has(path.basename(f.rel)))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  const byTarget = new Map<string, LinkRef[]>();
  let totalLinks = 0;
  for (const f of files) {
    for (const ref of extractLinks(runDir, f.abs)) {
      totalLinks++;
      const list = byTarget.get(ref.resolvedTarget) ?? [];
      list.push(ref);
      byTarget.set(ref.resolvedTarget, list);
    }
  }

  const allRels = new Set(files.map((f) => f.rel));
  const targets = [...byTarget.keys()].sort();
  const orphans = files
    .map((f) => f.rel)
    .filter((r) => !byTarget.has(r))
    .sort();

  const lines: string[] = [];
  lines.push("# Links Index");
  lines.push("");
  lines.push(
    `_Auto-generated reverse index of internal markdown links. ${totalLinks} link(s) across ${files.length} file(s)._`,
  );
  lines.push("");

  if (targets.length === 0) {
    lines.push("No internal links found yet. Encourage cross-references with `[term](relative/path.md)` between notes.");
  } else {
    lines.push("## Incoming references by target");
    lines.push("");
    for (const target of targets) {
      const exists = allRels.has(target);
      const header = exists ? target : `${target} _(missing)_`;
      lines.push(`### ${header}`);
      const refs = byTarget.get(target)!.sort(
        (a, b) => a.fromFile.localeCompare(b.fromFile) || a.line - b.line,
      );
      for (const ref of refs) {
        const anchor = ref.anchor ? ` _(#${ref.anchor})_` : "";
        lines.push(`- [${ref.text}](${ref.fromFile}) — \`${ref.fromFile}:${ref.line}\`${anchor}`);
      }
      lines.push("");
    }
  }

  if (orphans.length > 0) {
    lines.push("## Files with no incoming links");
    lines.push("");
    for (const o of orphans) lines.push(`- ${o}`);
    lines.push("");
  }

  const content = lines.join("\n");
  const outPath = path.join(runDir, "Links.md");
  fs.writeFileSync(outPath, content, "utf-8");
  return { path: "Links.md", bytes: Buffer.byteLength(content, "utf-8") };
}
