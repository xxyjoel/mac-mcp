# Mac MCP Project

A collection of Model Context Protocol (MCP) implementations for macOS services.

## Projects

- **mac-calendar-mcp**: MCP server for macOS Calendar integration
- **mac-mail-mcp**: MCP server for macOS Mail integration  
- **mac-reminders-mcp**: MCP server for macOS Reminders integration

## Semantic Versioning

This project follows [Semantic Versioning](https://semver.org/). Version numbers are in the format `MAJOR.MINOR.PATCH`:

- **MAJOR**: Incompatible API changes
- **MINOR**: Backwards-compatible functionality additions
- **PATCH**: Backwards-compatible bug fixes

### Version Management

To update the version:

```bash
# Patch release (bug fixes)
npm version patch

# Minor release (new features)
npm version minor

# Major release (breaking changes)
npm version major
```

The `postversion` script will automatically push the commit and tags to GitHub.

### Current Version

v0.1.0

## Repository

https://github.com/xxyjoel/mac-mcp