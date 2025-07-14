# Mac MCP Suite Installation Guide

This guide will help you install and configure the Mac MCP Suite, which provides direct access to your Mac's Mail, Calendar, Notes, and Reminders data through the Model Context Protocol (MCP).

## Table of Contents

- [Requirements](#requirements)
- [Quick Install](#quick-install)
- [Manual Installation](#manual-installation)
- [Permissions Setup](#permissions-setup)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Uninstalling](#uninstalling)

## Requirements

- **macOS 10.14 (Mojave) or later**
- **Node.js 18 or later** ([Download](https://nodejs.org/))
- **Git** (comes with macOS)
- **Terminal app with Full Disk Access** (see [Permissions Setup](#permissions-setup))

## Quick Install

The easiest way to install Mac MCP Suite is using our automated installer:

```bash
# Download and run the installer
curl -fsSL https://raw.githubusercontent.com/xxyjoel/mac-mcp/main/install.sh | bash
```

The installer will:
- Check system requirements
- Clone the repository
- Install dependencies
- Build all services
- Set up shell aliases
- Configure MCP integration

## Manual Installation

If you prefer to install manually:

### 1. Clone the Repository

```bash
git clone https://github.com/xxyjoel/mac-mcp.git ~/.mac-mcp
cd ~/.mac-mcp
```

### 2. Install Dependencies

```bash
# Install root dependencies
npm install

# Install service dependencies
for service in mac-mail-mcp mac-calendar-mcp mac-notes-mcp mac-reminders-mcp; do
  cd $service && npm install && cd ..
done
```

### 3. Build Services

```bash
# Build all services
for service in mac-mail-mcp mac-calendar-mcp mac-notes-mcp mac-reminders-mcp; do
  cd $service && npm run build && cd ..
done
```

### 4. Set Up Shell Aliases

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
# Mac MCP Suite
export MAC_MCP_HOME="$HOME/.mac-mcp"
alias mac-mail-mcp="node '$MAC_MCP_HOME/mac-mail-mcp/dist/index.js'"
alias mac-calendar-mcp="node '$MAC_MCP_HOME/mac-calendar-mcp/dist/index.js'"
alias mac-notes-mcp="node '$MAC_MCP_HOME/mac-notes-mcp/dist/index.js'"
alias mac-reminders-mcp="node '$MAC_MCP_HOME/mac-reminders-mcp/dist/index.js'"
```

### 5. Configure MCP Client

Create or update `~/.config/mcp/config.json`:

```json
{
  "mcpServers": {
    "mac-mail": {
      "command": "node",
      "args": ["~/.mac-mcp/mac-mail-mcp/dist/index.js"],
      "description": "Mac Mail MCP Server"
    },
    "mac-calendar": {
      "command": "node", 
      "args": ["~/.mac-mcp/mac-calendar-mcp/dist/index.js"],
      "description": "Mac Calendar MCP Server"
    },
    "mac-notes": {
      "command": "node",
      "args": ["~/.mac-mcp/mac-notes-mcp/dist/index.js"],
      "description": "Mac Notes MCP Server"
    },
    "mac-reminders": {
      "command": "node",
      "args": ["~/.mac-mcp/mac-reminders-mcp/dist/index.js"],
      "description": "Mac Reminders MCP Server"
    }
  }
}
```

## Permissions Setup

Mac MCP Suite requires specific permissions to access your data:

### Full Disk Access

The Mail MCP server requires Full Disk Access to read the Mail database:

1. Open **System Preferences** → **Security & Privacy** → **Privacy**
2. Click the lock icon to make changes
3. Select **Full Disk Access** from the left sidebar
4. Click the **+** button
5. Add **Terminal** (or your terminal app of choice)
6. Restart Terminal

### Calendar, Notes, and Reminders Access

These services use standard macOS permissions:

1. The first time you run each service, macOS may prompt for permission
2. Click **Allow** when prompted
3. If you miss the prompt, go to **System Preferences** → **Security & Privacy** → **Privacy**
4. Grant access to the respective apps

## Testing

After installation, test each service:

### Test Individual Services

```bash
# Test Mail (should show email count)
mac-mail-mcp

# Test Calendar (should show calendar count)
mac-calendar-mcp

# Test Notes (should show notes count)
mac-notes-mcp

# Test Reminders (should show reminders count)
mac-reminders-mcp
```

### Run Comprehensive Test

```bash
cd ~/.mac-mcp
node test-both-services.js
```

## Troubleshooting

### Permission Denied Errors

If you see "Database access denied":

1. Ensure Terminal has Full Disk Access (see [Permissions Setup](#permissions-setup))
2. Restart Terminal after granting permissions
3. Make sure the respective app (Mail, Calendar, etc.) has been opened at least once

### Database Not Found

If you see "database not found":

1. Open the respective app (Mail, Calendar, Notes, or Reminders)
2. Let it sync/load completely
3. Try running the MCP server again

### Build Errors

If you encounter build errors:

```bash
# Clean and rebuild
cd ~/.mac-mcp
for service in mac-*-mcp; do
  cd $service
  rm -rf node_modules dist
  npm install
  npm run build
  cd ..
done
```

### Node Version Issues

Ensure you're using Node.js 18 or later:

```bash
node --version  # Should show v18.0.0 or higher
```

Update Node.js if needed:
- Using Homebrew: `brew upgrade node`
- Or download from [nodejs.org](https://nodejs.org/)

## Uninstalling

To remove Mac MCP Suite:

```bash
# Run the uninstaller
bash ~/.mac-mcp/uninstall.sh
```

Or manually:

```bash
# Remove installation directory
rm -rf ~/.mac-mcp

# Remove cache directories
rm -rf ~/.mac-{mail,calendar,notes,reminders}-mcp

# Remove aliases from ~/.zshrc or ~/.bashrc
# Remove MCP configuration from ~/.config/mcp/config.json
```

## Next Steps

- Read the [README](README.md) for usage examples
- Check individual service documentation:
  - [Mail MCP](mac-mail-mcp/README.md)
  - [Calendar MCP](mac-calendar-mcp/README.md)
  - [Notes MCP](mac-notes-mcp/README.md)  
  - [Reminders MCP](mac-reminders-mcp/README.md)
- Report issues at [GitHub Issues](https://github.com/xxyjoel/mac-mcp/issues)