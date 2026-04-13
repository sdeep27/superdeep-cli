import type { AssistantMessage, Model, Api } from "@mariozechner/pi-ai";
import type { RunState } from "../state.js";
import { now, type Source } from "../events.js";

/**
 * Provider-native web search — attached to the stream via SimpleStreamOptions.onPayload.
 * Today we target Anthropic; add branches when extending to other providers.
 */
export function webSearchOnPayload(
  payload: unknown,
  model: Model<Api>,
): unknown {
  const p = payload as Record<string, unknown>;
  const tools = (p.tools as unknown[]) ?? [];
  switch (model.provider) {
    case "anthropic":
      tools.push({ type: "web_search_20250305", name: "web_search" });
      break;
    case "openai":
      tools.push({ type: "web_search" });
      break;
    case "google":
      tools.push({ googleSearch: {} });
      break;
    default:
      return payload;
  }
  p.tools = tools;
  return p;
}

/**
 * Best-effort citation extractor run after each assistant message.
 * Anthropic web search returns tool-use + tool-result blocks with sources;
 * we inspect the final assistant message for anything url-shaped and record it.
 */
export function extractSourcesFromMessage(
  message: AssistantMessage,
  state: RunState,
): Source[] {
  const found: Source[] = [];
  for (const block of message.content) {
    if (block.type !== "text") continue;
    const text = block.text;
    const re = /https?:\/\/[^\s)\]}'"`]+/g;
    for (const m of text.matchAll(re)) {
      const url = trimTrailingPunct(m[0]);
      const src: Source = {
        url,
        citedBy: `${state.role}:assistant`,
        at: now(),
      };
      state.addSource(src);
      found.push(src);
    }
  }
  return found;
}

function trimTrailingPunct(url: string): string {
  return url.replace(/[),.;:!?]+$/, "");
}
