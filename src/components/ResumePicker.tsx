import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getConfiguredProviders } from "../config.js";
import {
  annotateInterruptedSubagents,
  listRunFolders,
  rehydrateRun,
  type RunFolderSummary,
} from "../research/resume.js";
import { ResearchRunning, type FeedItem } from "./ResearchRunning.js";
import { ResearchModelPicker } from "./ResearchModelPicker.js";

interface Props {
  onBack: () => void;
}

interface SelectedRun {
  slug: string;
  absDir: string;
  initialFeed: FeedItem[];
  resume: Parameters<typeof ResearchRunning>[0]["resume"];
}

export function ResumePicker({ onBack }: Props) {
  const hasAnyKey = getConfiguredProviders().length > 0;

  const runs = useMemo(() => listRunFolders(), []);
  const interrupted = useMemo(
    () => runs.filter((r) => r.status.status === "interrupted"),
    [runs],
  );

  const [selected, setSelected] = useState<SelectedRun | null>(null);
  const [model, setModel] = useState<Model<Api> | null>(null);
  const [runFinished, setRunFinished] = useState(false);

  useInput((_, key) => {
    if (key.escape && (!selected || runFinished)) onBack();
  });

  if (!hasAnyKey) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          {"  No API keys configured. Set one in API Key config first."}
        </Text>
        <Text dimColor>{"  Press ESC to go back."}</Text>
      </Box>
    );
  }

  if (selected && !model) {
    return (
      <ResearchModelPicker
        onBack={() => setSelected(null)}
        onPick={setModel}
      />
    );
  }

  if (selected && model) {
    return (
      <ResearchRunning
        model={model}
        runDir={selected.absDir}
        slug={selected.slug}
        resume={selected.resume}
        initialFeed={selected.initialFeed}
        onDone={() => setRunFinished(true)}
      />
    );
  }

  if (interrupted.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>{"  Resume research run"}</Text>
        <Text dimColor>{"  No interrupted runs found in ./research/."}</Text>
        <Text dimColor>{"  Press ESC to go back."}</Text>
      </Box>
    );
  }

  const items = interrupted.map((r) => ({
    label: formatRow(r),
    value: r.slug,
  }));

  const onSelect = (item: { value: string }) => {
    const r = interrupted.find((x) => x.slug === item.value);
    if (!r) return;
    const rehydrated = rehydrateRun(r.absDir);
    annotateInterruptedSubagents(r.absDir, rehydrated.interruptedSubagentIds);
    const initialFeed: FeedItem[] = [
      {
        id: crypto.randomUUID(),
        line: `Resuming ${r.slug} — ${rehydrated.loopsUsed} prior steps, ${rehydrated.tokens.input} input tokens, ${rehydrated.sources.length} sources.`,
        tone: "info",
      },
    ];
    if (rehydrated.interruptedSubagentIds.length > 0) {
      initialFeed.push({
        id: crypto.randomUUID(),
        line: `Annotated ${rehydrated.interruptedSubagentIds.length} interrupted subagent task.md file(s).`,
        tone: "warn",
      });
    }
    setSelected({
      slug: r.slug,
      absDir: r.absDir,
      initialFeed,
      resume: {
        loopsUsed: rehydrated.loopsUsed,
        tokens: rehydrated.tokens,
        sources: rehydrated.sources,
        interruptedSubagentIds: rehydrated.interruptedSubagentIds,
        lastEventAt: rehydrated.lastEventAt,
      },
    });
  };

  return (
    <Box flexDirection="column">
      <Text bold>{"  Resume research run"}</Text>
      <Text dimColor>
        {"  " + interrupted.length + " interrupted run(s). ESC to go back."}
      </Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={onSelect} />
      </Box>
    </Box>
  );
}

function formatRow(r: RunFolderSummary): string {
  const ago = relativeTime(r.lastEventAt);
  return `${r.slug} · ${r.steps} steps · ${ago} · ${r.title}`;
}

function relativeTime(at: number): string {
  const diffMs = Date.now() - at;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
