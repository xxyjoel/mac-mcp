#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CalendarClient } from "./calendar/client.js";
import { EventKitClient } from "./calendar/eventkit-client.js";
import { SecurityManager } from "./calendar/security.js";
import {
  listEventsToolSchema,
  getEventToolSchema,
  searchEventsToolSchema,
  getCalendarInfoToolSchema,
  getEventCountToolSchema,
} from "./tools/schemas.js";
import {
  listEventsJsonSchema,
  getEventJsonSchema,
  searchEventsJsonSchema,
  getCalendarInfoJsonSchema,
  getEventCountJsonSchema,
} from "./tools/json-schemas.js";

const server = new Server(
  {
    name: "mac-calendar-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Use EventKit client if available, fallback to AppleScript
let calendarClient: CalendarClient | EventKitClient;
try {
  // Check if Swift helper exists
  const fs = await import('fs');
  const path = await import('path');
  const helperPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../calendar-helper');
  
  if (fs.existsSync(helperPath)) {
    console.error("Using EventKit client for better performance");
    calendarClient = new EventKitClient();
  } else {
    console.error("Swift helper not found, falling back to AppleScript client");
    calendarClient = new CalendarClient();
  }
} catch (error) {
  console.error("Error checking for Swift helper, using AppleScript client");
  calendarClient = new CalendarClient();
}
const securityManager = new SecurityManager();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_events",
        description: "List calendar events within a date range",
        inputSchema: listEventsJsonSchema,
      },
      {
        name: "get_event",
        description: "Get details of a specific calendar event",
        inputSchema: getEventJsonSchema,
      },
      {
        name: "search_events",
        description: "Search for events by title or description",
        inputSchema: searchEventsJsonSchema,
      },
      {
        name: "get_calendar_info",
        description: "Get information about all calendars",
        inputSchema: getCalendarInfoJsonSchema,
      },
      {
        name: "get_event_count",
        description: "Get the total number of events in a specific calendar",
        inputSchema: getEventCountJsonSchema,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    console.error(`[MCP] Checking permissions for tool: ${name}`);
    const secStartTime = Date.now();
    await securityManager.checkPermissions("calendar.read");
    console.error(`[MCP] Permission check completed in ${Date.now() - secStartTime}ms`);

    switch (name) {
      case "list_events": {
        const validatedArgs = listEventsToolSchema.parse(args);
        const events = await calendarClient.listEvents(
          validatedArgs.startDate,
          validatedArgs.endDate,
          validatedArgs.calendarName
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(events, null, 2),
            },
          ],
        };
      }

      case "get_event": {
        const validatedArgs = getEventToolSchema.parse(args);
        const event = await calendarClient.getEvent(validatedArgs.eventId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(event, null, 2),
            },
          ],
        };
      }

      case "search_events": {
        const validatedArgs = searchEventsToolSchema.parse(args);
        const events = await calendarClient.searchEvents(
          validatedArgs.query,
          validatedArgs.startDate,
          validatedArgs.endDate
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(events, null, 2),
            },
          ],
        };
      }

      case "get_calendar_info": {
        console.error(`[MCP] get_calendar_info called at ${new Date().toISOString()}`);
        getCalendarInfoToolSchema.parse(args); // Validate empty args
        console.error(`[MCP] Calling getCalendars()...`);
        const startTime = Date.now();
        const calendars = await calendarClient.getCalendars();
        console.error(`[MCP] getCalendars() completed in ${Date.now() - startTime}ms, found ${calendars.length} calendars`);
        const calendarInfo = {
          totalCalendars: calendars.length,
          calendars: calendars,
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(calendarInfo, null, 2),
            },
          ],
        };
      }

      case "get_event_count": {
        const validatedArgs = getEventCountToolSchema.parse(args);
        const count = await calendarClient.getCalendarEventCount(
          validatedArgs.calendarName
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                calendar: validatedArgs.calendarName,
                eventCount: count 
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid arguments: ${error.message}`);
    }
    throw error;
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mac Calendar MCP server started");
  
  // Pre-check calendar permissions once at startup
  try {
    console.error("Checking calendar permissions...");
    await securityManager.checkPermissions("calendar.read");
    console.error("Calendar permissions verified");
  } catch (error: any) {
    console.error("WARNING: Calendar permission check failed:", error.message);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.error('Shutting down Mac Calendar MCP server...');
  calendarClient.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Shutting down Mac Calendar MCP server...');
  calendarClient.close();
  process.exit(0);
});