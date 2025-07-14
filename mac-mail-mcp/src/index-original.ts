#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MailClient } from "./mail/client.js";
import { SwiftMailClient } from "./mail/swift-client.js";
import { PerformanceMailClient } from "./mail/performance-client.js";
import { SecurityManager } from "./mail/security.js";
import {
  listMessagesToolSchema,
  getMessageToolSchema,
  searchMessagesToolSchema,
  listFoldersToolSchema,
  getAttachmentsInfoToolSchema,
} from "./tools/schemas.js";
import {
  listMessagesJsonSchema,
  getMessageJsonSchema,
  searchMessagesJsonSchema,
  listFoldersJsonSchema,
  getAttachmentsInfoJsonSchema,
} from "./tools/json-schemas.js";

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

// Use Performance client which combines all optimizations
const mailClient = new PerformanceMailClient();
console.error("Using Performance mail client with caching, batching, and Swift helper");

const securityManager = new SecurityManager();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_messages",
        description: "List email messages from a specific mailbox/folder",
        inputSchema: listMessagesJsonSchema,
      },
      {
        name: "get_message",
        description: "Get detailed content of a specific email message",
        inputSchema: getMessageJsonSchema,
      },
      {
        name: "search_messages",
        description: "Search for email messages by query",
        inputSchema: searchMessagesJsonSchema,
      },
      {
        name: "list_folders",
        description: "List all mail folders/mailboxes across accounts",
        inputSchema: listFoldersJsonSchema,
      },
      {
        name: "get_attachments_info",
        description: "Get information about attachments in a message (no download)",
        inputSchema: getAttachmentsInfoJsonSchema,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Check permissions for all operations
    await securityManager.checkPermissions("mail.read");
    
    // Rate limiting
    securityManager.checkRateLimit(name);

    switch (name) {
      case "list_messages": {
        const validatedArgs = listMessagesToolSchema.parse(args);
        const result = await mailClient.listMessages(
          validatedArgs.mailbox,
          {
            page: 1,
            pageSize: validatedArgs.limit,
            accountName: validatedArgs.accountName
          }
        );
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                messages: result.messages,
                totalCount: result.totalCount,
                page: result.page,
                pageSize: result.pageSize,
                hasMore: result.hasMore
              }, null, 2),
            },
          ],
        };
      }

      case "get_message": {
        const validatedArgs = getMessageToolSchema.parse(args);
        const message = await mailClient.getMessage(validatedArgs.messageId);
        
        if (!message) {
          throw new Error(`Message not found: ${validatedArgs.messageId}`);
        }
        
        // Sanitize content for security
        if (message.content) {
          // Check content size
          securityManager.checkContentSize(message.content);
          
          // Convert HTML to plain text if needed
          if (message.content.includes('<html') || message.content.includes('<body')) {
            message.content = securityManager.htmlToPlainText(message.content);
          } else {
            message.content = securityManager.sanitizeEmailContent(message.content);
          }
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(message, null, 2),
            },
          ],
        };
      }

      case "search_messages": {
        const validatedArgs = searchMessagesToolSchema.parse(args);
        const messages = await mailClient.searchMessages(
          validatedArgs.query,
          validatedArgs.searchIn,
          validatedArgs.limit
        );
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(messages, null, 2),
            },
          ],
        };
      }

      case "list_folders": {
        listFoldersToolSchema.parse(args); // Validate empty args
        const folders = await mailClient.listFolders();
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(folders, null, 2),
            },
          ],
        };
      }

      case "get_attachments_info": {
        const validatedArgs = getAttachmentsInfoToolSchema.parse(args);
        const attachments = await mailClient.getAttachmentsInfo(
          validatedArgs.messageId
        );
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(attachments, null, 2),
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
  console.error("Mac Mail MCP server started");
  
  // Pre-check mail permissions once at startup
  try {
    console.error("Checking mail permissions...");
    await securityManager.checkPermissions("mail.read");
    console.error("Mail permissions verified");
  } catch (error: any) {
    console.error("WARNING: Mail permission check failed:", error.message);
    console.error("Please grant Terminal access to Mail in System Preferences");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.error('Shutting down Mac Mail MCP server...');
  mailClient.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Shutting down Mac Mail MCP server...');
  mailClient.close();
  process.exit(0);
});