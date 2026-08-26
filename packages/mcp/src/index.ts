import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { LaqiConfig } from '@laqi/schema'
import { createMcpServer } from './server'

export { importOpenapi, toLaqiPath, type ImportResult, type ImportedEndpoint } from './openapi'
export { Project, type EndpointView, type ProjectResult } from './project'
export { createMcpServer } from './server'

/**
 * Arranca el servidor MCP sobre stdio.
 *
 * stdout es el canal del protocolo: cualquier `console.log` suelto lo
 * corrompe. Todo lo que quiera decirse va a stderr.
 */
export async function startMcpStdio(options: { root: string; config: LaqiConfig }): Promise<void> {
  const server = createMcpServer(options)
  await server.connect(new StdioServerTransport())
}
