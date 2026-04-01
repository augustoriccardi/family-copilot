import { DynamicTool, StructuredToolInterface } from "@langchain/core/tools";
import { AgentBuilder } from "../builder";
import { postgresCheckpointer } from "../memory";
import {
  AgentConfigOptions,
  createChatModel,
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
} from "../util";
import { CALENDAR_AGENT_PROMPT } from "../prompts/calendar";

/** MCP server name prefixes that belong to the calendar domain */
const CALENDAR_TOOL_PREFIXES = ["google-calendar", "google_calendar", "calendar"];

/**
 * Filters tools to only those relevant to the calendar domain.
 */
export function filterCalendarTools(allTools: StructuredToolInterface[]): DynamicTool[] {
  return allTools.filter((tool) =>
    CALENDAR_TOOL_PREFIXES.some((prefix) => tool.name.toLowerCase().startsWith(prefix)),
  ) as DynamicTool[];
}

/**
 * Builds and returns the compiled Calendar subagent graph.
 * Used as a node inside the supervisor graph.
 */
export function buildCalendarAgent(allTools: StructuredToolInterface[], cfg?: AgentConfigOptions) {
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  const calendarTools = filterCalendarTools(allTools);

  return new AgentBuilder({
    llm,
    tools: calendarTools,
    prompt: CALENDAR_AGENT_PROMPT(),
    checkpointer: postgresCheckpointer,
    approveAllTools: cfg?.approveAllTools ?? false,
  }).build();
}
