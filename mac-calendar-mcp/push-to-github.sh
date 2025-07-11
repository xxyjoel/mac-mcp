#!/bin/bash

echo "📦 Mac Calendar MCP - GitHub Push Helper"
echo "========================================"
echo ""
echo "Please create a new repository on GitHub:"
echo "👉 https://github.com/new"
echo ""
echo "Repository name: mac-calendar-mcp"
echo "Description: High-performance MCP server for secure, read-only access to macOS Calendar"
echo "Public/Private: Your choice"
echo "DO NOT initialize with README, .gitignore, or license"
echo ""
read -p "Press enter once you've created the repository..."

echo ""
read -p "Enter your GitHub username: " username

echo ""
echo "Adding remote origin..."
git remote add origin "https://github.com/${username}/mac-calendar-mcp.git"

echo "Pushing to GitHub..."
git push -u origin main

echo ""
echo "✅ Successfully pushed to GitHub!"
echo ""
echo "Your repository is now available at:"
echo "https://github.com/${username}/mac-calendar-mcp"
echo ""
echo "Next steps:"
echo "1. Add topics: mcp, macos, calendar, swift, typescript"
echo "2. Update the README.md clone URL to use your username"
echo "3. Consider enabling GitHub Actions for CI/CD"