import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

export const AGENT_BRIDGE_FILE_NAME = 'agent-bridge.json'
export const DEFAULT_MCP_PORT = 47821

// Kept beside the database rather than inside it: library backups and exports never carry the
// access token, and the stdio bridge that Claude launches can read the live port and token
// without opening SQLite while Storybound holds it.
const configSchema = z.object({
  version: z.literal(1),
  mcpEnabled: z.boolean(),
  token: z.string().min(32).max(200),
  preferredPort: z.number().int().min(1024).max(65535),
  activePort: z.number().int().min(1).max(65535).nullable(),
  inboxEnabled: z.boolean(),
  inboxPath: z.string().min(1).max(4096).nullable()
})

export type AgentBridgeConfig = z.infer<typeof configSchema>

export function createAccessToken(): string {
  return randomBytes(32).toString('base64url')
}

export function defaultAgentBridgeConfig(): AgentBridgeConfig {
  return {
    version: 1,
    mcpEnabled: false,
    token: createAccessToken(),
    preferredPort: DEFAULT_MCP_PORT,
    activePort: null,
    inboxEnabled: false,
    inboxPath: null
  }
}

export function readAgentBridgeConfig(path: string): AgentBridgeConfig {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultAgentBridgeConfig()
    throw error
  }
  const parsed = configSchema.safeParse(JSON.parse(raw))
  // A damaged file only loses connection preferences, never story data, so fall back to safe
  // defaults (everything off, fresh token) instead of blocking startup.
  return parsed.success ? parsed.data : defaultAgentBridgeConfig()
}

export function writeAgentBridgeConfig(path: string, config: AgentBridgeConfig): void {
  const validated = configSchema.parse(config)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, path)
}
