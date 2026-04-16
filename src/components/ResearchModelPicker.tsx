import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getConfiguredProviders, PROVIDERS } from "../config.js";
import {
  describeRanked,
  fetchRankedModels,
  type RankedModel,
} from "../research/model-ranking.js";

interface Props {
  onPick: (model: Model<Api>) => void;
  onBack: () => void;
}

export function ResearchModelPicker({ onPick, onBack }: Props) {
  const [ranked, setRanked] = useState<RankedModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useInput((_, key) => {
    if (key.escape) onBack();
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchRankedModels(getConfiguredProviders());
        if (!cancelled) setRanked(list);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setRanked([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (ranked === null) {
    return (
      <Box flexDirection="column">
        <Text bold>{"  Select research model"}</Text>
        <Text>
          {"  "}
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          {"  fetching model intelligence rankings…"}
        </Text>
      </Box>
    );
  }

  if (ranked.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          {"  No research-capable models available for your configured providers."}
        </Text>
        {error && <Text dimColor>{"  (" + error + ")"}</Text>}
        <Text dimColor>{"  Press ESC to go back."}</Text>
      </Box>
    );
  }

  const items = ranked.map((r, i) => {
    const providerLabel =
      PROVIDERS[r.providerId]?.displayName ?? r.providerId;
    return {
      label: `${describeRanked(r)}  [${providerLabel}]`,
      value: String(i),
    };
  });

  return (
    <Box flexDirection="column">
      <Text bold>{"  Select research model"}</Text>
      <Text dimColor>
        {"  Ranked by intelligence (llmpricingapi.com). Default = top."}
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          limit={10}
          onSelect={(item) => {
            const idx = parseInt(item.value, 10);
            const r = ranked[idx];
            if (r) onPick(r.piModel);
          }}
        />
      </Box>
      <Text dimColor>{"  ESC to cancel."}</Text>
    </Box>
  );
}
