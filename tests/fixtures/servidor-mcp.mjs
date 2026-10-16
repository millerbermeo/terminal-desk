// Servidor MCP mínimo por stdio para las pruebas.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const s = new McpServer({ name: 'prueba', version: '1.0.0' })
s.registerTool('sumar', { description: 'Suma dos números', inputSchema: { a: z.number(), b: z.number() } }, async ({ a, b }) => ({
  content: [{ type: 'text', text: String(a + b) }]
}))
s.registerTool('fallar', { description: 'Siempre falla', inputSchema: {} }, async () => ({
  isError: true,
  content: [{ type: 'text', text: 'boom' }]
}))
await s.connect(new StdioServerTransport())
