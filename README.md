# superdeep-cli

A deep research CLI where agents and subagents save their work as organized markdown files along the way — building a durable knowledge base, not just a single synthesis report. The knowledge base is structured so post-run agents (Socratic tutoring, quizzes, simpler concept breakdowns, charts) can consume it directly.

Built on [Ink](https://github.com/vadimdemedes/ink) (React for the terminal) and [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai) for multi-provider LLM access.

## What you get

- **Deep Research Agent** — a coordinator LLM plans the work, spawns subagents, and streams progress into the terminal. Everything it produces (`Mission.md`, `Plan.md`, `notes/*.md`, `subagents/{id}/findings.md`, …) is written to `./research/{slug}/` as the run progresses.
- **Mission clarifier** — before the run starts, the model asks a short round of clarifying questions and writes an approved `Mission.md`.
- **Model picker** — ranks models by intelligence score (from [llmpricingapi.com](https://llmpricingapi.com)), filtered to providers you've configured, with Claude Opus 4.6 pinned as the default.
- **Resume** — interrupt a run with Ctrl-C; restart later from disk state with prior tokens, loops, and sources carried forward.
- **Cross-file linkage** — the run emits a `Links.md` index of wikilink references and orphans across the knowledge base.
- **Observability (optional)** — self-host [Langfuse v3](https://langfuse.com) to get a tree view of every step, tool call, generation, and nested subagent. See [`langfuse/README.md`](langfuse/README.md).
- **Chat** — a separate multi-turn chat screen with streaming, web search, and reasoning-level toggles.

## Install

Requires Node.js ≥ 20.

```bash
git clone <this-repo>
cd superdeep-cli
npm install
npm run build
npm link   # optional — exposes the `superdeep` command globally
```

## Run

```bash
superdeep        # if you ran `npm link`
# or
npm run dev      # from the repo
```

On first launch, pick **Configure API keys** and add at least one provider. Keys are stored in `~/.superdeep/config.json` (chmod 600) and loaded into environment variables on startup.

Supported providers (via pi-ai): Anthropic, OpenAI, Google, Mistral, Groq, Perplexity, DeepSeek.

## Where things live

```
~/.superdeep/config.json     # your API keys + optional langfuse config
./research/{slug}/           # per-run knowledge base (one folder per research topic)
  Mission.md
  Plan.md
  notes/*.md
  subagents/{id}/
    task.md
    findings.md
    messages.jsonl
  run.log                    # JSONL event stream
  Links.md                   # auto-generated cross-reference index
```

## Langfuse (optional)

Self-host Langfuse v3 to see run traces. One-time setup in [`langfuse/README.md`](langfuse/README.md). Add the host + API keys to `~/.superdeep/config.json` under a `langfuse` block, or set `LANGFUSE_HOST` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` env vars. Without it, tracing is a no-op.

## Status

Early / experimental. Interfaces, prompts, and on-disk layout will change.

## License

[MIT](LICENSE)
