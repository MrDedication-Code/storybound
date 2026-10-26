import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AgentActivity,
  AgentActivitySource,
  AgentBridgeStatus,
  InboxScanResult,
  UpdateAgentBridgeInput
} from '../../shared/types'
import { StoryboundError, toStoryboundError } from '../errors'
import type { AppLogger } from '../logger'
import type { StoryboundStore } from '../store'
import {
  AGENT_BRIDGE_FILE_NAME,
  createAccessToken,
  readAgentBridgeConfig,
  writeAgentBridgeConfig,
  type AgentBridgeConfig
} from './config'
import { FAILED_FOLDER, IMPORTED_FOLDER, scanInbox } from './inbox'
import {
  initializeResult,
  listToolsResult,
  MCP_PATH,
  StoryboundMcpServer,
  SUPPORTED_PROTOCOL_VERSIONS
} from './mcpServer'
import type { AgentContentChange } from './tools'

const INBOX_POLL_MILLISECONDS = 5_000
const ACTIVITY_LIMIT = 20
export const MCP_SERVER_NAME = 'storybound'
const MCP_TOOLS_CACHE_FILE_NAME = 'mcp-tools.json'

export interface AgentBridgeOptions {
  store: StoryboundStore
  dataPath: string
  version: string
  /** The Storybound executable, which runs the stdio bridge in Node mode. */
  executablePath: string
  bridgeScriptPath: string
  defaultInboxPath: string
  claudeDesktopConfigPath: string | null
  logger: AppLogger
  onChange: (change: AgentContentChange) => void
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

export const INBOX_INSTRUCTIONS = `Save each chapter as a Markdown (.md) or plain-text (.txt) file in my Storybound Inbox folder. Start every file with this header, then the chapter text:

---
book: The Exact Book Title
chapter: Chapter 1: The Chapter Title
---

Rules:
- Use exactly the same "book:" title for every chapter of the same story.
- One chapter per file. Name files so they sort in reading order, e.g. "01 Opening.md", "02 The Road.md".
- Don't repeat the chapter title as a heading inside the text.
- Optional header lines: "blurb:", "status: ongoing" or "status: completed", "series:", "series position: 2", "author:".
- To replace a chapter that already exists, add "mode: replace" and use its exact chapter title.
- A file with only a header and no text just creates the book or updates its details.`

export class AgentBridgeController {
  private config: AgentBridgeConfig
  private readonly configPath: string
  private readonly server: StoryboundMcpServer
  private mcpError: string | null = null
  private inboxError: string | null = null
  private inboxTimer: ReturnType<typeof setInterval> | null = null
  private inboxRunning = false
  private readonly activity: AgentActivity[] = []

  private constructor(private readonly options: AgentBridgeOptions) {
    this.configPath = join(options.dataPath, AGENT_BRIDGE_FILE_NAME)
    this.config = readAgentBridgeConfig(this.configPath)
    this.server = new StoryboundMcpServer({
      store: options.store,
      version: options.version,
      getToken: () => this.config.token,
      onChange: (change) => this.options.onChange(change),
      onToolCall: (message, failed) => this.record('mcp', message, failed)
    })
  }

  static async create(options: AgentBridgeOptions): Promise<AgentBridgeController> {
    const controller = new AgentBridgeController(options)
    // A previous crash may have left a stale port behind; nothing is listening until start().
    controller.save({ activePort: null })
    controller.writeToolsCache()
    await controller.applyConfig()
    return controller
  }

  status(): AgentBridgeStatus {
    const port = this.server.activePort
    return {
      mcpEnabled: this.config.mcpEnabled,
      mcpRunning: port !== null,
      mcpUrl: port === null ? null : `http://127.0.0.1:${port}${MCP_PATH}`,
      mcpError: this.mcpError,
      inboxEnabled: this.config.inboxEnabled,
      inboxPath: this.config.inboxPath,
      inboxError: this.inboxError,
      claudeCodeCommand: this.claudeCodeCommand(),
      claudeDesktopConfig: JSON.stringify(
        { mcpServers: { [MCP_SERVER_NAME]: this.serverEntry() } },
        null,
        2
      ),
      claudeDesktopConfigPath: this.options.claudeDesktopConfigPath,
      recentActivity: [...this.activity]
    }
  }

  async update(input: UpdateAgentBridgeInput): Promise<AgentBridgeStatus> {
    const changes: Partial<AgentBridgeConfig> = {}
    if (input.mcpEnabled !== undefined) changes.mcpEnabled = input.mcpEnabled
    if (input.inboxEnabled !== undefined) {
      changes.inboxEnabled = input.inboxEnabled
      if (input.inboxEnabled && !this.config.inboxPath) {
        changes.inboxPath = this.options.defaultInboxPath
      }
    }
    this.save(changes)
    await this.applyConfig()
    return this.status()
  }

  regenerateToken(): AgentBridgeStatus {
    this.save({ token: createAccessToken() })
    this.record(
      'mcp',
      'Access token regenerated. Direct HTTP connections need the new token.',
      false
    )
    return this.status()
  }

  async setInboxPath(path: string): Promise<AgentBridgeStatus> {
    this.save({ inboxPath: path, inboxEnabled: true })
    await this.applyConfig()
    return this.status()
  }

  get inboxPath(): string | null {
    return this.config.inboxPath
  }

  get accessToken(): string {
    return this.config.token
  }

  claudeCodeCommand(): string {
    return [
      'claude mcp add --scope user',
      MCP_SERVER_NAME,
      '-e ELECTRON_RUN_AS_NODE=1 --',
      shellQuote(this.options.executablePath),
      shellQuote(this.options.bridgeScriptPath),
      '--config',
      shellQuote(this.configPath)
    ].join(' ')
  }

  /** Adds (or refreshes) the Storybound entry in Claude Desktop's MCP configuration. */
  connectClaudeDesktop(): string {
    const path = this.options.claudeDesktopConfigPath
    if (!path) {
      throw new StoryboundError(
        'VALIDATION_ERROR',
        'Claude Desktop is not available on this system.'
      )
    }
    let config: Record<string, unknown> = {}
    if (existsSync(path)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
        config = parsed as Record<string, unknown>
      } catch {
        throw new StoryboundError(
          'VALIDATION_ERROR',
          'Claude Desktop’s settings file could not be read, so it was left unchanged. Use “Copy Claude Desktop config” instead.'
        )
      }
      copyFileSync(path, `${path}.storybound-backup`)
    }
    const servers =
      config.mcpServers &&
      typeof config.mcpServers === 'object' &&
      !Array.isArray(config.mcpServers)
        ? (config.mcpServers as Record<string, unknown>)
        : {}
    config.mcpServers = { ...servers, [MCP_SERVER_NAME]: this.serverEntry() }
    mkdirSync(dirname(path), { recursive: true })
    const temporaryPath = `${path}.storybound-tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`)
    renameSync(temporaryPath, path)
    this.record('mcp', 'Storybound was added to Claude Desktop.', false)
    return path
  }

  scanInboxNow(): InboxScanResult {
    if (!this.config.inboxPath) {
      throw new StoryboundError('VALIDATION_ERROR', 'Choose an inbox folder first.')
    }
    return this.runInboxScan(this.config.inboxPath)
  }

  async stop(): Promise<void> {
    this.stopInbox()
    // Clear the advertised port first and synchronously: the process may exit before the
    // server finishes closing, and the bridge must never be pointed at a dead port.
    try {
      this.save({ activePort: null })
    } catch (error) {
      this.options.logger.error('agent-bridge', error)
    }
    await this.server.stop()
  }

  private serverEntry(): Record<string, unknown> {
    return {
      command: this.options.executablePath,
      args: [this.options.bridgeScriptPath, '--config', this.configPath],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    }
  }

  /** Lets the stdio bridge answer Claude's startup handshake while Storybound is closed. */
  private writeToolsCache(): void {
    const path = join(this.options.dataPath, MCP_TOOLS_CACHE_FILE_NAME)
    const cache = {
      protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      initialize: initializeResult(this.options.version),
      tools: listToolsResult()
    }
    writeFileSync(`${path}.tmp`, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }

  private save(changes: Partial<AgentBridgeConfig>): void {
    this.config = { ...this.config, ...changes }
    writeAgentBridgeConfig(this.configPath, this.config)
  }

  private async applyConfig(): Promise<void> {
    if (this.config.mcpEnabled) {
      try {
        const port = await this.server.start(this.config.preferredPort)
        this.mcpError = null
        this.save({ activePort: port })
      } catch (error) {
        this.mcpError = `The Claude connection could not start: ${toStoryboundError(error).message}`
        this.options.logger.error('agent-bridge-mcp', error)
      }
    } else {
      await this.server.stop()
      this.mcpError = null
      this.save({ activePort: null })
    }

    this.stopInbox()
    this.inboxError = null
    const inboxPath = this.config.inboxPath
    if (this.config.inboxEnabled && inboxPath) {
      try {
        mkdirSync(inboxPath, { recursive: true })
        mkdirSync(join(inboxPath, IMPORTED_FOLDER), { recursive: true })
        mkdirSync(join(inboxPath, FAILED_FOLDER), { recursive: true })
        this.inboxTimer = setInterval(() => this.pollInbox(inboxPath), INBOX_POLL_MILLISECONDS)
        this.pollInbox(inboxPath)
      } catch (error) {
        this.inboxError = `The inbox folder could not be prepared: ${toStoryboundError(error).message}`
        this.options.logger.error('agent-bridge-inbox', error)
      }
    }
  }

  private pollInbox(inboxPath: string): void {
    try {
      this.runInboxScan(inboxPath)
      this.inboxError = null
    } catch (error) {
      this.inboxError = toStoryboundError(error).message
    }
  }

  private runInboxScan(inboxPath: string): InboxScanResult {
    if (this.inboxRunning) return { imported: 0, failed: 0, skipped: 0 }
    this.inboxRunning = true
    try {
      return scanInbox(this.options.store, inboxPath, {
        onChange: (change) => this.options.onChange(change),
        onActivity: (message, failed) => this.record('inbox', message, failed)
      })
    } finally {
      this.inboxRunning = false
    }
  }

  private stopInbox(): void {
    if (this.inboxTimer) clearInterval(this.inboxTimer)
    this.inboxTimer = null
  }

  private record(source: AgentActivitySource, message: string, failed: boolean): void {
    this.activity.unshift({ at: new Date().toISOString(), source, message, failed })
    this.activity.splice(ACTIVITY_LIMIT)
    if (failed) this.options.logger.info(`agent-bridge-${source}`, message)
  }
}
