import { useState } from "react";
import { Box } from "ink";
import { Header } from "./components/Header.js";
import { MainMenu } from "./components/MainMenu.js";
import { Chat } from "./components/Chat.js";
import { ApiKeyConfig } from "./components/ApiKeyConfig.js";
import { ResearchAgent } from "./components/ResearchAgent.js";

export type Screen = "menu" | "chat" | "config" | "research";

export function App() {
  const [screen, setScreen] = useState<Screen>("menu");

  return (
    <Box flexDirection="column">
      <Header />
      {screen === "menu" && <MainMenu onNavigate={setScreen} />}
      {screen === "chat" && <Chat onBack={() => setScreen("menu")} />}
      {screen === "config" && (
        <ApiKeyConfig onBack={() => setScreen("menu")} />
      )}
      {screen === "research" && (
        <ResearchAgent onBack={() => setScreen("menu")} />
      )}
    </Box>
  );
}
