#!/bin/bash

# Mac MCP Suite Installer
# Automated installation script for Mac Mail, Calendar, Notes, and Reminders MCP servers

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script version
VERSION="1.0.0"

# Installation directory
INSTALL_DIR="$HOME/.mac-mcp"

# Print colored message
print_message() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Print header
print_header() {
    clear
    print_message "$BLUE" "============================================"
    print_message "$BLUE" "    Mac MCP Suite Installer v${VERSION}"
    print_message "$BLUE" "============================================"
    echo ""
}

# Check system requirements
check_requirements() {
    print_message "$YELLOW" "Checking system requirements..."
    
    # Check macOS version
    if [[ ! "$OSTYPE" == "darwin"* ]]; then
        print_message "$RED" "Error: This installer is for macOS only."
        exit 1
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_message "$RED" "Error: Node.js is not installed."
        print_message "$YELLOW" "Please install Node.js from https://nodejs.org/"
        exit 1
    fi
    
    local node_version=$(node -v | cut -d'v' -f2)
    local required_version="18.0.0"
    if [[ "$(printf '%s\n' "$required_version" "$node_version" | sort -V | head -n1)" != "$required_version" ]]; then
        print_message "$RED" "Error: Node.js version $node_version is too old."
        print_message "$YELLOW" "Please upgrade to Node.js 18 or later."
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_message "$RED" "Error: npm is not installed."
        exit 1
    fi
    
    print_message "$GREEN" "✓ System requirements met"
    echo ""
}

# Check permissions
check_permissions() {
    print_message "$YELLOW" "Checking permissions..."
    
    # Test Full Disk Access
    if [[ -r "$HOME/Library/Mail/V10/MailData/Envelope Index" ]]; then
        print_message "$GREEN" "✓ Full Disk Access detected"
    else
        print_message "$YELLOW" "⚠ Full Disk Access may not be granted"
        print_message "$YELLOW" "  You may need to grant Full Disk Access to Terminal:"
        print_message "$YELLOW" "  1. Open System Preferences > Security & Privacy > Privacy"
        print_message "$YELLOW" "  2. Select 'Full Disk Access' from the left sidebar"
        print_message "$YELLOW" "  3. Add Terminal to the list"
        echo ""
        read -p "Press Enter to continue or Ctrl+C to exit..."
    fi
    
    echo ""
}

# Clone or update repository
setup_repository() {
    print_message "$YELLOW" "Setting up Mac MCP Suite..."
    
    if [[ -d "$INSTALL_DIR" ]]; then
        print_message "$YELLOW" "Existing installation found. Updating..."
        cd "$INSTALL_DIR"
        git pull origin main
    else
        print_message "$YELLOW" "Cloning repository..."
        git clone https://github.com/xxyjoel/mac-mcp.git "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    
    print_message "$GREEN" "✓ Repository ready"
    echo ""
}

# Install dependencies
install_dependencies() {
    print_message "$YELLOW" "Installing dependencies..."
    
    # Install root dependencies
    npm install
    
    # Install service dependencies
    for service in mac-mail-mcp mac-calendar-mcp mac-notes-mcp mac-reminders-mcp; do
        if [[ -d "$service" ]]; then
            print_message "$YELLOW" "  Installing $service dependencies..."
            cd "$service"
            npm install
            cd ..
        fi
    done
    
    print_message "$GREEN" "✓ Dependencies installed"
    echo ""
}

# Build all services
build_services() {
    print_message "$YELLOW" "Building MCP services..."
    
    for service in mac-mail-mcp mac-calendar-mcp mac-notes-mcp mac-reminders-mcp; do
        if [[ -d "$service" ]]; then
            print_message "$YELLOW" "  Building $service..."
            cd "$service"
            npm run build
            cd ..
        fi
    done
    
    print_message "$GREEN" "✓ Services built"
    echo ""
}

# Test services
test_services() {
    print_message "$YELLOW" "Testing MCP services..."
    
    # Test Mail
    if [[ -r "$HOME/Library/Mail/V10/MailData/Envelope Index" ]]; then
        print_message "$GREEN" "  ✓ Mail database accessible"
    else
        print_message "$RED" "  ✗ Mail database not accessible"
    fi
    
    # Test Calendar
    if [[ -r "$HOME/Library/Group Containers/group.com.apple.calendar/Calendar.sqlitedb" ]]; then
        print_message "$GREEN" "  ✓ Calendar database accessible"
    else
        print_message "$RED" "  ✗ Calendar database not accessible"
    fi
    
    # Test Notes
    if [[ -r "$HOME/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite" ]]; then
        print_message "$GREEN" "  ✓ Notes database accessible"
    else
        print_message "$RED" "  ✗ Notes database not accessible"
    fi
    
    # Test Reminders
    if [[ -r "$HOME/Library/Group Containers/group.com.apple.reminders/Container_v1/Stores/Data-local.sqlite" ]]; then
        print_message "$GREEN" "  ✓ Reminders database accessible"
    else
        print_message "$RED" "  ✗ Reminders database not accessible"
    fi
    
    echo ""
}

# Setup shell integration
setup_shell_integration() {
    print_message "$YELLOW" "Setting up shell integration..."
    
    # Detect shell
    local shell_config=""
    if [[ "$SHELL" == *"zsh"* ]]; then
        shell_config="$HOME/.zshrc"
    elif [[ "$SHELL" == *"bash"* ]]; then
        shell_config="$HOME/.bashrc"
    fi
    
    if [[ -n "$shell_config" ]]; then
        # Check if already added
        if ! grep -q "mac-mcp" "$shell_config" 2>/dev/null; then
            echo "" >> "$shell_config"
            echo "# Mac MCP Suite" >> "$shell_config"
            echo "export MAC_MCP_HOME=\"$INSTALL_DIR\"" >> "$shell_config"
            echo "alias mac-mail-mcp=\"node '$INSTALL_DIR/mac-mail-mcp/dist/index.js'\"" >> "$shell_config"
            echo "alias mac-calendar-mcp=\"node '$INSTALL_DIR/mac-calendar-mcp/dist/index.js'\"" >> "$shell_config"
            echo "alias mac-notes-mcp=\"node '$INSTALL_DIR/mac-notes-mcp/dist/index.js'\"" >> "$shell_config"
            echo "alias mac-reminders-mcp=\"node '$INSTALL_DIR/mac-reminders-mcp/dist/index.js'\"" >> "$shell_config"
            print_message "$GREEN" "✓ Shell aliases added to $shell_config"
        else
            print_message "$GREEN" "✓ Shell aliases already configured"
        fi
    fi
    
    echo ""
}

# Create MCP configuration
create_mcp_config() {
    print_message "$YELLOW" "Creating MCP configuration..."
    
    local mcp_config_dir="$HOME/.config/mcp"
    mkdir -p "$mcp_config_dir"
    
    local config_file="$mcp_config_dir/config.json"
    
    if [[ ! -f "$config_file" ]]; then
        cat > "$config_file" << EOF
{
  "mcpServers": {
    "mac-mail": {
      "command": "node",
      "args": ["$INSTALL_DIR/mac-mail-mcp/dist/index.js"],
      "description": "Mac Mail MCP Server"
    },
    "mac-calendar": {
      "command": "node", 
      "args": ["$INSTALL_DIR/mac-calendar-mcp/dist/index.js"],
      "description": "Mac Calendar MCP Server"
    },
    "mac-notes": {
      "command": "node",
      "args": ["$INSTALL_DIR/mac-notes-mcp/dist/index.js"],
      "description": "Mac Notes MCP Server"
    },
    "mac-reminders": {
      "command": "node",
      "args": ["$INSTALL_DIR/mac-reminders-mcp/dist/index.js"],
      "description": "Mac Reminders MCP Server"
    }
  }
}
EOF
        print_message "$GREEN" "✓ MCP configuration created"
    else
        print_message "$YELLOW" "⚠ MCP configuration already exists"
        print_message "$YELLOW" "  Please manually add the Mac MCP servers to: $config_file"
    fi
    
    echo ""
}

# Print final instructions
print_instructions() {
    print_message "$BLUE" "============================================"
    print_message "$GREEN" "✓ Installation complete!"
    print_message "$BLUE" "============================================"
    echo ""
    print_message "$YELLOW" "Next steps:"
    echo ""
    print_message "$YELLOW" "1. Restart your terminal or run:"
    print_message "$BLUE" "   source ~/.zshrc  # or ~/.bashrc"
    echo ""
    print_message "$YELLOW" "2. Test the services:"
    print_message "$BLUE" "   mac-mail-mcp"
    print_message "$BLUE" "   mac-calendar-mcp"
    print_message "$BLUE" "   mac-notes-mcp"
    print_message "$BLUE" "   mac-reminders-mcp"
    echo ""
    print_message "$YELLOW" "3. If you encounter permission errors:"
    print_message "$BLUE" "   - Grant Full Disk Access to Terminal"
    print_message "$BLUE" "   - System Preferences > Security & Privacy > Privacy > Full Disk Access"
    echo ""
    print_message "$YELLOW" "4. For MCP client integration, servers are configured at:"
    print_message "$BLUE" "   ~/.config/mcp/config.json"
    echo ""
    print_message "$YELLOW" "Documentation: https://github.com/xxyjoel/mac-mcp"
}

# Main installation flow
main() {
    print_header
    check_requirements
    check_permissions
    setup_repository
    install_dependencies
    build_services
    test_services
    setup_shell_integration
    create_mcp_config
    print_instructions
}

# Run main function
main