import { resolve, join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { APP_NAME } from '../shared/types'
import { closeReadySchema } from '../shared/validation'
import { APP_CLOSE_READY_CHANNEL, MENU_COMMAND_CHANNEL, type MenuCommand } from './channels'
import { createStoryboundPaths } from './database'
import { registerStoryboundIpc } from './ipc'
import { AppLogger } from './logger'
import { registerMediaProtocol } from './media-protocol'
import { StoryboundStore } from './store'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'storybound-media',
    privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true }
  }
])

app.setName(APP_NAME)

const userDataOverride = process.env.STORYBOUND_USER_DATA?.trim()
if (userDataOverride) app.setPath('userData', resolve(userDataOverride))

let mainWindow: BrowserWindow | null = null
let store: StoryboundStore | null = null
let logger: AppLogger | null = null
let unregisterIpc: (() => void) | null = null
let isQuitting = false
let backupTimer: ReturnType<typeof setInterval> | null = null
let backupRunning = false

async function runScheduledBackups(): Promise<void> {
  if (!store || backupRunning || isQuitting) return
  backupRunning = true
  try {
    await store.runDueBackups(app.getVersion())
  } catch (error) {
    logger?.error('scheduled-backup', error)
  } finally {
    backupRunning = false
  }
}

function sendMenuCommand(command: MenuCommand): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(MENU_COMMAND_CHANNEL, command)
  }
}

function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'CommandOrControl+,',
                click: (): void => sendMenuCommand('settings')
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Book',
          accelerator: 'CommandOrControl+N',
          click: (): void => sendMenuCommand('new-book')
        },
        {
          label: 'New Chapter',
          accelerator: 'CommandOrControl+Shift+N',
          click: (): void => sendMenuCommand('new-chapter')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CommandOrControl+S',
          click: (): void => sendMenuCommand('save')
        },
        ...(process.platform === 'darwin'
          ? []
          : [
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'CommandOrControl+,',
                click: (): void => sendMenuCommand('settings')
              },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find in Chapter',
          accelerator: 'CommandOrControl+F',
          click: (): void => sendMenuCommand('find')
        },
        {
          label: 'Search Library',
          accelerator: 'CommandOrControl+K',
          click: (): void => sendMenuCommand('search-library')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...(is.dev
          ? ([
              { role: 'reload' },
              { role: 'forceReload' },
              { role: 'toggleDevTools' }
            ] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'close' }]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Getting Started',
          click: (): void => sendMenuCommand('help')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  if (!is.dev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: storybound-media:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'"
          ]
        }
      })
    })
  }
}

function createWindow(): BrowserWindow {
  let allowClose = false
  let closePending = false
  let closePromptTimer: ReturnType<typeof setTimeout> | undefined
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 560,
    show: false,
    title: 'Storybound',
    backgroundColor: '#17130f',
    autoHideMenuBar: process.platform !== 'darwin',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocolName = new URL(url).protocol
      if (protocolName === 'https:' || protocolName === 'http:') void shell.openExternal(url)
    } catch {
      // Ignore malformed and non-web links.
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.webContents.on('before-input-event', (event, input) => {
    if (
      !is.dev &&
      (input.key === 'F5' ||
        input.key === 'F12' ||
        ((input.control || input.meta) && input.key.toLocaleLowerCase() === 'r'))
    ) {
      event.preventDefault()
    }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    logger?.error('renderer-process', new Error(`Renderer exited: ${details.reason}`))
  })

  const clearClosePrompt = (): void => {
    if (closePromptTimer) clearTimeout(closePromptTimer)
    closePromptTimer = undefined
  }
  const cancelClose = (): void => {
    clearClosePrompt()
    closePending = false
    isQuitting = false
  }
  const finishClose = (): void => {
    if (!closePending || window.isDestroyed()) return
    clearClosePrompt()
    closePending = false
    allowClose = true
    if (isQuitting) app.quit()
    else window.close()
  }
  ipcMain.handle(APP_CLOSE_READY_CHANNEL, (event, ready: unknown) => {
    const parsed = closeReadySchema.safeParse(ready)
    if (event.sender !== window.webContents || !parsed.success) {
      return {
        ok: false,
        error: 'Storybound rejected an invalid close confirmation.',
        code: 'VALIDATION_ERROR'
      }
    }
    if (!closePending) {
      return {
        ok: false,
        error: 'Storybound is not waiting to close.',
        code: 'CONFLICT'
      }
    }
    if (parsed.data) setImmediate(finishClose)
    else cancelClose()
    return { ok: true, data: undefined }
  })
  window.on('close', (event) => {
    if (allowClose || window.webContents.isDestroyed()) return
    event.preventDefault()
    if (closePending) return
    closePending = true
    window.webContents.send(MENU_COMMAND_CHANNEL, 'prepare-close' satisfies MenuCommand)
    closePromptTimer = setTimeout(() => {
      if (!closePending || window.isDestroyed()) return
      void dialog
        .showMessageBox(window, {
          type: 'warning',
          title: 'Storybound is still saving',
          message: 'Storybound has not finished saving your latest changes.',
          detail: 'Keep the app open and try again, or close now knowing recent edits may be lost.',
          buttons: ['Keep Storybound open', 'Close without saving'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        .then(({ response }) => {
          if (!closePending) return
          if (response === 1) finishClose()
          else cancelClose()
        })
    }, 8_000)
  })
  window.on('closed', () => {
    clearClosePrompt()
    ipcMain.removeHandler(APP_CLOSE_READY_CHANNEL)
    if (mainWindow === window) mainWindow = null
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

async function start(): Promise<void> {
  electronApp.setAppUserModelId('com.storybound.desktop')
  const paths = createStoryboundPaths(app.getPath('userData'))
  logger = new AppLogger(paths.logs)
  logger.info('startup', `Starting ${app.getName()} ${app.getVersion()}`)

  try {
    store = await StoryboundStore.open(paths.root)
  } catch (error) {
    logger.error('startup', error)
    dialog.showErrorBox(
      'Storybound could not open your library',
      'Your story files have not been changed. Check the Storybound log in the application data folder for details.'
    )
    app.quit()
    return
  }

  configureSessionSecurity()
  registerMediaProtocol(store.paths.media, logger)
  unregisterIpc = registerStoryboundIpc({ store, logger, getWindow: () => mainWindow })
  installApplicationMenu()
  mainWindow = createWindow()
  setTimeout(() => void runScheduledBackups(), 10_000)
  backupTimer = setInterval(() => void runScheduledBackups(), 15 * 60_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
}

app
  .whenReady()
  .then(start)
  .catch((error) => {
    logger?.error('startup', error)
    dialog.showErrorBox('Storybound could not start', 'Please restart Storybound and try again.')
    app.quit()
  })

app.on('before-quit', () => {
  isQuitting = true
  store?.checkpoint()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  if (backupTimer) clearInterval(backupTimer)
  backupTimer = null
  unregisterIpc?.()
  unregisterIpc = null
  store?.close()
  store = null
  logger?.info('shutdown', isQuitting ? 'Storybound closed normally.' : 'Storybound stopped.')
})

app.on('child-process-gone', (_event, details) => {
  logger?.error('child-process', new Error(`${details.type} exited: ${details.reason}`))
})
