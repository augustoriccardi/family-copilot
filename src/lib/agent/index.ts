import { postgresCheckpointer } from "./memory";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { AgentConfigOptions } from "./util";
import { getMCPTools } from "./mcp";
import { buildSupervisorGraph } from "./supervisor";

let setupPromise: Promise<void> | null = null;

/**
 * One-time initialization for the Postgres checkpointer.
 * Ensures the underlying table/extension are ready before any agent runs.
 */
async function setupOnce() {
  if (!setupPromise) {
    setupPromise = postgresCheckpointer.setup().catch((err) => {
      setupPromise = null;
      console.error("Failed to setup postgres checkpointer:", err);
      throw err;
    });
  }
  await setupPromise;
}

/**
 * Creates the Family Copilot supervisor graph with all MCP tools loaded and
 * distributed to the appropriate specialized subagents.
 */
async function createSupervisor(cfg?: AgentConfigOptions) {
  const mcpTools = await getMCPTools();
  const configTools = (cfg?.tools || []) as StructuredToolInterface[];
  const allTools = [...configTools, ...mcpTools];

  return await buildSupervisorGraph(allTools, cfg, cfg?.householdId);
}

// Public helper — creates a fresh supervisor graph for each request.
export async function ensureAgent(cfg?: AgentConfigOptions) {
  await setupOnce();
  return createSupervisor(cfg);
}

// Named export alias.
export async function getAgent(cfg?: AgentConfigOptions) {
  return ensureAgent(cfg);
}
