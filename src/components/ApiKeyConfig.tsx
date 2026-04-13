import { useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import {
  PROVIDERS,
  getApiKey,
  setApiKey,
  removeApiKey,
  loadKeysIntoEnv,
} from "../config.js";

type Phase = "list" | "configure" | "input" | "confirm-remove";

interface ApiKeyConfigProps {
  onBack: () => void;
}

export function ApiKeyConfig({ onBack }: ApiKeyConfigProps) {
  const [phase, setPhase] = useState<Phase>("list");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const providerEntries = Object.entries(PROVIDERS);

  // Escape to go back from list
  useInput((_, key) => {
    if (key.escape) {
      if (phase === "list") onBack();
      else setPhase("list");
    }
  });

  if (phase === "list") {
    const items = [
      ...providerEntries.map(([id, info]) => {
        const key = getApiKey(id);
        const status = key ? " [configured]" : "";
        return {
          label: `${info.displayName}${status}`,
          value: id,
        };
      }),
      { label: "Back", value: "__back__" },
    ];

    return (
      <Box flexDirection="column">
        <Text bold>{"  API Key Configuration"}</Text>
        {statusMessage && (
          <Text color="green">{"  "}{statusMessage}</Text>
        )}
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === "__back__") {
                onBack();
                return;
              }
              setSelectedProvider(item.value);
              setStatusMessage(null);
              const existing = getApiKey(item.value);
              if (existing) {
                setPhase("configure");
              } else {
                setPhase("input");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "configure" && selectedProvider) {
    const info = PROVIDERS[selectedProvider];
    const existing = getApiKey(selectedProvider);
    const masked = existing
      ? existing.slice(0, 8) + "..." + existing.slice(-4)
      : "";

    const items = [
      { label: "Update key", value: "update" },
      { label: "Remove key", value: "remove" },
      { label: "Back", value: "back" },
    ];

    return (
      <Box flexDirection="column">
        <Text bold>{"  "}{info?.displayName ?? selectedProvider}</Text>
        <Text dimColor>{"  Current key: "}{masked}</Text>
        <Text dimColor>{"  Env var: "}{info?.envVar}</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              switch (item.value) {
                case "update":
                  setKeyInput("");
                  setPhase("input");
                  break;
                case "remove":
                  setPhase("confirm-remove");
                  break;
                case "back":
                  setPhase("list");
                  break;
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "confirm-remove" && selectedProvider) {
    const info = PROVIDERS[selectedProvider];
    const items = [
      { label: "Yes, remove", value: "yes" },
      { label: "Cancel", value: "no" },
    ];

    return (
      <Box flexDirection="column">
        <Text color="yellow">
          {"  Remove API key for "}
          {info?.displayName ?? selectedProvider}?
        </Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === "yes") {
                removeApiKey(selectedProvider);
                loadKeysIntoEnv();
                setStatusMessage(
                  `${info?.displayName} key removed.`
                );
              }
              setPhase("list");
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "input" && selectedProvider) {
    const info = PROVIDERS[selectedProvider];

    return (
      <Box flexDirection="column">
        <Text bold>
          {"  Enter API key for "}
          {info?.displayName ?? selectedProvider}:
        </Text>
        <Box marginTop={1}>
          <Text>{"  > "}</Text>
          <TextInput
            value={keyInput}
            onChange={setKeyInput}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (trimmed) {
                setApiKey(selectedProvider, trimmed);
                loadKeysIntoEnv();
                setStatusMessage(
                  `${info?.displayName} key saved.`
                );
              }
              setKeyInput("");
              setPhase("list");
            }}
          />
        </Box>
        <Text dimColor>{"  Press Enter to save, or submit empty to cancel."}</Text>
      </Box>
    );
  }

  return null;
}
