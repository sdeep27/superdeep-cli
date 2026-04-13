import fs from "node:fs";
import path from "node:path";
import {
  completeSimple,
  Type,
  type Api,
  type Context,
  type Model,
  type Tool,
  type ToolCall,
} from "@mariozechner/pi-ai";
import { clarifierSystemPrompt } from "./prompts/clarifier.js";

const ClarificationQuestion = Type.Object({
  id: Type.String({ description: "Short slug, e.g. 'audience' or 'timeframe'." }),
  question: Type.String({ description: "The question to pose to the user." }),
  rationale: Type.Optional(
    Type.String({ description: "Why answering this materially changes the research." }),
  ),
});

const ProposeClarificationsParams = Type.Object({
  questions: Type.Array(ClarificationQuestion, { minItems: 1, maxItems: 5 }),
});

const FinalizeMissionParams = Type.Object({
  slug: Type.String({
    description:
      "Kebab-case slug (max ~40 chars) for the research folder. Derive from the core topic.",
  }),
  mission: Type.String({ description: "One-paragraph sharpened mission statement." }),
  keyQuestions: Type.Array(Type.String(), {
    description: "The questions the research must answer, as bullet-ready strings.",
  }),
  scope: Type.String({ description: "In-scope vs out-of-scope, one short paragraph." }),
  assumptions: Type.Array(Type.String(), {
    description: "Any assumptions you had to make without user confirmation.",
  }),
  deliverables: Type.String({
    description:
      "Short description of what the knowledge-base folder should contain by the end.",
  }),
});

const clarifierTools: Tool[] = [
  {
    name: "propose_clarifications",
    description:
      "Propose 2–5 focused clarifying questions to the user. Use on the first turn unless the prompt is already precise enough to skip straight to finalize_mission.",
    parameters: ProposeClarificationsParams,
  },
  {
    name: "finalize_mission",
    description:
      "Emit the final Mission.md contents as structured fields. Use on the second turn after the user has answered your clarifications, OR on the first turn if no clarification is needed.",
    parameters: FinalizeMissionParams,
  },
];

export interface ClarificationQuestionT {
  id: string;
  question: string;
  rationale?: string;
}

export type ClarifierTurnResult =
  | { kind: "questions"; questions: ClarificationQuestionT[] }
  | { kind: "mission"; mission: MissionFields };

export interface MissionFields {
  slug: string;
  mission: string;
  keyQuestions: string[];
  scope: string;
  assumptions: string[];
  deliverables: string;
}

export class MissionClarifier {
  private readonly context: Context;

  constructor(
    private readonly model: Model<Api>,
    initialUserPrompt: string,
  ) {
    this.context = {
      systemPrompt: clarifierSystemPrompt,
      tools: clarifierTools,
      messages: [
        {
          role: "user",
          content: initialUserPrompt,
          timestamp: Date.now(),
        },
      ],
    };
  }

  async nextTurn(): Promise<ClarifierTurnResult> {
    const message = await completeSimple(this.model, this.context, {});
    this.context.messages.push(message);
    const toolCall = this.extractToolCall(message.content);

    if (!toolCall) {
      throw new Error(
        "Clarifier did not call a tool. It returned plain text: " +
          JSON.stringify(message.content).slice(0, 200),
      );
    }

    if (toolCall.name === "propose_clarifications") {
      const args = toolCall.arguments as { questions: ClarificationQuestionT[] };
      return { kind: "questions", questions: args.questions };
    }

    if (toolCall.name === "finalize_mission") {
      return {
        kind: "mission",
        mission: toolCall.arguments as MissionFields,
      };
    }

    throw new Error(`Unexpected tool: ${toolCall.name}`);
  }

  submitAnswers(
    questions: ClarificationQuestionT[],
    answers: Record<string, string>,
  ): void {
    // Respond to the clarifier's most recent tool call with a toolResult.
    const last = this.context.messages[this.context.messages.length - 1];
    if (!last || last.role !== "assistant") {
      throw new Error("no pending clarifier turn to answer");
    }
    const call = this.extractToolCall(last.content);
    if (!call || call.name !== "propose_clarifications") {
      throw new Error("last turn did not propose clarifications");
    }

    const summary = questions
      .map((q) => `- **${q.question}**\n  ${answers[q.id]?.trim() || "(skipped)"}`)
      .join("\n");

    this.context.messages.push({
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [
        {
          type: "text",
          text:
            "User answers:\n" +
            summary +
            "\n\nNow call `finalize_mission` with the consolidated mission.",
        },
      ],
      isError: false,
      timestamp: Date.now(),
    });
  }

  private extractToolCall(content: unknown): ToolCall | undefined {
    if (!Array.isArray(content)) return undefined;
    return content.find(
      (c): c is ToolCall =>
        typeof c === "object" && c !== null && (c as { type?: string }).type === "toolCall",
    );
  }
}

export function renderMissionMarkdown(m: MissionFields): string {
  return [
    "# Mission",
    "",
    "## Mission",
    "",
    m.mission.trim(),
    "",
    "## Key Questions",
    "",
    ...m.keyQuestions.map((q) => `- ${q}`),
    "",
    "## Scope & Boundaries",
    "",
    m.scope.trim(),
    "",
    "## Assumptions",
    "",
    ...(m.assumptions.length ? m.assumptions.map((a) => `- ${a}`) : ["- (none)"]),
    "",
    "## Deliverables Expected",
    "",
    m.deliverables.trim(),
    "",
  ].join("\n");
}

export function writeMissionFile(runDir: string, mission: MissionFields): string {
  const abs = path.join(runDir, "Mission.md");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, renderMissionMarkdown(mission), "utf-8");
  return abs;
}
