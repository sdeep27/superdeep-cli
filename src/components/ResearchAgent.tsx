import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { getModel } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getApiKey } from "../config.js";
import {
  MissionClarifier,
  renderMissionMarkdown,
  writeMissionFile,
  type ClarificationQuestionT,
  type MissionFields,
} from "../research/mission.js";
import { createRunFolder } from "../research/run.js";
import { startCoordinator } from "../research/plan.js";
import type { AgentEvent } from "../research/events.js";

interface Props {
  onBack: () => void;
}

type Phase =
  | "prompt"
  | "clarifying"
  | "answering"
  | "finalizing"
  | "approve"
  | "running"
  | "done";

interface FeedItem {
  id: number;
  line: string;
  tone?: "info" | "tool" | "file" | "sub" | "warn" | "error";
}

export function ResearchAgent({ onBack }: Props) {
  const apiKey = getApiKey("anthropic");
  const model = useMemo<Model<Api> | null>(() => {
    if (!apiKey) return null;
    return getModel("anthropic", "claude-sonnet-4-6") as Model<Api>;
  }, [apiKey]);

  const [phase, setPhase] = useState<Phase>("prompt");
  const [topic, setTopic] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const clarifierRef = useRef<MissionClarifier | null>(null);
  const [questions, setQuestions] = useState<ClarificationQuestionT[]>([]);
  const [answerIdx, setAnswerIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [mission, setMission] = useState<MissionFields | null>(null);
  const [runDir, setRunDir] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedCounter = useRef(0);
  const pushFeed = (line: string, tone: FeedItem["tone"] = "info") => {
    feedCounter.current += 1;
    setFeed((f) => {
      const next = [...f, { id: feedCounter.current, line, tone }];
      return next.length > 200 ? next.slice(-200) : next;
    });
  };

  useInput((_, key) => {
    if (key.escape && phase !== "running") onBack();
  });

  if (!apiKey || !model) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          {"  Anthropic API key not configured. Set one in API Key config first."}
        </Text>
        <Text dimColor>{"  Press ESC to go back."}</Text>
      </Box>
    );
  }

  // === PHASE: prompt ===
  if (phase === "prompt") {
    const onSubmit = async (value: string) => {
      const text = value.trim();
      if (!text) return;
      setTopic(text);
      setError(null);
      setInput("");
      clarifierRef.current = new MissionClarifier(model, text);
      setPhase("clarifying");
      try {
        const result = await clarifierRef.current.nextTurn();
        if (result.kind === "questions") {
          setQuestions(result.questions);
          setAnswerIdx(0);
          setAnswers({});
          setPhase("answering");
        } else {
          setMission(result.mission);
          setPhase("approve");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("prompt");
      }
    };
    return (
      <Box flexDirection="column">
        <Text bold>{"  Deep Research Agent"}</Text>
        <Text dimColor>{"  Describe what you'd like researched. ESC to go back."}</Text>
        <Box marginTop={1}>
          <Text color="green">{"  > "}</Text>
          <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
        </Box>
        {error && <Text color="red">{"  "}{error}</Text>}
      </Box>
    );
  }

  // === PHASE: clarifying (calling LLM) ===
  if (phase === "clarifying" || phase === "finalizing") {
    return (
      <Box flexDirection="column">
        <Text>
          {"  "}
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          {phase === "clarifying"
            ? "  Drafting clarifying questions…"
            : "  Finalizing Mission.md…"}
        </Text>
      </Box>
    );
  }

  // === PHASE: answering ===
  if (phase === "answering") {
    const q = questions[answerIdx];
    if (!q) return null;
    const onSubmit = async (value: string) => {
      const newAnswers = { ...answers, [q.id]: value };
      setAnswers(newAnswers);
      setInput("");
      if (answerIdx + 1 < questions.length) {
        setAnswerIdx(answerIdx + 1);
        return;
      }
      // Submit all answers, ask clarifier for finalize.
      const clar = clarifierRef.current!;
      clar.submitAnswers(questions, newAnswers);
      setPhase("finalizing");
      try {
        const result = await clar.nextTurn();
        if (result.kind === "mission") {
          setMission(result.mission);
          setPhase("approve");
        } else {
          // Clarifier asked again — handle another round
          setQuestions(result.questions);
          setAnswerIdx(0);
          setAnswers({});
          setPhase("answering");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("prompt");
      }
    };
    return (
      <Box flexDirection="column">
        <Text bold>
          {"  Clarification "}
          {answerIdx + 1}
          {"/"}
          {questions.length}
        </Text>
        <Text>{"  "}{q.question}</Text>
        {q.rationale && <Text dimColor>{"  (" + q.rationale + ")"}</Text>}
        <Box marginTop={1}>
          <Text color="green">{"  > "}</Text>
          <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
        </Box>
        <Text dimColor>{"  Submit empty to skip this question."}</Text>
      </Box>
    );
  }

  // === PHASE: approve mission ===
  if (phase === "approve" && mission) {
    const preview = renderMissionMarkdown(mission);
    const items = [
      { label: "Approve & start research", value: "approve" },
      { label: "Revise with extra input", value: "revise" },
      { label: "Cancel", value: "cancel" },
    ];
    const onSelect = async (item: { value: string }) => {
      if (item.value === "cancel") {
        onBack();
        return;
      }
      if (item.value === "revise") {
        setPhase("answering");
        // Re-ask with one manual question
        setQuestions([
          {
            id: "revision",
            question: "What should change in the mission? (free text)",
          },
        ]);
        setAnswerIdx(0);
        setAnswers({});
        return;
      }
      // Approve
      try {
        const folder = createRunFolder(mission.slug || topic);
        setSlug(folder.slug);
        setRunDir(folder.absDir);
        writeMissionFile(folder.absDir, mission);
        pushFeed(`Mission.md written to ./research/${folder.slug}/`, "file");
        setPhase("running");
        runCoordinator(folder.absDir, folder.slug);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    return (
      <Box flexDirection="column">
        <Text bold color="cyan">{"  Mission.md preview"}</Text>
        <Text dimColor>{"  --------------------"}</Text>
        <Box flexDirection="column" marginY={1}>
          {preview
            .split("\n")
            .slice(0, 40)
            .map((line, i) => (
              <Text key={i}>{"  "}{line}</Text>
            ))}
        </Box>
        <Text dimColor>{"  Slug: " + (mission.slug || "(auto)")}</Text>
        <Box marginTop={1}>
          <SelectInput items={items} onSelect={onSelect} />
        </Box>
      </Box>
    );
  }

  async function runCoordinator(absDir: string, runSlug: string) {
    const handle = startCoordinator({ model: model!, runDir: absDir, slug: runSlug });
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
    }
  }

  // === PHASE: running / done ===
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {"  "}
        {phase === "running" ? "Researching…" : "Done."}
      </Text>
      {slug && <Text dimColor>{"  ./research/" + slug + "/"}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {feed.slice(-40).map((item) => (
          <Text key={item.id} color={toneColor(item.tone)}>
            {"  "}
            {item.line}
          </Text>
        ))}
      </Box>
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
  );
}

function toneColor(tone: FeedItem["tone"]): string | undefined {
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

function renderEvent(
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
      // Pretty-print child events with a prefix
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
      // text_delta, thinking_delta — too noisy for the feed; they live in run.log.
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
