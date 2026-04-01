import { StateGraph, MessagesAnnotation, END, START, Command } from "@langchain/langgraph";
import { DynamicStructuredTool, StructuredToolInterface } from "@langchain/core/tools";
import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import { postgresCheckpointer } from "./memory";
import {
  AgentConfigOptions,
  createChatModel,
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
} from "./util";
import { SUPERVISOR_PROMPT } from "./prompts/supervisor";
import { buildCalendarAgent } from "./subagents/calendar";
import { buildGeneralAgent } from "./subagents/general";
import { buildFamilyAgent } from "./subagents/family";
import { buildReminderAgent } from "./subagents/reminder";
import { buildRecipeAgent } from "./subagents/recipe";
import { buildShoppingAgent } from "./subagents/shopping";

/** The names of all subagents the supervisor can route to */
const SUBAGENT_NAMES = ["calendar", "general", "family", "reminder", "recipe", "shopping"] as const;
type SubagentName = (typeof SUBAGENT_NAMES)[number];

/**
 * Builds the "transfer" tools the supervisor LLM calls to route to a subagent.
 * Each tool is: transfer_to_<agent>(reason: string) → Command({ goto: agent })
 */
function buildTransferTools(): DynamicStructuredTool[] {
  return SUBAGENT_NAMES.map(
    (name) =>
      new DynamicStructuredTool({
        name: `transfer_to_${name}`,
        description: `Transfer the conversation to the ${name} specialist agent. Use this when the user's request is best handled by the ${name} specialist.`,
        schema: z.object({
          reason: z.string().describe("Brief explanation of why you are routing to this agent"),
        }),
        func: async () => new Command({ goto: name }) as unknown as string,
      }),
  );
}

/**
 * Builds and compiles the full supervisor StateGraph.
 *
 * Graph structure:
 *   START → supervisor → [calendar | general | family | reminder | recipe | shopping] → supervisor → ... → END
 *
 * The supervisor LLM uses transfer tools to route.
 * Each subagent is a compiled LangGraph node (with its own tool_approval + tools).
 */
export async function buildSupervisorGraph(
  allTools: StructuredToolInterface[],
  cfg?: AgentConfigOptions,
  householdId?: string,
) {
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  const transferTools = buildTransferTools();
  if (!llm.bindTools) {
    throw new Error(
      "LLM does not support tool binding — use a model that supports function calling (gpt-4o, gemini-2.0-flash, etc.)",
    );
  }
  const supervisorLLM = llm.bindTools(transferTools);

  // ── Supervisor node ───────────────────────────────────────────────────────
  async function supervisorNode(state: typeof MessagesAnnotation.State) {
    const stateMessages = state.messages;
    const lastMsg = stateMessages[stateMessages.length - 1];

    // Only skip the LLM when we're mid-routing cycle (returning from a subagent).
    // A new user turn always ends with a HumanMessage — never skip in that case.
    const isNewUserTurn = lastMsg?._getType() === "human";
    if (!isNewUserTurn) {
      // If a subagent already responded since the last delegation ack, skip the LLM
      // to avoid the supervisor re-summarizing what the subagent already said.
      const lastDelegatedIdx = [...stateMessages]
        .reverse()
        .findIndex(
          (m) =>
            m._getType() === "tool" &&
            typeof m.content === "string" &&
            (m.content as string).startsWith("Delegated to"),
        );
      if (lastDelegatedIdx !== -1) {
        const absoluteIdx = stateMessages.length - 1 - lastDelegatedIdx;
        const hasSubagentReply = stateMessages
          .slice(absoluteIdx + 1)
          .some((m) => m._getType() === "ai");
        if (hasSubagentReply) {
          // Subagent already answered — return without adding another message
          return { messages: [] };
        }
      }
    }

    const messages = [new SystemMessage(SUPERVISOR_PROMPT()), ...stateMessages];
    const response = await supervisorLLM.invoke(messages);

    // When the supervisor makes a transfer_to_<agent> tool call, we must immediately
    // inject the corresponding ToolMessage so the LLM history stays valid.
    // OpenAI/Gemini require every AIMessage(tool_calls) to be followed by a
    // ToolMessage for each tool_call_id — with nothing else in between.
    if (
      "tool_calls" in response &&
      Array.isArray(response.tool_calls) &&
      response.tool_calls.length > 0
    ) {
      const tc = response.tool_calls[0];
      if (tc.name?.startsWith("transfer_to_") && tc.id) {
        const ack = new ToolMessage({
          content: `Delegated to ${tc.name.replace("transfer_to_", "")} agent.`,
          tool_call_id: tc.id,
        });
        return { messages: [response, ack] };
      }
    }

    return { messages: [response] };
  }

  // ── Router: decides where to go after supervisor responds ─────────────────
  function routeAfterSupervisor(state: typeof MessagesAnnotation.State) {
    const messages = state.messages;
    const lastMsg = messages[messages.length - 1];

    // Route to a subagent ONLY when the last message is the delegation ack ToolMessage
    // we injected in supervisorNode. This prevents re-routing after a subagent already replied.
    if (
      lastMsg?._getType() === "tool" &&
      typeof lastMsg.content === "string" &&
      lastMsg.content.startsWith("Delegated to ")
    ) {
      const prevMsg = messages[messages.length - 2];
      if (
        prevMsg instanceof AIMessage &&
        Array.isArray(prevMsg.tool_calls) &&
        prevMsg.tool_calls.length > 0
      ) {
        const subagentName = prevMsg.tool_calls[0].name.replace("transfer_to_", "") as SubagentName;
        if ((SUBAGENT_NAMES as readonly string[]).includes(subagentName)) {
          return subagentName;
        }
      }
    }

    // Any other case (subagent just replied, supervisor answered directly, skip) → END
    return END;
  }

  // Build subagent compiled graphs (async ones await resolveHouseholdId internally)
  const [familyGraph, reminderGraph, recipeGraph, shoppingGraph] = await Promise.all([
    buildFamilyAgent(householdId, cfg),
    buildReminderAgent(householdId, cfg),
    buildRecipeAgent(householdId, cfg),
    buildShoppingAgent(householdId, cfg),
  ]);
  const calendarGraph = buildCalendarAgent(allTools, cfg);
  const generalGraph = buildGeneralAgent(allTools, cfg);

  // ── Assemble the supervisor StateGraph ───────────────────────────────────
  const graph = new StateGraph(MessagesAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("calendar", calendarGraph)
    .addNode("general", generalGraph)
    .addNode("family", familyGraph)
    .addNode("reminder", reminderGraph)
    .addNode("recipe", recipeGraph)
    .addNode("shopping", shoppingGraph)
    .addEdge(START, "supervisor")
    .addConditionalEdges("supervisor", routeAfterSupervisor, {
      calendar: "calendar",
      general: "general",
      family: "family",
      reminder: "reminder",
      recipe: "recipe",
      shopping: "shopping",
      [END]: END,
    })
    // After each subagent finishes, return to supervisor
    .addEdge("calendar", "supervisor")
    .addEdge("general", "supervisor")
    .addEdge("family", "supervisor")
    .addEdge("reminder", "supervisor")
    .addEdge("recipe", "supervisor")
    .addEdge("shopping", "supervisor");

  return graph.compile({ checkpointer: postgresCheckpointer });
}
