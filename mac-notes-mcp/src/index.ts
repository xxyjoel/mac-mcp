#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { NotesDatabase } from "./notes/notes-db.js";

const server = new Server(
  {
    name: "mac-notes-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

let notesDb: NotesDatabase | null = null;

// Initialize database connection
async function initializeDatabase() {
  if (!notesDb) {
    notesDb = new NotesDatabase();
    await notesDb.connect();
  }
  return notesDb;
}

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_notes_statistics",
        description: "Get statistics about your Notes",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_recent_notes",
        description: "Get recently modified notes",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of notes to return",
              default: 20,
            },
          },
        },
      },
      {
        name: "search_notes",
        description: "Search notes by title",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
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
      case "get_notes_statistics": {
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
      
      case "get_recent_notes": {
        const args = request.params.arguments as any || {};
        const limit = args.limit || 20;
        const notes = await db.getRecentNotes(limit);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: notes.length,
                notes: notes,
              }, null, 2),
            },
          ],
        };
      }
      
      case "search_notes": {
        const args = request.params.arguments as any || {};
        const results = await db.searchNotes(args.query, args.limit || 50);
        
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
  console.error("Mac Notes MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});