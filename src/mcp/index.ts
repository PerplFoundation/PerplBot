/**
 * MCP Server entry point
 * Initializes SDK and starts HTTP server with Streamable HTTP transport.
 */

import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { initSDK } from "../chatbot/sdk-bridge.js";
import { createMcpServer } from "./server.js";

const port = parseInt(process.env.MCP_PORT || "3001", 10);

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  // Create a fresh server + transport per request (stateless mode)
  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  await mcpServer.connect(transport);

  const body = await parseBody(req);
  await transport.handleRequest(req, res, body);

  // Clean up after handling
  await mcpServer.close();
}

console.log("[mcp] Initializing SDK...");
await initSDK();

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (url === "/mcp") {
    if (req.method === "POST") {
      try {
        await handleMcpRequest(req, res);
      } catch (err) {
        console.error("[mcp] Error handling request:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      }
    } else if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed. Use POST /mcp" }));
    }
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use POST /mcp" }));
  }
});

server.listen(port, () => {
  console.log(`[mcp] Server listening on http://localhost:${port}/mcp`);
});
