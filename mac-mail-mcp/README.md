# Mac Mail MCP

MCP server for secure, read-only access to macOS Mail with performance optimizations.

## Features

- **Read-only access** to Mail messages and folders
- **Performance optimized** with:
  - SQLite caching with intelligent TTLs
  - Request batching for AppleScript operations
  - Search debouncing
  - Pagination support
  - Request deduplication
  - Swift helper for improved performance
- **Security features**:
  - HTML sanitization
  - Content size limits
  - Rate limiting
  - Permission checking
- **Smart caching**:
  - 1 hour TTL for folder lists
  - 5 minute TTL for message lists
  - 24 hour TTL for message content
  - 2 minute TTL for search results

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

3. Link with Claude Desktop or other MCP clients.

## Configuration

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "mac-mail": {
      "command": "node",
      "args": ["/path/to/mac-mail-mcp/dist/index.js"]
    }
  }
}
```

## Usage

The server provides the following tools:

- `list_folders`: List all mail folders/mailboxes
- `list_messages`: List messages from a specific mailbox with pagination
- `get_message`: Get detailed content of a specific message
- `search_messages`: Search for messages by query
- `get_attachments_info`: Get information about message attachments

## Performance

The performance client combines multiple optimization strategies:

1. **Multi-level caching**: Different TTLs for different data types
2. **Request batching**: Multiple operations in single AppleScript call
3. **Search debouncing**: Prevents duplicate searches
4. **Pagination**: Efficient handling of large mailboxes
5. **Swift helper**: Native performance where possible

## Testing

Run performance tests:
```bash
npm run test:performance
npm run test:stats
```

## Security

- All content is sanitized before returning
- HTML emails are converted to plain text
- Large content is truncated
- Rate limiting prevents abuse
- Requires macOS permission for Mail access

## Troubleshooting

If you encounter permission errors:
1. Grant Terminal access to Mail in System Preferences > Privacy & Security
2. Restart the MCP server

For performance issues:
- The first query may be slow as it builds the cache
- Subsequent queries should be much faster
- Check cache statistics in performance tests

## License

MIT