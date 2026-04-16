import { getModel, getModels } from "@mariozechner/pi-ai";
import type { Api, KnownProvider, Model } from "@mariozechner/pi-ai";

const PRICING_URL = "https://llmpricingapi.com/api/models";
const FETCH_TIMEOUT_MS = 5000;

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL_ID = "claude-opus-4-6";

interface PricingEntry {
  name: string;
  provider: string;
  intelligence_score: number | null;
  input_price: number | null;
  output_price: number | null;
  context_window: number | null;
}

export interface RankedModel {
  piModel: Model<Api>;
  providerId: string;
  intelligenceScore: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  contextWindow: number | null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

async function fetchPricing(): Promise<PricingEntry[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(PRICING_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const body = (await res.json()) as { models?: PricingEntry[] };
    return body.models ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the llmpricingapi model list and join against pi-ai's registry,
 * restricted to providers the user has keys for. Ordered by intelligence
 * score desc, with Claude Opus 4.6 pinned to index 0 if present.
 *
 * Falls back to just Opus 4.6 (if anthropic is configured) on fetch failure
 * so the picker still works offline — we never invent models outside the
 * pricing API, we just keep the default alive.
 */
export async function fetchRankedModels(
  configuredProviders: string[],
): Promise<RankedModel[]> {
  const providerSet = new Set(configuredProviders);

  let entries: PricingEntry[] = [];
  try {
    entries = await fetchPricing();
  } catch {
    return fallback(providerSet);
  }

  const ranked: RankedModel[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!providerSet.has(entry.provider)) continue;
    let models: Model<Api>[];
    try {
      models = getModels(entry.provider as KnownProvider) as Model<Api>[];
    } catch {
      continue;
    }
    const want = normalize(entry.name);
    const match = models.find((m) => normalize(m.name) === want);
    if (!match) continue;
    const key = `${entry.provider}::${match.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push({
      piModel: match,
      providerId: entry.provider,
      intelligenceScore: entry.intelligence_score,
      inputPrice: entry.input_price,
      outputPrice: entry.output_price,
      contextWindow: entry.context_window ?? match.contextWindow ?? null,
    });
  }

  ranked.sort((a, b) => (b.intelligenceScore ?? -1) - (a.intelligenceScore ?? -1));

  const opusIdx = ranked.findIndex(
    (r) => r.providerId === DEFAULT_PROVIDER && r.piModel.id === DEFAULT_MODEL_ID,
  );
  if (opusIdx > 0) {
    const [opus] = ranked.splice(opusIdx, 1);
    ranked.unshift(opus);
  } else if (opusIdx === -1 && providerSet.has(DEFAULT_PROVIDER)) {
    const fb = fallback(providerSet);
    if (fb.length > 0) ranked.unshift(fb[0]);
  }

  return ranked;
}

function fallback(providerSet: Set<string>): RankedModel[] {
  if (!providerSet.has(DEFAULT_PROVIDER)) return [];
  try {
    const m = getModel(DEFAULT_PROVIDER, DEFAULT_MODEL_ID) as Model<Api>;
    return [
      {
        piModel: m,
        providerId: DEFAULT_PROVIDER,
        intelligenceScore: null,
        inputPrice: null,
        outputPrice: null,
        contextWindow: m.contextWindow ?? null,
      },
    ];
  } catch {
    return [];
  }
}

export function describeRanked(r: RankedModel): string {
  const parts: string[] = [r.piModel.name];
  if (r.intelligenceScore !== null) parts.push(`intel ${r.intelligenceScore}`);
  if (r.inputPrice !== null && r.outputPrice !== null) {
    parts.push(`$${r.inputPrice}/${r.outputPrice} per M`);
  }
  if (r.contextWindow) {
    parts.push(`${Math.round(r.contextWindow / 1000)}k ctx`);
  }
  return parts.join(" · ");
}
