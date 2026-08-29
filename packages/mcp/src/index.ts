import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { LaqiConfig } from '@laqi/schema'
import { createMcpServer } from './server'

export { importOpenapi, toLaqiPath, type ImportResult, type ImportedEndpoint } from './openapi'
export { Project, type EndpointView, type ProjectResult } from '@laqi/core'
export { createMcpServer } from './server'

/**
 * Starts the MCP server over stdio.
 *
 * stdout is the protocol channel: any stray `console.log` corrupts it.
 * Anything that needs to say something goes to stderr.
 */
export async function startMcpStdio(options: { root: string; config: LaqiConfig }): Promise<void> {
  const server = createMcpServer(options)
  await server.connect(new StdioServerTransport())
}
