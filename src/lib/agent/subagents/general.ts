import { DynamicTool, StructuredToolInterface } from "@langchain/core/tools";
import { AgentBuilder } from "../builder";
import { postgresCheckpointer } from "../memory";
import {
  AgentConfigOptions,
  createChatModel,
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
} from "../util";
import { GENERAL_AGENT_PROMPT } from "../prompts/general";

/** Tool prefixes that belong to specialized agents and should be excluded from the general agent */
const SPECIALIZED_TOOL_PREFIXES = ["google-calendar", "google_calendar", "calendar"];

/**
 * Filters out tools reserved for specialized agents, leaving only general-purpose tools.
 */
export function filterGeneralTools(allTools: StructuredToolInterface[]): DynamicTool[] {
  return allTools.filter(
    (tool) =>
      !SPECIALIZED_TOOL_PREFIXES.some((prefix) => tool.name.toLowerCase().startsWith(prefix)),
  ) as DynamicTool[];
}

/**
 * Builds and returns the compiled General subagent graph.
 * Handles everything not covered by specialized agents.
 */
export function buildGeneralAgent(allTools: StructuredToolInterface[], cfg?: AgentConfigOptions) {
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  const generalTools = filterGeneralTools(allTools);

  return new AgentBuilder({
    llm,
    tools: generalTools,
    prompt: GENERAL_AGENT_PROMPT(),
    checkpointer: postgresCheckpointer,
    approveAllTools: true, // Subagents always auto-approve — interrupt flow breaks in nested graphs
  }).build();
}
