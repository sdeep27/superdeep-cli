import { Type } from "@mariozechner/pi-ai";
import type { RegisteredTool } from "./types.js";

const SpawnParams = Type.Object({
  taskTitle: Type.String({
    description: "Short title for the subagent's task (used as folder/id hint).",
  }),
  taskPrompt: Type.String({
    description:
      "Full scoped instructions for the subagent. Include: the research question, what files to produce, what the parent already knows, and what a useful summary looks like.",
  }),
  scope: Type.Optional(
    Type.String({
      description:
        "Optional boundary — e.g. domains allowed, depth of exploration, expected output size.",
    }),
  ),
});

export const spawnSubagentTool: RegisteredTool<typeof SpawnParams> = {
  tool: {
    name: "spawn_subagent",
    description:
      "Delegate a focused sub-task to a subagent. The subagent runs its own loop, writes its own markdown files under subagents/<id>/, and returns a summary. Use this to parallelize research across independent threads or to go deep on a single subtopic.",
    parameters: SpawnParams,
  },
  handler: async (args, ctx) => {
    const { summary, subagentId, findingsPath } = await ctx.spawnSubagent(
      {
        taskTitle: args.taskTitle,
        taskPrompt: args.taskPrompt,
        scope: args.scope,
      },
      ctx,
    );
    return {
      content: `Subagent ${subagentId} finished.\n\nFindings at: ${findingsPath}\n\nSummary:\n${summary}`,
      details: { subagentId, findingsPath },
    };
  },
};
