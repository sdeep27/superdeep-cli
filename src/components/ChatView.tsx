import { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { streamSimple } from "@mariozechner/pi-ai";
import type {
  Api,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  ThinkingLevel,
  Usage,
} from "@mariozechner/pi-ai";
import { PROVIDERS } from "../config.js";

interface ChatViewProps {
  model: Model<Api>;
  onBack: () => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  usage?: Usage;
}

const REASONING_LEVELS: (ThinkingLevel | "off")[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

function getSearchPayloadModifier(
  provider: string
): ((payload: unknown, model: Model<Api>) => unknown) | undefined {
  switch (provider) {
    case "anthropic":
      return (payload: unknown) => {
        const p = payload as Record<string, unknown>;
        const tools = (p.tools as unknown[]) || [];
        tools.push({ type: "web_search_20250305", name: "web_search" });
        p.tools = tools;
        return p;
      };
    case "openai":
      return (payload: unknown) => {
        const p = payload as Record<string, unknown>;
        const tools = (p.tools as unknown[]) || [];
        tools.push({ type: "web_search" });
        p.tools = tools;
        return p;
      };
    case "google":
      return (payload: unknown) => {
        const p = payload as Record<string, unknown>;
        const tools = (p.tools as unknown[]) || [];
        tools.push({ googleSearch: {} });
        p.tools = tools;
        return p;
      };
    default:
      return undefined;
  }
}

function formatUsage(usage: Usage): string {
  const parts = [`in=${usage.input}`, `out=${usage.output}`];
  if (usage.cacheRead > 0) parts.push(`cache=${usage.cacheRead}`);
  const cost =
    usage.cost.total > 0 ? ` | $${usage.cost.total.toFixed(4)}` : "";
  return `tokens: ${parts.join(" ")}${cost}`;
}

export function ChatView({ model, onBack }: ChatViewProps) {
  const providerName = PROVIDERS[model.provider]?.displayName ?? model.provider;
  const searchSupported =
    getSearchPayloadModifier(model.provider) !== undefined;

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contextMessages, setContextMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [reasoningLevel, setReasoningLevel] = useState<ThinkingLevel | "off">(
    model.reasoning ? "medium" : "off"
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Clear status messages after a delay
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  const sendMessage = useCallback(
    async (text: string) => {
      setMessages((prev) => [...prev, { role: "user", text }]);
      setStreaming(true);
      setStreamText("");
      setError(null);

      const userMsg: Message = {
        role: "user" as const,
        content: text,
        timestamp: Date.now(),
      };
      const newContextMessages = [...contextMessages, userMsg];
      setContextMessages(newContextMessages);

      const context: Context = { messages: newContextMessages };
      const options: SimpleStreamOptions = {};

      if (reasoningLevel !== "off") {
        options.reasoning = reasoningLevel;
      }
      if (searchEnabled) {
        const modifier = getSearchPayloadModifier(model.provider);
        if (modifier) {
          options.onPayload = modifier;
        }
      }

      try {
        const eventStream = streamSimple(model, context, options);
        let fullText = "";

        for await (const event of eventStream) {
          if (event.type === "text_delta") {
            fullText += event.delta;
            setStreamText(fullText);
          } else if (event.type === "done") {
            setContextMessages((prev) => [...prev, event.message]);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                text: fullText,
                usage: event.message.usage,
              },
            ]);
            setStreamText("");
          } else if (event.type === "error") {
            const errMsg =
              event.error.errorMessage ?? "Unknown error occurred";
            setError(errMsg);
            // Remove the user message from context
            setContextMessages((prev) => prev.slice(0, -1));
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setContextMessages((prev) => prev.slice(0, -1));
      }

      setStreaming(false);
    },
    [contextMessages, model, reasoningLevel, searchEnabled]
  );

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || streaming) return;

      // Handle commands
      if (trimmed === "/quit" || trimmed === "/exit") {
        onBack();
        return;
      }

      if (trimmed === "/clear") {
        setMessages([]);
        setContextMessages([]);
        setStatusMessage("Conversation cleared.");
        setInput("");
        return;
      }

      if (trimmed === "/search") {
        if (!searchSupported) {
          setStatusMessage(
            `Web search not available for ${providerName}.`
          );
        } else {
          setSearchEnabled((prev) => !prev);
          setStatusMessage(
            `Web search: ${!searchEnabled ? "ON" : "OFF"}`
          );
        }
        setInput("");
        return;
      }

      if (trimmed.startsWith("/reasoning")) {
        if (!model.reasoning) {
          setStatusMessage(`${model.name} does not support reasoning.`);
          setInput("");
          return;
        }
        const level = trimmed.split(/\s+/)[1] as
          | ThinkingLevel
          | "off"
          | undefined;
        if (!level || !REASONING_LEVELS.includes(level)) {
          setStatusMessage(
            `Usage: /reasoning <${REASONING_LEVELS.join("|")}>`
          );
          setInput("");
          return;
        }
        setReasoningLevel(level);
        setStatusMessage(`Reasoning: ${level}`);
        setInput("");
        return;
      }

      setInput("");
      sendMessage(trimmed);
    },
    [
      streaming,
      onBack,
      searchSupported,
      providerName,
      searchEnabled,
      model,
      sendMessage,
    ]
  );

  // Allow Escape to go back when not streaming
  useInput((_, key) => {
    if (key.escape && !streaming) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      {/* Chat header */}
      <Box>
        <Text bold>
          {"  "}
          {model.name}
        </Text>
        <Text dimColor> ({providerName})</Text>
        {model.reasoning && (
          <Text color="yellow"> reasoning:{reasoningLevel}</Text>
        )}
        {searchEnabled && <Text color="blue"> [search]</Text>}
      </Box>
      <Text dimColor>
        {"  /quit /clear /search"}
        {model.reasoning ? " /reasoning <level>" : ""}
        {"  ESC to go back"}
      </Text>

      {/* Message history */}
      <Box flexDirection="column" marginTop={1}>
        {messages.map((msg, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text bold color={msg.role === "user" ? "green" : "cyan"}>
              {"  "}
              {msg.role === "user" ? "You" : "Assistant"}:
            </Text>
            <Text>{"  "}{msg.text}</Text>
            {msg.usage && (
              <Text dimColor>{"  "}{formatUsage(msg.usage)}</Text>
            )}
          </Box>
        ))}

        {/* Streaming output */}
        {streaming && streamText && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="cyan">
              {"  Assistant:"}
            </Text>
            <Text>{"  "}{streamText}</Text>
          </Box>
        )}

        {streaming && !streamText && (
          <Text dimColor>{"  Thinking..."}</Text>
        )}

        {/* Error display */}
        {error && (
          <Text color="red">{"  Error: "}{error}</Text>
        )}

        {/* Status message */}
        {statusMessage && (
          <Text color="yellow">{"  "}{statusMessage}</Text>
        )}
      </Box>

      {/* Input */}
      {!streaming && (
        <Box marginTop={1}>
          <Text bold color="green">{"  You: "}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
          />
        </Box>
      )}
    </Box>
  );
}
