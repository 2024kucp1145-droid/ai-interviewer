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
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['*']
  }));

  // Diagnostic request logger for Claude Connectors
  app.use((req, res, next) => {
    console.log(`[MCP HTTP ${req.method}] ${req.url} - Headers:`, {
      accept: req.headers.accept,
      host: req.headers.host,
      'user-agent': req.headers['user-agent']
    });
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Helper to dynamically derive base URL
  function getBaseUrl(req) {
    const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`;
    return `${proto}://${host}`;
  }

  // --- RFC 8414 & RFC 7591: Claude.ai OAuth 2.1 & Dynamic Client Registration Suite ---
  const oauthMetadataHandler = (req, res) => {
    const base = getBaseUrl(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      jwks_uri: `${base}/oauth/jwks`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256', 'plain'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      scopes_supported: ['mcp', 'tools', 'read', 'write']
    });
  };

  app.get([
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
    '/.well-known/oauth-authorization-server/mcp',
    '/.well-known/oauth-authorization-server/sse',
    '/mcp/.well-known/oauth-authorization-server',
    '/sse/.well-known/oauth-authorization-server'
  ], oauthMetadataHandler);

  // RFC 7591: Dynamic Client Registration
  app.post(['/oauth/register', '/mcp/oauth/register', '/register'], (req, res) => {
    const base = getBaseUrl(req);
    const body = req.body || {};
    const clientId = `claude_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const clientSecret = `sec_${Math.random().toString(36).substring(2, 16)}`;
    
    console.log('[MCP OAuth] Dynamic Client Registration received from Claude:', body);
    
    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: body.client_name || 'Claude Web Connector',
      redirect_uris: body.redirect_uris || ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    });
  });

  // OAuth Authorization Endpoint
  app.get(['/oauth/authorize', '/mcp/oauth/authorize'], (req, res) => {
    const { redirect_uri, state, code_challenge, client_id } = req.query;
    console.log('[MCP OAuth] Authorization request from Claude:', { redirect_uri, state, client_id });

    if (!redirect_uri) {
      return res.status(400).send('Missing redirect_uri');
    }

    // Auto-approve and redirect back to Claude callback with auth code
    const authCode = `auth_code_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    try {
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('code', authCode);
      if (state) {
        redirectUrl.searchParams.set('state', state);
      }
      console.log('[MCP OAuth] Auto-approving & redirecting back to Claude:', redirectUrl.toString());
      res.redirect(redirectUrl.toString());
    } catch (urlErr) {
      console.error('[MCP OAuth] Invalid redirect URL:', redirect_uri);
      res.status(400).send('Invalid redirect_uri format');
    }
  });

  // OAuth Token Endpoint
  app.post(['/oauth/token', '/mcp/oauth/token'], (req, res) => {
    console.log('[MCP OAuth] Token exchange request from Claude');
    res.json({
      access_token: `mcp_token_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`,
      token_type: 'Bearer',
      expires_in: 86400 * 30, // 30 days
      refresh_token: `mcp_refresh_${Date.now()}`
    });
  });

  // JWKS Endpoint
  app.get(['/oauth/jwks', '/mcp/oauth/jwks'], (req, res) => {
    res.json({ keys: [] });
  });

  // Track active SSE transports by sessionId
  const sseTransports = new Map();

  // 1. Health Probe & Info
  app.get(['/', '/health'], (req, res, next) => {
    if (req.path === '/' && req.headers.accept && req.headers.accept.includes('text/event-stream')) {
      return next();
    }
    res.json({
      status: 'ok',
      service: 'roundone-mcp-server',
      version: '1.0.0',
      active_sse_sessions: sseTransports.size,
      endpoints: {
        mcp: '/mcp',
        sse: '/sse',
        message: '/message',
        tools: '/tools',
        openapi: '/openapi.json'
      },
      timestamp: new Date().toISOString()
    });
  });

  // 2. Standard MCP Server-Sent Events (SSE) Stream
  // Accepts GET on /mcp, /sse, or / (if Accept: text/event-stream)
  app.get(['/sse', '/mcp', '/'], async (req, res) => {
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
  // Accepts POST on /message or /mcp with ?sessionId=...
  app.post(['/message', '/mcp'], async (req, res) => {
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
