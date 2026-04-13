# Langfuse self-host for superdeep-cli

A local Langfuse v3 stack gives you a tree view of every research run: each
coordinator step becomes a span, each LLM call a `generation` with full prompt
+ completion + token cost, each tool call a child span, and each subagent
nests under the `spawn_subagent` span that invoked it.

## 1. Bring up the stack

Langfuse publishes a single-file docker-compose that runs the whole v3 stack
(postgres, clickhouse, redis, minio, langfuse-web, langfuse-worker). Grab it
from their repo — pinning a tag keeps you off their moving `main` branch.

```bash
cd langfuse
curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/langfuse/langfuse/main/docker-compose.yml
docker compose up -d
```

First boot takes ~60s while clickhouse migrates. Tail with
`docker compose logs -f langfuse-web` until you see `ready`.

Web UI: http://localhost:3000

> To pin a concrete release instead of `main`, pick a `v3.x.y` tag from
> https://github.com/langfuse/langfuse/releases and swap `main` → that tag.

## 2. Create project + API keys

1. Sign up at http://localhost:3000 (first account becomes admin).
2. Create an organization, then a project (e.g. "superdeep").
3. Settings → API keys → create. Copy the **public** and **secret** keys.

## 3. Point superdeep-cli at it

Either edit `~/.superdeep/config.json`:

```json
{
  "apiKeys": { "anthropic": "..." },
  "langfuse": {
    "enabled": true,
    "host": "http://localhost:3000",
    "publicKey": "pk-lf-...",
    "secretKey": "sk-lf-..."
  }
}
```

…or export env vars (they override config.json):

```bash
export LANGFUSE_HOST=http://localhost:3000
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
```

If none of the three are set, tracing silently no-ops and the research agent
runs as before (so Langfuse is optional — not a hard dep).

## 4. Verify

Run a research flow: `npm run dev` → Deep Research Agent → short prompt →
approve Mission → watch the run. Then in the Langfuse UI → Traces, you should
see one trace named after your slug. Click in:

- root trace input = your Mission.md
- spans `step 1`, `step 2`, … under the root
- inside each step: one `llm_call` generation (model, prompt, completion,
  tokens, cost) plus one span per tool invocation
- `spawn_subagent` spans contain the full subagent sub-tree recursively
- trace output = final tokens/cost/sources/summary

## Shutdown

`docker compose down` stops; `docker compose down -v` also drops the volumes
(wipes traces).
