import { BaseMessage } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import * as dotenv from "dotenv";

if (process.env.NODE_ENV !== "test") {
  dotenv.config();
}

/**
 * Creates a PostgresSaver instance using environment variables
 * @returns PostgresSaver instance
 */
export function createPostgresMemory(): PostgresSaver {
  const connectionString = `${process.env.DATABASE_URL}${
    process.env.DB_SSLMODE ? `?sslmode=${process.env.DB_SSLMODE}` : ""
  }`;
  return PostgresSaver.fromConnString(connectionString);
}

export const postgresCheckpointer = createPostgresMemory();

// Ensure LangGraph checkpoint tables exist before any read/write.
// setup() is idempotent — safe to call multiple times.
let checkpointerReady: Promise<void> | null = null;
function ensureCheckpointerReady(): Promise<void> {
  if (!checkpointerReady) {
    checkpointerReady = postgresCheckpointer.setup().catch((err) => {
      checkpointerReady = null;
      throw err;
    });
  }
  return checkpointerReady;
}

/**
 * Retrieves the message history for a specific thread.
 * @param threadId - The ID of the thread to retrieve history for.
 * @returns An array of messages associated with the thread.
 */
export const getHistory = async (threadId: string): Promise<BaseMessage[]> => {
  await ensureCheckpointerReady();
  const history = await postgresCheckpointer.get({
    configurable: { thread_id: threadId },
  });
  return Array.isArray(history?.channel_values?.messages) ? history.channel_values.messages : [];
};
