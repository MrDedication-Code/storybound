import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import { toStoryboundError } from '../errors'
import type { StoryboundStore } from '../store'
import {
  AGENT_TOOLS,
  MCP_SERVER_INSTRUCTIONS,
  toolInputSchema,
  type AgentContentChange
} from './tools'

export const MCP_PATH = '/mcp'
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY_BYTES = 32 * 1024 * 1024

interface JsonRpcMessage {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

type JsonRpcId = string | number

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  result?: unknown
  error?: { code: number; message: string }
}

export interface McpServerOptions {
  store: StoryboundStore
  version: string
  getToken: () => string
  onChange: (change: AgentContentChange) => void
  onToolCall: (message: string, failed: boolean) => void
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function tokensMatch(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body is too large.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function rpcError(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function isRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number'
}

export function initializeResult(version: string): Record<string, unknown> {
  return {
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'storybound', title: 'Storybound', version },
    instructions: MCP_SERVER_INSTRUCTIONS
  }
}

export function listToolsResult(): Record<string, unknown>[] {
  return AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: toolInputSchema(tool),
    annotations: { title: tool.title, ...tool.annotations }
  }))
}

export class StoryboundMcpServer {
  private server: Server | null = null
  private port: number | null = null

  constructor(private readonly options: McpServerOptions) {}

  get activePort(): number | null {
    return this.port
  }

  async start(preferredPort: number): Promise<number> {
    if (this.server && this.port) return this.port
    try {
      return await this.listen(preferredPort)
    } catch (error) {
      // Another program owns the preferred port; any free port works because the stdio
      // bridge reads the live port from the bridge file on every request.
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      return this.listen(0)
    }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.port = null
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.handle(request, response)
      })
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        this.server = server
        this.port = (server.address() as AddressInfo).port
        resolve(this.port)
      })
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      this.authorize(request)
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST' }).end()
        return
      }
      let payload: unknown
      try {
        payload = JSON.parse(await readBody(request))
      } catch (error) {
        if (error instanceof HttpError) throw error
        this.sendJson(response, rpcError(null, -32700, 'Parse error'))
        return
      }
      if (Array.isArray(payload)) {
        const replies = payload
          .map((message) => this.dispatch(message))
          .filter((reply): reply is JsonRpcResponse => reply !== null)
        if (replies.length === 0) response.writeHead(202).end()
        else this.sendJson(response, replies)
        return
      }
      const reply = this.dispatch(payload)
      if (reply) this.sendJson(response, reply)
      else response.writeHead(202).end()
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'Internal server error.'
      if (!response.headersSent) {
        response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
      }
      response.end(message)
    }
  }

  private authorize(request: IncomingMessage): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== MCP_PATH) throw new HttpError(404, 'Not found.')
    // Browsers always send Origin; MCP clients do not. Refusing any Origin, and any Host other
    // than this loopback port, blocks web pages and DNS-rebinding attempts from reaching the
    // library even before the token check.
    if (request.headers.origin !== undefined)
      throw new HttpError(403, 'Browser requests are not accepted.')
    const host = request.headers.host ?? ''
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
      throw new HttpError(403, 'Unexpected host.')
    }
    const header = request.headers.authorization ?? ''
    const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!supplied || !tokensMatch(supplied, this.options.getToken())) {
      throw new HttpError(401, 'A valid Storybound access token is required.')
    }
  }

  private sendJson(response: ServerResponse, body: unknown): void {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  }

  private dispatch(message: unknown): JsonRpcResponse | null {
    if (!message || typeof message !== 'object') return rpcError(null, -32600, 'Invalid Request')
    const { jsonrpc, id, method, params } = message as JsonRpcMessage
    const replyId = isRpcId(id) ? id : null
    if (jsonrpc !== '2.0' || typeof method !== 'string') {
      // Responses from the client (it never needs to send any) carry no method: ignore them.
      return method === undefined && id !== undefined
        ? null
        : rpcError(replyId, -32600, 'Invalid Request')
    }
    const isNotification = id === undefined
    if (isNotification) return null
    if (!isRpcId(id)) return rpcError(null, -32600, 'Invalid Request')

    switch (method) {
      case 'initialize': {
        const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion
        const protocolVersion =
          typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : SUPPORTED_PROTOCOL_VERSIONS[0]
        return {
          jsonrpc: '2.0',
          id,
          result: { protocolVersion, ...initializeResult(this.options.version) }
        }
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: listToolsResult() } }
      case 'tools/call':
        return { jsonrpc: '2.0', id, result: this.callTool(params) }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`)
    }
  }

  private callTool(params: unknown): Record<string, unknown> {
    const { name, arguments: input } = (params ?? {}) as { name?: unknown; arguments?: unknown }
    const tool = AGENT_TOOLS.find((candidate) => candidate.name === name)
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${String(name)}` }],
        isError: true
      }
    }
    try {
      const result = tool.run(this.options.store, input)
      if (result.change) {
        this.options.onChange(result.change)
        this.options.onToolCall(result.change.message, false)
      }
      return { content: [{ type: 'text', text: result.text }] }
    } catch (error) {
      const message = toStoryboundError(error).message
      if (!tool.annotations.readOnlyHint) {
        this.options.onToolCall(`Claude could not ${tool.title.toLowerCase()}: ${message}`, true)
      }
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  }
}
