import { useEffect, useRef, useState } from "react";
import { Box, Static, Text } from "ink";
import Spinner from "ink-spinner";
import type { Api, Model } from "@mariozechner/pi-ai";
import { startCoordinator, type ResumeOpts } from "../research/plan.js";
import type { AgentEvent } from "../research/events.js";

export interface FeedItem {
  id: string;
  line: string;
  tone?: "info" | "tool" | "file" | "sub" | "warn" | "error";
}

export interface ResearchRunningProps {
  model: Model<Api>;
  runDir: string;
  slug: string;
  resume?: ResumeOpts;
  initialFeed?: FeedItem[];
  onDone?: () => void;
}

export function ResearchRunning({
  model,
  runDir,
  slug,
  resume,
  initialFeed,
  onDone,
}: ResearchRunningProps) {
  const [feed, setFeed] = useState<FeedItem[]>(initialFeed ?? []);
  const [phase, setPhase] = useState<"running" | "done">("running");
  const startedRef = useRef(false);

  const pushFeed = (line: string, tone: FeedItem["tone"] = "info") => {
    const id = crypto.randomUUID();
    setFeed((f) => [...f, { id, line, tone }]);
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const handle = startCoordinator({ model, runDir, slug, resume });
      try {
        for await (const evt of handle.events) {
          renderEvent(evt, pushFeed);
        }
      } catch (err) {
        pushFeed(
          "error: " + (err instanceof Error ? err.message : String(err)),
          "error",
        );
      } finally {
        try {
          await handle.shutdown();
        } catch (err) {
          pushFeed(
            "trace shutdown error: " + (err instanceof Error ? err.message : String(err)),
            "warn",
          );
        }
        setPhase("done");
        onDone?.();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Static items={feed}>
        {(item) => (
          <Text key={item.id} color={toneColor(item.tone)}>
            {"  "}
            {item.line}
          </Text>
        )}
      </Static>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyan">
          {"  "}
          {phase === "running" ? "Researching…" : "Done."}
        </Text>
        <Text dimColor>{"  ./research/" + slug + "/"}</Text>
        {phase === "running" && (
          <Text>
            {"  "}
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            {"  working…"}
          </Text>
        )}
        {phase === "done" && (
          <Text dimColor>{"  Press ESC to return to the menu."}</Text>
        )}
      </Box>
    </>
  );
}

export function toneColor(tone: FeedItem["tone"]): string | undefined {
  switch (tone) {
    case "tool":
      return "blue";
    case "file":
      return "green";
    case "sub":
      return "magenta";
    case "warn":
      return "yellow";
    case "error":
      return "red";
    default:
      return undefined;
  }
}

export function renderEvent(
  evt: AgentEvent,
  push: (line: string, tone?: FeedItem["tone"]) => void,
): void {
  switch (evt.type) {
    case "step_start":
      push(`» step ${evt.step} (${evt.role})`, "info");
      break;
    case "tool_call_start":
      push(`  ↳ ${evt.call.name}(${summarizeArgs(evt.call.arguments)})`, "tool");
      break;
    case "tool_call_result":
      push(
        `  ✓ ${evt.toolName}${evt.isError ? " [error]" : ""} — ${evt.summary}`,
        evt.isError ? "error" : "tool",
      );
      break;
    case "file_written":
      push(`  + ${evt.path} (${evt.bytes}b)`, "file");
      break;
    case "source_cited":
      push(`  · source ${evt.source.url}`, "info");
      break;
    case "subagent_spawn":
      push(`★ subagent spawn: ${evt.title} (${evt.subagentId})`, "sub");
      break;
    case "subagent_event":
      renderEvent(evt.event, (line, tone) => push("  │ " + line, tone ?? "sub"));
      break;
    case "subagent_done":
      push(`★ subagent done: ${evt.subagentId}`, "sub");
      break;
    case "budget_warn":
      push(`⚠ budget hit: ${evt.reason}`, "warn");
      break;
    case "error":
      push(`error: ${evt.message}`, "error");
      break;
    case "assistant_message_done":
      push(
        `  · assistant (in=${evt.usage.input} out=${evt.usage.output} $${evt.usage.cost.total.toFixed(4)})`,
      );
      break;
    case "done":
      push(`— done (${evt.reason})`, "info");
      break;
    default:
      break;
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).slice(0, 2);
  return entries
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${s.length > 40 ? s.slice(0, 37) + "…" : s}`;
    })
    .join(", ");
}
