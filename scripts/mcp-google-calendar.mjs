/**
 * Google Calendar MCP Server (stdio)
 *
 * Exposes 4 tools: create_event, list_events, update_event, delete_event
 *
 * Required environment variables (injected by the MCPServer.env DB field):
 *   GOOGLE_CLIENT_ID       – OAuth2 client ID from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET   – OAuth2 client secret
 *   GOOGLE_REFRESH_TOKEN   – Long-lived refresh token (obtained via get-google-token script)
 *   GOOGLE_CALENDAR_ID     – Calendar ID to use (default: "primary")
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";

const log = (...args) => process.stderr.write(`[google-calendar] ${args.join(" ")}\n`);

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_CALENDAR_ID = "primary",
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
  process.stderr.write(
    "Missing required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN\n",
  );
  process.exit(1);
}

const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

// Verify token works on startup
try {
  await auth.getAccessToken();
} catch (err) {
  process.stderr.write(`[google-calendar] ERROR getting access token: ${err.message}\n`);
  process.stderr.write(`[google-calendar] Full error: ${JSON.stringify(err, null, 2)}\n`);
}

const calendar = google.calendar({ version: "v3", auth });

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "google-calendar", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ─── Tool definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_event",
        description:
          "Create a new event in Google Calendar. The 'summary' field is the event title shown in the calendar.",
        inputSchema: {
          type: "object",
          required: ["summary", "startDateTime", "endDateTime"],
          properties: {
            summary: {
              type: "string",
              description:
                "The event title/name displayed in Google Calendar (e.g. 'Birthday Party')",
            },
            description: {
              type: "string",
              description: "Optional notes or details about the event",
            },
            startDateTime: {
              type: "string",
              description: "Start date-time in ISO 8601 format, e.g. 2026-04-15T18:00:00",
            },
            endDateTime: {
              type: "string",
              description: "End date-time in ISO 8601 format, e.g. 2026-04-15T20:00:00",
            },
            location: { type: "string", description: "Physical or virtual location" },
            timeZone: {
              type: "string",
              description: "IANA time zone name, e.g. America/New_York (default: UTC)",
            },
            attendees: {
              type: "array",
              items: { type: "string" },
              description: "List of attendee email addresses",
            },
          },
        },
      },
      {
        name: "list_events",
        description: "List upcoming events from Google Calendar",
        inputSchema: {
          type: "object",
          properties: {
            maxResults: {
              type: "number",
              description: "Maximum number of events to return (default: 10)",
            },
            timeMin: {
              type: "string",
              description: "Only return events starting after this ISO 8601 date-time",
            },
            timeMax: {
              type: "string",
              description: "Only return events starting before this ISO 8601 date-time",
            },
            query: { type: "string", description: "Free-text search query" },
          },
        },
      },
      {
        name: "update_event",
        description:
          "Update an existing Google Calendar event (patch – only provided fields are changed)",
        inputSchema: {
          type: "object",
          required: ["eventId"],
          properties: {
            eventId: { type: "string", description: "The Google Calendar event ID to update" },
            summary: { type: "string", description: "New event title/name" },
            description: { type: "string", description: "New event notes or details" },
            startDateTime: { type: "string", description: "New start date-time (ISO 8601)" },
            endDateTime: { type: "string", description: "New end date-time (ISO 8601)" },
            location: { type: "string" },
            timeZone: { type: "string", description: "IANA time zone name (default: UTC)" },
          },
        },
      },
      {
        name: "delete_event",
        description: "Permanently delete an event from Google Calendar",
        inputSchema: {
          type: "object",
          required: ["eventId"],
          properties: {
            eventId: { type: "string", description: "The Google Calendar event ID to delete" },
          },
        },
      },
    ],
  };
});

// ─── Tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ── create_event ──────────────────────────────────────────────────────────
    if (name === "create_event") {
      const tz = args.timeZone ?? args.start?.timeZone ?? "UTC";
      // Accept both 'title' and 'summary' as event title
      const title = args.summary ?? args.title ?? args.name ?? "(Sin título)";
      // Accept both flat strings (startDateTime) and object format (start.dateTime)
      const startDateTime = args.startDateTime ?? args.start?.dateTime ?? args.start;
      const endDateTime = args.endDateTime ?? args.end?.dateTime ?? args.end;
      const event = await calendar.events.insert({
        calendarId: GOOGLE_CALENDAR_ID,
        requestBody: {
          summary: title,
          description: args.description,
          location: args.location,
          start: { dateTime: startDateTime, timeZone: tz },
          end: { dateTime: endDateTime, timeZone: tz },
          attendees: args.attendees?.map((email) => ({ email })),
        },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              eventId: event.data.id,
              link: event.data.htmlLink,
              summary: event.data.summary,
              start: event.data.start,
            }),
          },
        ],
      };
    }

    // ── list_events ───────────────────────────────────────────────────────────
    if (name === "list_events") {
      // Google Calendar requires RFC3339 format with timezone offset (e.g. Z or +00:00)
      const toRFC3339 = (dt) => {
        if (!dt) return undefined;
        // Already has timezone info
        if (dt.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dt)) return dt;
        return dt + "Z";
      };

      const res = await calendar.events.list({
        calendarId: GOOGLE_CALENDAR_ID,
        maxResults: args.maxResults ?? 10,
        timeMin: toRFC3339(args.timeMin) ?? new Date().toISOString(),
        timeMax: toRFC3339(args.timeMax),
        q: args.query,
        orderBy: "startTime",
        singleEvents: true,
      });

      const events = (res.data.items ?? []).map((e) => ({
        id: e.id,
        title: e.summary,
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        location: e.location,
        description: e.description,
        link: e.htmlLink,
      }));

      return { content: [{ type: "text", text: JSON.stringify(events) }] };
    }

    // ── update_event ──────────────────────────────────────────────────────────
    if (name === "update_event") {
      const tz = args.timeZone ?? "UTC";

      const toRFC3339 = (dt) => {
        if (!dt) return undefined;
        if (dt.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dt)) return dt;
        return dt + "Z";
      };

      const patch = {};
      if (args.summary ?? args.title) patch.summary = args.summary ?? args.title;
      if (args.description !== undefined) patch.description = args.description;
      if (args.location !== undefined) patch.location = args.location;
      if (args.startDateTime)
        patch.start = { dateTime: toRFC3339(args.startDateTime), timeZone: tz };
      if (args.endDateTime) patch.end = { dateTime: toRFC3339(args.endDateTime), timeZone: tz };

      if (Object.keys(patch).length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: "No fields to update provided" }),
            },
          ],
        };
      }

      const updated = await calendar.events.patch({
        calendarId: GOOGLE_CALENDAR_ID,
        eventId: args.eventId,
        requestBody: patch,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              eventId: updated.data.id,
              link: updated.data.htmlLink,
              summary: updated.data.summary,
              start: updated.data.start,
            }),
          },
        ],
      };
    }

    // ── delete_event ──────────────────────────────────────────────────────────
    if (name === "delete_event") {
      try {
        await calendar.events.delete({
          calendarId: GOOGLE_CALENDAR_ID,
          eventId: args.eventId,
        });
        return {
          content: [
            { type: "text", text: JSON.stringify({ success: true, deleted: args.eventId }) },
          ],
        };
      } catch (deleteErr) {
        // 410 Gone = already deleted, treat as success
        if (deleteErr?.code === 410 || deleteErr?.status === 410) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  deleted: args.eventId,
                  note: "Event was already deleted",
                }),
              },
            ],
          };
        }
        // 404 Not found
        if (deleteErr?.code === 404 || deleteErr?.status === 404) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: false, error: `Event not found: ${args.eventId}` }),
              },
            ],
            isError: true,
          };
        }
        throw deleteErr;
      }
    }

    log(`Unknown tool: "${name}"`);
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error) {
    log("ERROR executing tool:", name, error.message);
    log("Full error:", JSON.stringify(error, null, 2));
    return {
      content: [{ type: "text", text: `Google Calendar error: ${error.message}` }],
      isError: true,
    };
  }
});

// ─── Connect ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
