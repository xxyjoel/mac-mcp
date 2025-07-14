#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RemindersDatabase } from "./reminders/reminders-db.js";

const server = new Server(
  {
    name: "mac-reminders-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

let remindersDb: RemindersDatabase | null = null;

// Initialize database connection
async function initializeDatabase() {
  if (!remindersDb) {
    remindersDb = new RemindersDatabase();
    await remindersDb.connect();
  }
  return remindersDb;
}

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_reminders_statistics",
        description: "Get statistics about your Reminders",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_active_reminders",
        description: "Get active (incomplete) reminders",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of reminders to return",
              default: 50,
            },
          },
        },
      },
      {
        name: "get_reminder_lists",
        description: "Get all reminder lists",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "search_reminders",
        description: "Search reminders by text",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
            includeCompleted: {
              type: "boolean",
              description: "Include completed reminders",
              default: false,
            },
            limit: {
              type: "number",
              description: "Maximum results",
              default: 50,
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const db = await initializeDatabase();
    
    switch (request.params.name) {
      case "get_reminders_statistics": {
        const stats = await db.getStatistics();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }
      
      case "get_active_reminders": {
        const args = request.params.arguments as any || {};
        const limit = args.limit || 50;
        const reminders = await db.getActiveReminders(limit);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: reminders.length,
                reminders: reminders,
              }, null, 2),
            },
          ],
        };
      }
      
      case "get_reminder_lists": {
        const lists = await db.getLists();
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: lists.length,
                lists: lists,
              }, null, 2),
            },
          ],
        };
      }
      
      case "search_reminders": {
        const args = request.params.arguments as any || {};
        const results = await db.searchReminders(
          args.query,
          args.includeCompleted || false,
          args.limit || 50
        );
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: results.length,
                results: results,
              }, null, 2),
            },
          ],
        };
      }
      
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mac Reminders MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});