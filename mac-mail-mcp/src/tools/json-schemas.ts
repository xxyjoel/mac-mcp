export const listMessagesJsonSchema = {
  type: "object",
  properties: {
    mailbox: {
      type: "string",
      description: "The mailbox/folder to list messages from",
      default: "INBOX"
    },
    limit: {
      type: "number",
      description: "Maximum number of messages to return",
      minimum: 1,
      maximum: 100,
      default: 50
    },
    accountName: {
      type: "string",
      description: "Specific email account to query"
    }
  }
};

export const getMessageJsonSchema = {
  type: "object",
  properties: {
    messageId: {
      type: "string",
      description: "The unique message ID"
    }
  },
  required: ["messageId"]
};

export const searchMessagesJsonSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query string",
      minLength: 1
    },
    searchIn: {
      type: "string",
      description: "Where to search",
      enum: ["all", "subject", "sender", "content"],
      default: "all"
    },
    limit: {
      type: "number",
      description: "Maximum number of results",
      minimum: 1,
      maximum: 100,
      default: 50
    }
  },
  required: ["query"]
};

export const listFoldersJsonSchema = {
  type: "object",
  properties: {}
};

export const getAttachmentsInfoJsonSchema = {
  type: "object",
  properties: {
    messageId: {
      type: "string",
      description: "The message ID to get attachments for"
    }
  },
  required: ["messageId"]
};