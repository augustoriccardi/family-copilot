/**
 * register-google-calendar.mjs
 *
 * Registers (or updates) the Google Calendar MCP server in the database.
 *
 * Usage:
 *   node scripts/register-google-calendar.mjs
 *
 * Requires these .env variables to be set:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN    (obtained via: node scripts/get-google-token.mjs)
 *   GOOGLE_CALENDAR_ID      (optional, defaults to "primary")
 *   DATABASE_URL
 */

import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`❌ Missing env var: ${key}`);
    console.error("   Run: node scripts/get-google-token.mjs  to obtain a refresh token.");
    process.exit(1);
  }
}

// Absolute path to the MCP server script (works on all platforms)
const serverScript = path.resolve(__dirname, "mcp-google-calendar.mjs");

const prisma = new PrismaClient();

try {
  const server = await prisma.mCPServer.upsert({
    where: { name: "google-calendar" },
    update: {
      enabled: true,
      command: "node",
      args: [serverScript],
      env: {
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
        GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID ?? "primary",
      },
    },
    create: {
      name: "google-calendar",
      type: "stdio",
      enabled: true,
      command: "node",
      args: [serverScript],
      env: {
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
        GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID ?? "primary",
      },
    },
  });

  console.log(`\n✅ Google Calendar MCP server registered in DB`);
  console.log(`   ID:   ${server.id}`);
  console.log(`   Name: ${server.name}`);
  console.log(`   Script: ${serverScript}`);
  console.log("\n   Restart your dev server (pnpm dev) to activate it.\n");
} catch (err) {
  console.error("❌ Failed to register MCP server:", err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
