#!/usr/bin/env node
/**
 * RoundOne AI — Model Context Protocol (MCP) Server
 * 
 * Enables AI agents (Claude Desktop, Claude Code, ChatGPT, Cursor, Windsurf, Antigravity, etc.)
 * to interact directly with the RoundOne AI technical interview platform:
 * - Search & retrieve from 4,111+ LeetCode DSA coding challenges
 * - Run sandboxed code test harness & judge solutions (JS, Python, C++, SQL)
 * - Configure & manage technical screening rounds
 * - Track candidates, inspect scorecards, transcripts & anti-cheat proctoring logs
 * - Generate 0-100 objective evaluation rubrics
 * - Monitor platform health & billing credits
 * 
 * Supports both:
 * 1. Stdio Transport (Default for Claude Desktop, Claude Code, Cursor, Windsurf, Antigravity)
 * 2. HTTP / SSE / OpenAPI Transport (For ChatGPT Actions, remote web agents, curl)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'url';
import { registerLeetCodeTools } from './tools/leetcodeTools.js';
import { registerJudgeTools } from './tools/judgeTools.js';
import { registerInterviewTools } from './tools/interviewTools.js';
import { registerCandidateTools } from './tools/candidateTools.js';
import { registerEvaluationTools } from './tools/evaluationTools.js';
import { registerSystemTools } from './tools/systemTools.js';
import { registerCodebaseTools } from './tools/codebaseTools.js';
import { registerPrompts } from './prompts/prompts.js';
import { registerResources } from './resources/resources.js';
import { startHttpBridge } from './httpServer.js';

// 1. Initialize MCP Server
const server = new McpServer({
  name: 'roundone-ai',
  version: '1.0.0',
  description: 'RoundOne AI Autonomous Interviewer & 4,111+ LeetCode DSA Code Judge Engine'
});

// 2. Register all Tool Domains
registerLeetCodeTools(server);
registerJudgeTools(server);
registerInterviewTools(server);
registerCandidateTools(server);
registerEvaluationTools(server);
registerSystemTools(server);
registerCodebaseTools(server);

// 3. Register Prompts & Resources
registerPrompts(server);
registerResources(server);

// 4. CLI Argument & Mode Parsing
const args = process.argv.slice(2);
const isHttp = args.includes('--http') || process.env.MCP_TRANSPORT === 'http';
const isDual = args.includes('--dual') || process.env.MCP_TRANSPORT === 'dual';
const portIndex = args.indexOf('--port');
const port = portIndex !== -1 && args[portIndex + 1] ? parseInt(args[portIndex + 1], 10) : (parseInt(process.env.MCP_PORT, 10) || 3005);

async function main() {
  if (isHttp && !isDual) {
    // Run purely in HTTP / SSE / OpenAPI mode
    console.log('Starting RoundOne AI MCP Server in HTTP / SSE mode...');
    startHttpBridge(server, port);
  } else if (isDual) {
    // Run in both Stdio and HTTP mode
    console.error(`[MCP] Starting in Dual Mode (Stdio + HTTP on port ${port})...`);
    startHttpBridge(server, port);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    // Default: Stdio transport for Claude Desktop, Claude Code, Cursor, Windsurf
    // Note: Do not console.log normal text in stdio mode as it corrupts JSON-RPC stream on stdout!
    // Logging to process.stderr is safe.
    process.stderr.write(`[RoundOne MCP] Server initialized with 14 tools, 3 prompts, 3 resources. Connecting stdio...\n`);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

const isDirectRun = process.argv[1] && (
  fileURLToPath(import.meta.url) === process.argv[1] ||
  process.argv[1].endsWith('/mcp/server.js') ||
  process.argv[1].endsWith('\\mcp\\server.js')
);

if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`[RoundOne MCP Fatal Error]: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

export { server, main };
