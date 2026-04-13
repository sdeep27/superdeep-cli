import { useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { getModels } from "@mariozechner/pi-ai";
import type { Api, KnownProvider, Model } from "@mariozechner/pi-ai";
import { getConfiguredProviders, PROVIDERS } from "../config.js";
import { ChatView } from "./ChatView.js";

type ChatPhase = "provider" | "model" | "chatting";

interface ChatProps {
  onBack: () => void;
}

function getValidProviders(): string[] {
  const configured = getConfiguredProviders();
  const valid: string[] = [];
  for (const id of configured) {
    try {
      const models = getModels(id as KnownProvider);
      if (models.length > 0) valid.push(id);
    } catch {
      // Not a recognized pi-ai provider
    }
  }
  return valid;
}

export function Chat({ onBack }: ChatProps) {
  const [phase, setPhase] = useState<ChatPhase>("provider");
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<Model<Api> | null>(null);

  useInput((_, key) => {
    if (key.escape) {
      if (phase === "provider") onBack();
      else if (phase === "model") setPhase("provider");
    }
  });

  const validProviders = getValidProviders();

  if (validProviders.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          {"  No configured providers support chat."}
        </Text>
        <Text dimColor>
          {"  Supported: Anthropic, OpenAI, Google, Mistral, Groq"}
        </Text>
      </Box>
    );
  }

  if (phase === "provider") {
    const items = [
      ...validProviders.map((id) => ({
        label: PROVIDERS[id]?.displayName ?? id,
        value: id,
      })),
      { label: "Back", value: "__back__" },
    ];

    return (
      <Box flexDirection="column">
        <Text bold>{"  Select a provider:"}</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === "__back__") {
                onBack();
                return;
              }
              setProvider(item.value);
              setPhase("model");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "model" && provider) {
    const models = getModels(provider as KnownProvider) as Model<Api>[];

    const items = [
      ...models.map((m, i) => {
        const ctx = m.contextWindow
          ? ` (${(m.contextWindow / 1000).toFixed(0)}k ctx)`
          : "";
        const reasoning = m.reasoning ? " [reasoning]" : "";
        return {
          label: `${m.name}${ctx}${reasoning}`,
          value: String(i),
        };
      }),
      { label: "Back", value: "__back__" },
    ];

    return (
      <Box flexDirection="column">
        <Text bold>
          {"  Select a model"}
          <Text dimColor>
            {" "}
            ({PROVIDERS[provider]?.displayName ?? provider}):
          </Text>
        </Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === "__back__") {
                setPhase("provider");
                return;
              }
              setModel(models[parseInt(item.value, 10)]);
              setPhase("chatting");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "chatting" && model) {
    return (
      <ChatView
        model={model}
        onBack={() => {
          setModel(null);
          setPhase("model");
        }}
      />
    );
  }

  return null;
}
