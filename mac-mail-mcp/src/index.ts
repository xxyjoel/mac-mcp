#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MacMailDatabase } from "./mail/mac-mail-db.js";

const server = new Server(
  {
    name: "mac-mail-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

let mailDb: MacMailDatabase | null = null;

// Initialize database connection
async function initializeDatabase() {
  if (!mailDb) {
    mailDb = new MacMailDatabase();
    await mailDb.connect();
  }
  return mailDb;
}

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_mail_statistics",
        description: "Get email statistics from Mac Mail",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_recent_emails",
        description: "Get recent emails from the last N days",
        inputSchema: {
          type: "object",
          properties: {
            days: {
              type: "number",
              description: "Number of days to look back",
              default: 2,
            },
            limit: {
              type: "number",
              description: "Maximum number of emails to return",
              default: 100,
            },
          },
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
      case "get_mail_statistics": {
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
      
      case "get_recent_emails": {
        const args = request.params.arguments as any || {};
        const days = args.days || 2;
        const limit = args.limit || 100;
        const messages = await db.getRecentMessages(days, limit);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: messages.length,
                messages: messages.slice(0, 10), // First 10 for brevity
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
  console.error("Mac Mail MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});