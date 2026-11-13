/**
 * MCP HTTP & SSE Bridge Server
 * 
 * Exposes the RoundOne AI MCP Server over HTTP:
 * 1. GET /sse & POST /message: Standard MCP SSE Transport (for web MCP clients)
 * 2. GET /openapi.json: Complete OpenAPI 3.0 Spec for ChatGPT Custom GPT Actions
 * 3. GET /tools: JSON schema list of all tools
 * 4. POST /call/:toolName: Direct REST execution for HTTP-based AI agents
 * 5. GET /health: Health probe
 */

import express from 'express';
import cors from 'cors';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

export function startHttpBridge(server, port = 3005) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Track active SSE transports by sessionId
  const sseTransports = new Map();

  // 1. Health Probe
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'roundone-mcp-server',
      version: '1.0.0',
      active_sse_sessions: sseTransports.size,
      timestamp: new Date().toISOString()
    });
  });

  // 2. Standard MCP Server-Sent Events (SSE) Stream
  app.get('/sse', async (req, res) => {
    try {
      const transport = new SSEServerTransport('/message', res);
      sseTransports.set(transport.sessionId, transport);

      req.on('close', () => {
        sseTransports.delete(transport.sessionId);
      });

      await server.connect(transport);
    } catch (err) {
      console.error('[MCP HTTP] SSE error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  // 3. MCP JSON-RPC Message Receiver
  app.post('/message', async (req, res) => {
    try {
      const sessionId = req.query.sessionId;
      if (!sessionId || !sseTransports.has(sessionId)) {
        return res.status(404).json({ error: 'Active MCP SSE session not found or expired.' });
      }
      const transport = sseTransports.get(sessionId);
      await transport.handlePostMessage(req, res);
    } catch (err) {
      console.error('[MCP HTTP] Message handling error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  // 4. GET /tools: Simple JSON Tool Directory
  app.get('/tools', (req, res) => {
    const tools = [];
    if (server._registeredTools) {
      for (const [name, t] of Object.entries(server._registeredTools)) {
        tools.push({
          name,
          description: t.description || '',
          parameters: t.inputSchema || {}
        });
      }
    }
    res.json({
      server: 'roundone-ai',
      total_tools: tools.length,
      tools
    });
  });

  // 5. POST /call/:toolName: Direct REST Tool Call (Ideal for ChatGPT Actions / curl / webhooks)
  app.post('/call/:toolName', async (req, res) => {
    const { toolName } = req.params;
    const tool = server._registeredTools?.[toolName];

    if (!tool) {
      return res.status(404).json({
        error: `Tool "${toolName}" not found.`,
        available_tools: Object.keys(server._registeredTools || {})
      });
    }

    try {
      const args = req.body || {};
      const result = await tool.handler(args, {
        signal: req.signal
      });
      res.json({
        success: true,
        tool: toolName,
        result
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        tool: toolName,
        error: err.message
      });
    }
  });

  // 6. GET /openapi.json: Auto-generated OpenAPI 3.0 specification for ChatGPT Custom GPT Actions
  app.get('/openapi.json', (req, res) => {
    const host = req.get('host') || `localhost:${port}`;
    const proto = req.protocol;

    const paths = {
      '/health': {
        get: {
          summary: 'Check MCP server health',
          operationId: 'getHealth',
          responses: {
            '200': {
              description: 'Server health status'
            }
          }
        }
      }
    };

    if (server._registeredTools) {
      for (const [name, t] of Object.entries(server._registeredTools)) {
        paths[`/call/${name}`] = {
          post: {
            summary: t.description || `Call ${name}`,
            operationId: name,
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: t.inputSchema || { type: 'object' }
                }
              }
            },
            responses: {
              '200': {
                description: `Successful execution of ${name}`,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        tool: { type: 'string' },
                        result: { type: 'object' }
                      }
                    }
                  }
                }
              }
            }
          }
        };
      }
    }

    const openapi = {
      openapi: '3.0.1',
      info: {
        title: 'RoundOne AI - Interviewer & LeetCode Judge API',
        description: 'Complete API and MCP bridge for RoundOne AI technical screening platform. Access 4,111+ LeetCode DSA questions, execute and judge code, configure interviews, and manage candidate evaluations.',
        version: '1.0.0'
      },
      servers: [
        {
          url: `${proto}://${host}`,
          description: 'Local RoundOne MCP Server'
        }
      ],
      paths
    };

    res.json(openapi);
  });

  const httpServer = app.listen(port, () => {
    console.log(`[MCP HTTP] Server listening on http://localhost:${port}`);
    console.log(`[MCP HTTP] SSE Endpoint:     http://localhost:${port}/sse`);
    console.log(`[MCP HTTP] OpenAPI Spec:     http://localhost:${port}/openapi.json (Copy to ChatGPT Custom GPT Actions)`);
    console.log(`[MCP HTTP] Tools Directory:  http://localhost:${port}/tools`);
    console.log(`[MCP HTTP] Direct REST Tool: http://localhost:${port}/call/:toolName`);
  });

  return httpServer;
}
