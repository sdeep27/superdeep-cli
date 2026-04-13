import fs from "node:fs";
import path from "node:path";

export interface RunFolder {
  slug: string;
  absDir: string;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "research";
}

/**
 * Reserve a run folder under ./research/{slug}. If the slug already exists,
 * suffix with -2, -3, etc. Creates the directory + base subfolders.
 */
export function createRunFolder(rawTopic: string, cwd = process.cwd()): RunFolder {
  const root = path.join(cwd, "research");
  fs.mkdirSync(root, { recursive: true });

  const base = slugify(rawTopic);
  let slug = base;
  let n = 2;
  while (fs.existsSync(path.join(root, slug))) {
    slug = `${base}-${n++}`;
  }
  const absDir = path.join(root, slug);
  fs.mkdirSync(path.join(absDir, "notes"), { recursive: true });
  fs.mkdirSync(path.join(absDir, "subagents"), { recursive: true });
  return { slug, absDir };
}

/** Safe-write: refuses to escape runDir via .. or absolute paths. */
export function resolveInRun(runDir: string, relativePath: string): string {
  const cleaned = relativePath.replace(/^[\\/]+/, "");
  const resolved = path.resolve(runDir, cleaned);
  const relBack = path.relative(runDir, resolved);
  if (relBack.startsWith("..") || path.isAbsolute(relBack)) {
    throw new Error(`path escapes run folder: ${relativePath}`);
  }
  return resolved;
}
