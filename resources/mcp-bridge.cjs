#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports --
   Plain CommonJS run directly by Node outside the bundler, so it cannot use ES imports or types. */
// Storybound MCP stdio bridge.
//
// Claude Desktop and Claude Code launch this with Storybound's own executable in Node mode
// (ELECTRON_RUN_AS_NODE=1). It relays newline-delimited JSON-RPC from stdin to the running
// app's loopback MCP endpoint, reading the live port and access token from agent-bridge.json
// on every message, so token changes and restarts never need the Claude config edited. When
// Storybound is closed it answers the handshake from the cached tool list and only opens the
// app when a tool is actually called.
'use strict'

const { spawn } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const http = require('node:http')
const { homedir } = require('node:os')
const { dirname, join } = require('node:path')
const readline = require('node:readline')

const LAUNCH_TIMEOUT_MS = 30_000
const REQUEST_TIMEOUT_MS = 120_000

function defaultConfigPath() {
  const home = homedir()
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Storybound', 'agent-bridge.json')
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA || join(home, 'AppData', 'Roaming'),
      'Storybound',
      'agent-bridge.json'
    )
  }
  return join(
    process.env.XDG_CONFIG_HOME || join(home, '.config'),
    'Storybound',
    'agent-bridge.json'
  )
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const configPath = argument('--config') || defaultConfigPath()
const toolsCachePath = join(dirname(configPath), 'mcp-tools.json')

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function rpcError(id, message, code = -32000) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function toolMessage(id, text) {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } }
}

function post(port, token, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8')
          })
        )
      }
    )
    request.on('timeout', () => request.destroy(new Error('Storybound did not respond in time.')))
    request.on('error', reject)
    request.end(body)
  })
}

function launchStorybound() {
  const executable = process.execPath
  const packaged = __filename.includes('app.asar.unpacked')
  const bundle = executable.includes('.app/Contents/MacOS/')
    ? executable.slice(0, executable.indexOf('.app/Contents/MacOS/') + 4)
    : null
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  // macOS: `open -g` starts (or simply re-activates) the app without stealing focus. Elsewhere
  // Storybound's single-instance lock makes a second launch a harmless no-op.
  const child =
    process.platform === 'darwin' && packaged && bundle
      ? spawn('open', ['-g', '-a', bundle], { detached: true, stdio: 'ignore', env })
      : spawn(executable, packaged ? [] : [dirname(dirname(__filename))], {
          detached: true,
          stdio: 'ignore',
          env
        })
  child.on('error', () => undefined)
  child.unref()
}

async function waitForPort() {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS
  while (Date.now() < deadline) {
    const config = readJson(configPath)
    if (config && config.mcpEnabled && config.activePort) return config
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

function answerLocally(message) {
  const cache = readJson(toolsCachePath)
  if (message.method === 'ping') return { jsonrpc: '2.0', id: message.id, result: {} }
  if (!cache) return undefined
  if (message.method === 'initialize') {
    const requested = message.params && message.params.protocolVersion
    const protocolVersion = cache.protocolVersions.includes(requested)
      ? requested
      : cache.protocolVersions[0]
    return { jsonrpc: '2.0', id: message.id, result: { ...cache.initialize, protocolVersion } }
  }
  if (message.method === 'tools/list') {
    return { jsonrpc: '2.0', id: message.id, result: { tools: cache.tools } }
  }
  return undefined
}

async function relay(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    send(rpcError(null, 'Parse error', -32700))
    return
  }
  const isRequest = message && message.id !== undefined && typeof message.method === 'string'
  let config = readJson(configPath)

  if (!config || !config.mcpEnabled || !config.activePort) {
    if (!isRequest) return
    const local = answerLocally(message)
    if (local) {
      send(local)
      return
    }
    if (config && !config.mcpEnabled) {
      const text =
        'Storybound’s Claude connection is switched off. Open Storybound → Settings → AI assistants and turn on “Connect Claude”.'
      send(
        message.method === 'tools/call' ? toolMessage(message.id, text) : rpcError(message.id, text)
      )
      return
    }
    launchStorybound()
    config = await waitForPort()
    if (!config) {
      const text = 'Storybound did not start. Open the Storybound app and try again.'
      send(
        message.method === 'tools/call' ? toolMessage(message.id, text) : rpcError(message.id, text)
      )
      return
    }
  }

  try {
    const response = await post(config.activePort, config.token, line)
    if (response.status === 202) return
    if (response.status === 200) {
      process.stdout.write(`${response.body.trim()}\n`)
      return
    }
    if (isRequest) {
      send(
        rpcError(
          message.id,
          `Storybound refused the request (${response.status}): ${response.body}`
        )
      )
    }
  } catch (error) {
    if (isRequest) {
      send(rpcError(message.id, `Storybound could not be reached: ${error.message}`))
    }
  }
}

let queue = Promise.resolve()
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  if (!line.trim()) return
  queue = queue.then(() => relay(line))
})
input.on('close', () => {
  void queue.then(() => process.exit(0))
})

if (!existsSync(configPath)) {
  process.stderr.write(`Storybound bridge: no settings file at ${configPath} yet.\n`)
}
