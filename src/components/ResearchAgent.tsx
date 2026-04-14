import { useMemo, useRef, useState } from "react";
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
import { ResearchRunning, type FeedItem } from "./ResearchRunning.js";

interface Props {
  onBack: () => void;
}

type Phase =
  | "prompt"
  | "clarifying"
  | "answering"
  | "finalizing"
  | "approve"
  | "running";

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
  const [initialFeed, setInitialFeed] = useState<FeedItem[]>([]);
  const [runFinished, setRunFinished] = useState(false);

  useInput((_, key) => {
    if (key.escape && (phase !== "running" || runFinished)) onBack();
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
        setInitialFeed([
          {
            id: crypto.randomUUID(),
            line: `Mission.md written to ./research/${folder.slug}/`,
            tone: "file",
          },
        ]);
        setPhase("running");
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

  // === PHASE: running ===
  if (phase === "running" && runDir && slug) {
    return (
      <ResearchRunning
        model={model}
        runDir={runDir}
        slug={slug}
        initialFeed={initialFeed}
        onDone={() => setRunFinished(true)}
      />
    );
  }

  return null;
}
