const { spawn } = require('child_process');
const readline = require('readline');

// Start the MCP server
const server = spawn('node', ['dist/index.js']);

// Create readline interface for stdin/stdout
const rl = readline.createInterface({
  input: server.stdout,
  output: process.stdout
});

let messageBuffer = '';

server.stdout.on('data', (data) => {
  messageBuffer += data.toString();
  
  // Try to parse complete JSON-RPC messages
  const lines = messageBuffer.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('Washington Law MCP Server')) {
      try {
        const response = JSON.parse(line);
        console.log('Response:', JSON.stringify(response, null, 2));
      } catch (e) {
        // Not JSON, just log it
        if (line) console.log('Server:', line);
      }
    }
  }
  messageBuffer = lines[lines.length - 1];
});

server.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg && !msg.includes('MCP Server started')) {
    console.error('Error:', msg);
  }
});

// Test various tools
async function testTools() {
  console.log('\n=== Testing MCP Server Tools ===\n');
  
  // Test 1: Initialize
  const initRequest = {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    },
    id: 1
  };
  
  server.stdin.write(JSON.stringify(initRequest) + '\n');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Test 2: List tools
  const listToolsRequest = {
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
    id: 2
  };
  
  server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Test 3: Get specific RCW
  const getRCWRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'get_rcw',
      arguments: {
        citation: '9.41.010'
      }
    },
    id: 3
  };
  
  console.log('\n--- Testing get_rcw for 9.41.010 ---');
  server.stdin.write(JSON.stringify(getRCWRequest) + '\n');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Test 4: Search laws
  const searchRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'search_laws',
      arguments: {
        query: 'firearm possession',
        limit: 5
      }
    },
    id: 4
  };
  
  console.log('\n--- Testing search_laws for "firearm possession" ---');
  server.stdin.write(JSON.stringify(searchRequest) + '\n');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Test 5: List titles
  const listTitlesRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'list_rcw_titles',
      arguments: {}
    },
    id: 5
  };
  
  console.log('\n--- Testing list_rcw_titles ---');
  server.stdin.write(JSON.stringify(listTitlesRequest) + '\n');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Test 6: List chapters in Title 9
  const listChaptersRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'list_rcw_chapters',
      arguments: {
        titleNum: '9'
      }
    },
    id: 6
  };
  
  console.log('\n--- Testing list_rcw_chapters for Title 9 ---');
  server.stdin.write(JSON.stringify(listChaptersRequest) + '\n');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Test 7: Get statistics
  const statsRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'get_statistics',
      arguments: {}
    },
    id: 7
  };
  
  console.log('\n--- Testing get_statistics ---');
  server.stdin.write(JSON.stringify(statsRequest) + '\n');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Clean up
  server.kill();
  process.exit(0);
}

// Run tests after server starts
setTimeout(testTools, 1000);