const { spawn } = require('child_process');
const readline = require('readline');

// Start the MCP server
const server = spawn('node', ['dist/index.js']);

// Create readline interface for server output
const rl = readline.createInterface({
  input: server.stdout,
  crlfDelay: Infinity
});

let initialized = false;

// Handle server output
rl.on('line', (line) => {
  console.log('Server:', line);
  
  if (line.includes('Calendar permissions verified') && !initialized) {
    initialized = true;
    
    // Test 1: List events from Personal calendar for Jan 6-12, 2025
    const request1 = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'list_events',
        arguments: {
          calendarName: 'Personal',
          startDate: '2025-01-06',
          endDate: '2025-01-12'
        }
      },
      id: 1
    };
    
    console.log('\n=== Test 1: Personal calendar for Jan 6-12, 2025 ===');
    console.log('Request:', JSON.stringify(request1, null, 2));
    server.stdin.write(JSON.stringify(request1) + '\n');
    
    // After a delay, test all calendars
    setTimeout(() => {
      const request2 = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'list_events',
          arguments: {
            startDate: '2025-01-06',
            endDate: '2025-01-12'
          }
        },
        id: 2
      };
      
      console.log('\n=== Test 2: All calendars for Jan 6-12, 2025 ===');
      console.log('Request:', JSON.stringify(request2, null, 2));
      server.stdin.write(JSON.stringify(request2) + '\n');
    }, 3000);
    
    // Exit after tests
    setTimeout(() => {
      server.kill();
      process.exit(0);
    }, 10000);
  }
  
  // Parse JSON responses
  try {
    const response = JSON.parse(line);
    if (response.id) {
      console.log(`\nResponse for request ${response.id}:`, JSON.stringify(response, null, 2));
    }
  } catch (e) {
    // Not JSON, ignore
  }
});

server.stderr.on('data', (data) => {
  console.error('Server error:', data.toString());
});

server.on('close', (code) => {
  console.log(`Server exited with code ${code}`);
});