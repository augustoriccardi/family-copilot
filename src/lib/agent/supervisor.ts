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
import { SUPERVISOR_PROMPT, CallerInfo } from "./prompts/supervisor";
import { buildCalendarAgent } from "./subagents/calendar";
import { buildInboxAgent } from "./subagents/inbox";
import { buildFamilyAgent } from "./subagents/family";
import { buildLibraryAgent } from "./subagents/library";
import { buildReminderAgent } from "./subagents/reminder";
import { buildRecipeAgent } from "./subagents/recipe";
import { buildShoppingAgent } from "./subagents/shopping";
import { buildNotificationsAgent } from "./subagents/notification";

/** The names of all subagents the supervisor can route to */
const SUBAGENT_NAMES = [
  "calendar",
  "inbox",
  "family",
  "library",
  "reminder",
  "recipe",
  "shopping",
  "notification",
] as const;
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
 *   START → supervisor → [calendar | inbox | family | reminder | recipe | shopping] → supervisor → ... → END
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

  const caller: CallerInfo = {
    callerId: cfg?.callerId,
    callerName: cfg?.callerName,
    callerRole: cfg?.callerRole,
  };

  const transferTools = buildTransferTools();
  if (!llm.bindTools) {
    throw new Error(
      "LLM does not support tool binding — use a model that supports function calling (gpt-4o, gemini-2.0-flash, etc.)",
    );
  }
  const supervisorLLM = llm.bindTools(transferTools, {
    parallel_tool_calls: false,
  });

  // ── Supervisor node ───────────────────────────────────────────────────────
  async function supervisorNode(state: typeof MessagesAnnotation.State) {
    const stateMessages = state.messages;
    const lastMsg = stateMessages[stateMessages.length - 1];

    console.log(
      `[supervisor] node called. total msgs=${stateMessages.length}, lastMsg type=${lastMsg?._getType()}, content preview=${typeof lastMsg?.content === "string" ? lastMsg.content.slice(0, 80) : JSON.stringify(lastMsg?.content).slice(0, 80)}`,
    );

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
          console.log(`[supervisor] skipping LLM — subagent already replied since last delegation`);
          return { messages: [] };
        }
      }
      console.log(
        `[supervisor] not new user turn, lastDelegatedIdx=${lastDelegatedIdx}, proceeding to LLM`,
      );
    }

    const messages = [new SystemMessage(SUPERVISOR_PROMPT(caller)), ...stateMessages];
    const response = await supervisorLLM.invoke(messages);
    console.log(
      `[supervisor] LLM response: tool_calls=${JSON.stringify((response as any).tool_calls?.map((tc: any) => tc.name))}, content preview=${typeof response.content === "string" ? response.content.slice(0, 100) : ""}`,
    );

    // When the supervisor makes transfer_to_<agent> tool calls, we must immediately
    // inject a ToolMessage for EVERY tool_call_id so the LLM history stays valid.
    // OpenAI/Gemini require every AIMessage(tool_calls) to be followed by a
    // ToolMessage for each tool_call_id — with nothing else in between.
    // The LLM may return multiple transfer calls (one per requested operation);
    // we ack all of them but only route to the first subagent below.
    if (
      "tool_calls" in response &&
      Array.isArray(response.tool_calls) &&
      response.tool_calls.length > 0
    ) {
      const transferCalls = response.tool_calls.filter((tc) => tc.name?.startsWith("transfer_to_"));
      if (transferCalls.length > 0 && transferCalls[0].id) {
        const acks = transferCalls
          .filter((tc) => tc.id)
          .map(
            (tc) =>
              new ToolMessage({
                content: `Delegated to ${tc.name.replace("transfer_to_", "")} agent.`,
                tool_call_id: tc.id!,
              }),
          );
        return { messages: [response, ...acks] };
      }
    }

    return { messages: [response] };
  }

  // ── Router: decides where to go after supervisor responds ─────────────────
  function routeAfterSupervisor(state: typeof MessagesAnnotation.State) {
    const messages = state.messages;
    const lastMsg = messages[messages.length - 1];

    console.log(
      `[routeAfterSupervisor] total msgs=${messages.length}, lastMsg type=${lastMsg?._getType()}, content preview=${typeof lastMsg?.content === "string" ? lastMsg.content.slice(0, 80) : ""}`,
    );

    // Route to a subagent ONLY when the last message is a delegation ack ToolMessage
    // we injected in supervisorNode. This prevents re-routing after a subagent already replied.
    if (
      lastMsg?._getType() === "tool" &&
      typeof lastMsg.content === "string" &&
      lastMsg.content.startsWith("Delegated to ")
    ) {
      // Walk back past all consecutive ack ToolMessages to find the AIMessage with tool_calls.
      // The supervisor may emit multiple acks (one per transfer call) so we can't assume
      // the AIMessage is always at messages.length - 2.
      let idx = messages.length - 2;
      while (
        idx >= 0 &&
        messages[idx]._getType() === "tool" &&
        typeof messages[idx].content === "string" &&
        (messages[idx].content as string).startsWith("Delegated to ")
      ) {
        idx--;
      }
      const aiMsg = messages[idx];
      if (
        aiMsg instanceof AIMessage &&
        Array.isArray(aiMsg.tool_calls) &&
        aiMsg.tool_calls.length > 0
      ) {
        const subagentName = aiMsg.tool_calls[0].name.replace("transfer_to_", "") as SubagentName;
        if ((SUBAGENT_NAMES as readonly string[]).includes(subagentName)) {
          console.log(`[routeAfterSupervisor] routing to subagent via ack: ${subagentName}`);
          return subagentName;
        }
      }
    }

    // Check if there are pending transfers that haven't been processed yet.
    // This handles the case where the supervisor emitted multiple transfer_to_* calls (one per task)
    // and only the first was routed. After each subagent responds we route to the next pending one.
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (
        m instanceof AIMessage &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.some((tc) => tc.name?.startsWith("transfer_to_"))
      ) {
        const transfers = m.tool_calls.filter((tc) => tc.name?.startsWith("transfer_to_"));
        const messagesAfterBatch = messages.slice(i + 1);
        const ackCount = messagesAfterBatch.filter(
          (msg) =>
            msg._getType() === "tool" &&
            typeof msg.content === "string" &&
            (msg.content as string).startsWith("Delegated to "),
        ).length;
        // Count only FINAL subagent responses: AI messages without tool_calls.
        // Internal subagent steps (AI messages that trigger tool calls) must be excluded
        // because each subagent adds multiple AI messages to the parent state:
        // e.g. reminder produces AI(tool_calls=[create_reminder]) + AI(final_answer) = 2 AI msgs.
        // Counting all AI msgs would make subagentResponseCount > ackCount prematurely.
        const subagentResponseCount = messagesAfterBatch.filter(
          (msg) =>
            msg._getType() === "ai" &&
            !(
              msg instanceof AIMessage &&
              Array.isArray(msg.tool_calls) &&
              msg.tool_calls.length > 0
            ),
        ).length;

        if (subagentResponseCount < ackCount) {
          // Still have pending transfers — route to the next one in order
          const nextTransfer = transfers[subagentResponseCount];
          if (nextTransfer) {
            const nextSubagent = nextTransfer.name.replace("transfer_to_", "") as SubagentName;
            if ((SUBAGENT_NAMES as readonly string[]).includes(nextSubagent)) {
              console.log(
                `[routeAfterSupervisor] routing to pending transfer: ${nextSubagent} (${subagentResponseCount}/${ackCount} done)`,
              );
              return nextSubagent;
            }
          }
        }
        break; // Only inspect the most recent transfer batch
      }
    }

    // All transfers processed (or no transfers) → END
    console.log(`[routeAfterSupervisor] → END`);
    return END;
  }

  // Build subagent compiled graphs (async ones await resolveHouseholdId internally)
  const [
    calendarGraph,
    familyGraph,
    reminderGraph,
    recipeGraph,
    shoppingGraph,
    notificationsGraph,
    inboxGraph,
    libraryGraph,
  ] = await Promise.all([
    buildCalendarAgent(allTools, householdId, cfg),
    buildFamilyAgent(householdId, cfg),
    buildReminderAgent(householdId, cfg),
    buildRecipeAgent(householdId, cfg),
    buildShoppingAgent(householdId, cfg),
    buildNotificationsAgent(householdId, cfg),
    buildInboxAgent(allTools, householdId ?? null, cfg, caller),
    buildLibraryAgent(householdId ?? null, cfg, caller),
  ]);

  // ── Assemble the supervisor StateGraph ───────────────────────────────────
  const graph = new StateGraph(MessagesAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("calendar", calendarGraph)
    .addNode("inbox", inboxGraph)
    .addNode("family", familyGraph)
    .addNode("library", libraryGraph)
    .addNode("reminder", reminderGraph)
    .addNode("recipe", recipeGraph)
    .addNode("shopping", shoppingGraph)
    .addNode("notification", notificationsGraph)
    .addEdge(START, "supervisor")
    .addConditionalEdges("supervisor", routeAfterSupervisor, {
      calendar: "calendar",
      inbox: "inbox",
      family: "family",
      library: "library",
      reminder: "reminder",
      recipe: "recipe",
      shopping: "shopping",
      notification: "notification",
      [END]: END,
    })
    // After each subagent finishes, return to supervisor
    .addEdge("calendar", "supervisor")
    .addEdge("inbox", "supervisor")
    .addEdge("family", "supervisor")
    .addEdge("library", "supervisor")
    .addEdge("reminder", "supervisor")
    .addEdge("recipe", "supervisor")
    .addEdge("shopping", "supervisor")
    .addEdge("notification", "supervisor");

  return graph.compile({ checkpointer: postgresCheckpointer });
}
