import { z } from "zod";

// List messages tool
export const listMessagesToolSchema = z.object({
  mailbox: z.string().default("INBOX").describe("The mailbox/folder to list messages from"),
  limit: z.number().min(1).max(100).default(50).describe("Maximum number of messages to return"),
  accountName: z.string().optional().describe("Specific email account to query")
});

// Get message tool
export const getMessageToolSchema = z.object({
  messageId: z.string().describe("The unique message ID")
});

// Search messages tool
export const searchMessagesToolSchema = z.object({
  query: z.string().min(1).describe("Search query string"),
  searchIn: z.enum(["all", "subject", "sender", "content"]).default("all").describe("Where to search"),
  limit: z.number().min(1).max(100).default(50).describe("Maximum number of results")
});

// List folders tool
export const listFoldersToolSchema = z.object({});

// Get attachments info tool
export const getAttachmentsInfoToolSchema = z.object({
  messageId: z.string().describe("The message ID to get attachments for")
});

// Type exports
export type ListMessagesInput = z.infer<typeof listMessagesToolSchema>;
export type GetMessageInput = z.infer<typeof getMessageToolSchema>;
export type SearchMessagesInput = z.infer<typeof searchMessagesToolSchema>;
export type ListFoldersInput = z.infer<typeof listFoldersToolSchema>;
export type GetAttachmentsInfoInput = z.infer<typeof getAttachmentsInfoToolSchema>;