#!/bin/bash

# Mac MCP Suite Uninstaller
# Removes Mac MCP Suite from your system

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
    print_message "$BLUE" "    Mac MCP Suite Uninstaller"
    print_message "$BLUE" "============================================"
    echo ""
}

# Confirm uninstall
confirm_uninstall() {
    print_message "$YELLOW" "This will remove Mac MCP Suite from your system."
    print_message "$YELLOW" "The following will be removed:"
    echo ""
    print_message "$YELLOW" "  - Installation directory: $INSTALL_DIR"
    print_message "$YELLOW" "  - Shell aliases from ~/.zshrc or ~/.bashrc"
    print_message "$YELLOW" "  - MCP configuration entries"
    print_message "$YELLOW" "  - Cache directories"
    echo ""
    print_message "$RED" "This action cannot be undone!"
    echo ""
    read -p "Are you sure you want to continue? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_message "$YELLOW" "Uninstall cancelled."
        exit 0
    fi
}

# Remove installation directory
remove_installation() {
    print_message "$YELLOW" "Removing installation directory..."
    
    if [[ -d "$INSTALL_DIR" ]]; then
        rm -rf "$INSTALL_DIR"
        print_message "$GREEN" "✓ Installation directory removed"
    else
        print_message "$YELLOW" "⚠ Installation directory not found"
    fi
    
    echo ""
}

# Remove shell integration
remove_shell_integration() {
    print_message "$YELLOW" "Removing shell integration..."
    
    # Detect shell config files
    local shell_configs=()
    [[ -f "$HOME/.zshrc" ]] && shell_configs+=("$HOME/.zshrc")
    [[ -f "$HOME/.bashrc" ]] && shell_configs+=("$HOME/.bashrc")
    
    for config in "${shell_configs[@]}"; do
        if grep -q "mac-mcp" "$config" 2>/dev/null; then
            # Create backup
            cp "$config" "$config.mac-mcp-backup"
            
            # Remove Mac MCP lines
            sed -i '' '/# Mac MCP Suite/,/alias mac-reminders-mcp=/d' "$config"
            
            print_message "$GREEN" "✓ Removed from $config (backup: $config.mac-mcp-backup)"
        fi
    done
    
    echo ""
}

# Remove MCP configuration
remove_mcp_config() {
    print_message "$YELLOW" "Removing MCP configuration..."
    
    local config_file="$HOME/.config/mcp/config.json"
    
    if [[ -f "$config_file" ]]; then
        # Create backup
        cp "$config_file" "$config_file.mac-mcp-backup"
        
        # Use Python to remove Mac MCP entries from JSON
        python3 -c "
import json
import sys

try:
    with open('$config_file', 'r') as f:
        config = json.load(f)
    
    # Remove Mac MCP servers
    servers_to_remove = ['mac-mail', 'mac-calendar', 'mac-notes', 'mac-reminders']
    
    if 'mcpServers' in config:
        for server in servers_to_remove:
            config['mcpServers'].pop(server, None)
    
    # Write back
    with open('$config_file', 'w') as f:
        json.dump(config, f, indent=2)
    
    print('✓ MCP configuration cleaned')
except Exception as e:
    print(f'⚠ Could not clean MCP configuration: {e}')
" || print_message "$YELLOW" "⚠ Could not clean MCP configuration automatically"
        
        print_message "$YELLOW" "  Backup saved to: $config_file.mac-mcp-backup"
    else
        print_message "$YELLOW" "⚠ MCP configuration not found"
    fi
    
    echo ""
}

# Remove cache directories
remove_cache() {
    print_message "$YELLOW" "Removing cache directories..."
    
    local cache_dirs=(
        "$HOME/.mac-calendar-mcp"
        "$HOME/.mac-mail-mcp"
        "$HOME/.mac-notes-mcp"
        "$HOME/.mac-reminders-mcp"
    )
    
    for dir in "${cache_dirs[@]}"; do
        if [[ -d "$dir" ]]; then
            rm -rf "$dir"
            print_message "$GREEN" "✓ Removed cache: $dir"
        fi
    done
    
    echo ""
}

# Print completion message
print_completion() {
    print_message "$BLUE" "============================================"
    print_message "$GREEN" "✓ Uninstall complete!"
    print_message "$BLUE" "============================================"
    echo ""
    print_message "$YELLOW" "Mac MCP Suite has been removed from your system."
    echo ""
    print_message "$YELLOW" "Backup files created:"
    
    [[ -f "$HOME/.zshrc.mac-mcp-backup" ]] && print_message "$BLUE" "  - ~/.zshrc.mac-mcp-backup"
    [[ -f "$HOME/.bashrc.mac-mcp-backup" ]] && print_message "$BLUE" "  - ~/.bashrc.mac-mcp-backup"
    [[ -f "$HOME/.config/mcp/config.json.mac-mcp-backup" ]] && print_message "$BLUE" "  - ~/.config/mcp/config.json.mac-mcp-backup"
    
    echo ""
    print_message "$YELLOW" "You may want to restart your terminal to clear aliases from memory."
}

# Main uninstall flow
main() {
    print_header
    confirm_uninstall
    remove_installation
    remove_shell_integration
    remove_mcp_config
    remove_cache
    print_completion
}

# Run main function
main