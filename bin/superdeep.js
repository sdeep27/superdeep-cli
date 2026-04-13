#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcEntry = resolve(__dirname, "..", "src", "index.tsx");
const tsx = resolve(__dirname, "..", "node_modules", ".bin", "tsx");
const tsconfig = resolve(__dirname, "..", "tsconfig.json");

try {
  execFileSync(tsx, ["--tsconfig", tsconfig, srcEntry], { stdio: "inherit" });
} catch {
  // Non-zero exit is fine (user pressed Ctrl+C, etc.)
}
