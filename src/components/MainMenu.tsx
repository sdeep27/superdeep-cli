import { Box, Text, useApp } from "ink";
import SelectInput from "ink-select-input";
import { getConfiguredProviders, PROVIDERS } from "../config.js";
import type { Screen } from "../app.js";

interface MainMenuProps {
  onNavigate: (screen: Screen) => void;
}

export function MainMenu({ onNavigate }: MainMenuProps) {
  const { exit } = useApp();

  const configured = getConfiguredProviders();
  const providerNames = configured
    .map((p) => PROVIDERS[p]?.displayName ?? p)
    .join(", ");

  const items = [
    { label: "Deep Research Agent", value: "research" as const },
    { label: "Chat", value: "chat" as const },
    { label: "Configure API keys", value: "config" as const },
    { label: "Exit", value: "exit" as const },
  ];

  const handleSelect = (item: { value: string }) => {
    switch (item.value) {
      case "chat":
        if (configured.length === 0) return;
        onNavigate("chat");
        break;
      case "config":
        onNavigate("config");
        break;
      case "research":
        if (!configured.includes("anthropic")) return;
        onNavigate("research");
        break;
      case "exit":
        exit();
        break;
    }
  };

  return (
    <Box flexDirection="column">
      {configured.length > 0 ? (
        <Text>
          {"  Active providers: "}
          <Text color="green">{providerNames}</Text>
        </Text>
      ) : (
        <Text dimColor>
          {"  No API keys configured. Set up a provider to get started."}
        </Text>
      )}
      <Box marginTop={1} flexDirection="column">
        <SelectInput items={items} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}
