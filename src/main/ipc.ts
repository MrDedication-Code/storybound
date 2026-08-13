import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { z } from 'zod'
import { syncCredentialsSchema, syncRecoveryCodeSchema } from '@storybound/contracts'
import type { ApiResult, OperationResult } from '../shared/types'
import {
  createAnnotationSchema,
  aiAssistantSchema,
  backupScheduleSchema,
  createBookSchema,
  createBookmarkSchema,
  createChapterSchema,
  createCollectionSchema,
  createLibrarySchema,
  createSavedFilterSchema,
  createStoryEntityChapterLinkSchema,
  createStoryEntityRelationSchema,
  createStoryEntitySchema,
  createTagSchema,
  createWritingGoalSchema,
  idSchema,
  encryptedTransferSchema,
  libraryQuerySchema,
  locateSearchHitSchema,
  mergeChapterSchema,
  optionalLibraryIdSchema,
  reorderChaptersSchema,
  restoreChapterRevisionSchema,
  saveReadingStateSchema,
  saveRecoveryDraftSchema,
  searchTermSchema,
  setBookRelationsSchema,
  settingsUpdateSchema,
  splitCandidateSchema,
  splitChapterSchema,
  standardBookExportSchema,
  storyEntityQuerySchema,
  storyEntityRelationQuerySchema,
  updateAnnotationSchema,
  updateBackupPlanSchema,
  updateBookSchema,
  updateBookmarkSchema,
  updateChapterSchema,
  updateCollectionSchema,
  updateLibrarySchema,
  updateSavedFilterSchema,
  updateStoryEntityChapterLinkSchema,
  updateStoryEntityRelationSchema,
  updateStoryEntitySchema,
  updateTagSchema,
  updateWritingGoalSchema,
  versionedIdSchema,
  writingStatsQuerySchema
} from '../shared/validation'
import { IPC_CHANNELS } from './channels'
import { apiFailure, StoryboundError } from './errors'
import {
  decryptStoryboundArchive,
  encryptStoryboundArchive,
  MAX_ENCRYPTED_ARCHIVE_BYTES
} from './encryptedVault'
import { OPENAI_ASSISTANT_MODEL, requestOpenAIAssistance } from './openaiAssistant'
import type { AppLogger } from './logger'
import { buildBookEpub3, buildBookMarkdown, buildBookPrintHtml } from './standardExport'
import { buildOfflineCompanionHtml } from './companionExport'
import type { StoryboundStore } from './store'
import type { StoryboundSyncController } from './cloud/syncController'

interface IpcDependencies {
  store: StoryboundStore
  sync: StoryboundSyncController
  logger: AppLogger
  getWindow: () => BrowserWindow | null
}

type Channel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

function safeExportName(title: string): string {
  const name = [...title]
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .slice(0, 100)
  return name || 'Storybound Book'
}

function writeAtomically(targetPath: string, data: string | Buffer): void {
  const temporaryPath = join(dirname(targetPath), `.${randomUUID()}.storybound-export`)
  try {
    writeFileSync(temporaryPath, data, { flag: 'wx' })
    renameSync(temporaryPath, targetPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function registerStoryboundIpc({
  store,
  sync,
  logger,
  getWindow
}: IpcDependencies): () => void {
  const registered: Channel[] = []

  const handle = <Input, Output>(
    channel: Channel,
    schema: z.ZodType<Input>,
    operation: (input: Input) => Output | Promise<Output>
  ): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, input: unknown): Promise<ApiResult<Output>> => {
        try {
          const window = getWindow()
          if (!window || event.sender !== window.webContents) {
            throw new StoryboundError(
              'SECURITY_ERROR',
              'This request did not come from Storybound.'
            )
          }
          const parsed = schema.safeParse(input)
          if (!parsed.success) {
            const message =
              parsed.error.issues[0]?.message ?? 'The supplied information is invalid.'
            throw new StoryboundError('VALIDATION_ERROR', message, parsed.error)
          }
          return { ok: true, data: await operation(parsed.data) }
        } catch (error) {
          logger.error(channel, error)
          return apiFailure(error)
        }
      }
    )
    registered.push(channel)
  }

  const noInput = z.undefined()
  handle(IPC_CHANNELS.appInfo, noInput, () => ({
    name: app.getName(),
    version: app.getVersion(),
    dataPath: store.paths.root
  }))
  handle(IPC_CHANNELS.appOpenDataFolder, noInput, async (): Promise<OperationResult> => {
    const error = await shell.openPath(store.paths.root)
    if (error)
      throw new StoryboundError('FILE_ERROR', 'Storybound could not open its data folder.', error)
    return { path: store.paths.root, message: 'Opened the Storybound data folder.' }
  })

  handle(IPC_CHANNELS.booksList, libraryQuerySchema, (input) => store.listBooks(input))
  handle(IPC_CHANNELS.booksGet, idSchema, (id) => store.getBook(id))
  handle(IPC_CHANNELS.booksCreate, createBookSchema, (input) => store.createBook(input))
  handle(IPC_CHANNELS.booksUpdate, updateBookSchema, (input) => store.updateBook(input))
  handle(IPC_CHANNELS.booksTrash, idSchema, (id) => store.trashBook(id))
  handle(IPC_CHANNELS.booksRestore, idSchema, (id) => store.restoreBook(id))
  handle(IPC_CHANNELS.booksRemovePermanently, idSchema, (id) => store.removeBookPermanently(id))
  handle(IPC_CHANNELS.booksChooseCover, idSchema, async (id) => {
    const result = await dialog.showOpenDialog(getWindow()!, {
      title: 'Choose a book cover',
      properties: ['openFile'],
      filters: [{ name: 'Cover images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    return result.canceled || !result.filePaths[0]
      ? null
      : store.setCoverFromFile(id, result.filePaths[0])
  })
  handle(IPC_CHANNELS.booksRemoveCover, idSchema, (id) => store.removeCover(id))

  handle(IPC_CHANNELS.librariesList, noInput, () => store.listLibraries())
  handle(IPC_CHANNELS.librariesCreate, createLibrarySchema, (input) => store.createLibrary(input))
  handle(IPC_CHANNELS.librariesUpdate, updateLibrarySchema, (input) => store.updateLibrary(input))
  handle(IPC_CHANNELS.librariesSetActive, idSchema, (id) => store.setActiveLibrary(id))
  handle(IPC_CHANNELS.librariesRemove, idSchema, (id) => store.removeLibrary(id))
  handle(IPC_CHANNELS.tagsList, optionalLibraryIdSchema, (id) => store.listTags(id))
  handle(IPC_CHANNELS.tagsCreate, createTagSchema, (input) => store.createTag(input))
  handle(IPC_CHANNELS.tagsUpdate, updateTagSchema, (input) => store.updateTag(input))
  handle(IPC_CHANNELS.tagsRemove, idSchema, (id) => store.removeTag(id))
  handle(IPC_CHANNELS.tagsSetForBook, setBookRelationsSchema, (input) => store.setBookTags(input))
  handle(IPC_CHANNELS.collectionsList, optionalLibraryIdSchema, (id) => store.listCollections(id))
  handle(IPC_CHANNELS.collectionsCreate, createCollectionSchema, (input) =>
    store.createCollection(input)
  )
  handle(IPC_CHANNELS.collectionsUpdate, updateCollectionSchema, (input) =>
    store.updateCollection(input)
  )
  handle(IPC_CHANNELS.collectionsRemove, idSchema, (id) => store.removeCollection(id))
  handle(IPC_CHANNELS.collectionsSetForBook, setBookRelationsSchema, (input) =>
    store.setBookCollections(input)
  )
  handle(IPC_CHANNELS.savedFiltersList, optionalLibraryIdSchema, (id) => store.listSavedFilters(id))
  handle(IPC_CHANNELS.savedFiltersCreate, createSavedFilterSchema, (input) =>
    store.createSavedFilter(input)
  )
  handle(IPC_CHANNELS.savedFiltersUpdate, updateSavedFilterSchema, (input) =>
    store.updateSavedFilter(input)
  )
  handle(IPC_CHANNELS.savedFiltersRemove, idSchema, (id) => store.removeSavedFilter(id))

  handle(IPC_CHANNELS.storyEntitiesList, storyEntityQuerySchema, (query) =>
    store.listStoryEntities(query)
  )
  handle(IPC_CHANNELS.storyEntitiesGet, idSchema, (id) => store.getStoryEntity(id))
  handle(IPC_CHANNELS.storyEntitiesCreate, createStoryEntitySchema, (input) =>
    store.createStoryEntity(input)
  )
  handle(IPC_CHANNELS.storyEntitiesUpdate, updateStoryEntitySchema, (input) =>
    store.updateStoryEntity(input)
  )
  handle(IPC_CHANNELS.storyEntitiesRemove, idSchema, (id) => store.removeStoryEntity(id))
  handle(IPC_CHANNELS.storyEntityChapterLinksList, idSchema, (id) =>
    store.listStoryEntityChapterLinks(id)
  )
  handle(IPC_CHANNELS.storyEntityChapterLinksCreate, createStoryEntityChapterLinkSchema, (input) =>
    store.createStoryEntityChapterLink(input)
  )
  handle(IPC_CHANNELS.storyEntityChapterLinksUpdate, updateStoryEntityChapterLinkSchema, (input) =>
    store.updateStoryEntityChapterLink(input)
  )
  handle(IPC_CHANNELS.storyEntityChapterLinksRemove, idSchema, (id) =>
    store.removeStoryEntityChapterLink(id)
  )
  handle(IPC_CHANNELS.storyEntityRelationsList, storyEntityRelationQuerySchema, (query) =>
    store.listStoryEntityRelations(query)
  )
  handle(IPC_CHANNELS.storyEntityRelationsCreate, createStoryEntityRelationSchema, (input) =>
    store.createStoryEntityRelation(input)
  )
  handle(IPC_CHANNELS.storyEntityRelationsUpdate, updateStoryEntityRelationSchema, (input) =>
    store.updateStoryEntityRelation(input)
  )
  handle(IPC_CHANNELS.storyEntityRelationsRemove, idSchema, (id) =>
    store.removeStoryEntityRelation(id)
  )

  handle(IPC_CHANNELS.chaptersGet, idSchema, (id) => store.getChapter(id))
  handle(IPC_CHANNELS.chaptersCreate, createChapterSchema, (input) => store.createChapter(input))
  handle(IPC_CHANNELS.chaptersUpdate, updateChapterSchema, (input) => store.updateChapter(input))
  handle(IPC_CHANNELS.chaptersReorder, reorderChaptersSchema, (input) =>
    store.reorderChapters(input)
  )
  handle(IPC_CHANNELS.chaptersDuplicate, idSchema, (id) => store.duplicateChapter(id))
  handle(IPC_CHANNELS.chaptersRemove, idSchema, (id) => store.removeChapter(id))
  handle(IPC_CHANNELS.chaptersListTrash, idSchema, (id) => store.listChapterTrash(id))
  handle(IPC_CHANNELS.chaptersRestore, idSchema, (id) => store.restoreChapter(id))
  handle(IPC_CHANNELS.chaptersRemovePermanently, idSchema, (id) =>
    store.removeChapterPermanently(id)
  )
  handle(IPC_CHANNELS.chaptersListRevisions, idSchema, (id) => store.listChapterRevisions(id))
  handle(IPC_CHANNELS.chaptersGetRevision, idSchema, (id) => store.getChapterRevision(id))
  handle(IPC_CHANNELS.chaptersRestoreRevision, restoreChapterRevisionSchema, (input) =>
    store.restoreChapterRevision(input)
  )
  handle(IPC_CHANNELS.chaptersSplit, splitChapterSchema, (input) => store.splitChapter(input))
  handle(IPC_CHANNELS.chaptersMerge, mergeChapterSchema, (input) => store.mergeChapter(input))
  handle(IPC_CHANNELS.chaptersDetectSplits, idSchema, (id) => store.detectSplits(id))
  handle(
    IPC_CHANNELS.chaptersApplyDetectedSplits,
    z.object({ chapterId: idSchema, splits: z.array(splitCandidateSchema).min(1) }),
    ({ chapterId, splits }) => store.applyDetectedSplits(chapterId, splits)
  )

  handle(IPC_CHANNELS.readingGet, idSchema, (id) => store.getReadingState(id))
  handle(IPC_CHANNELS.readingSave, saveReadingStateSchema, (input) => store.saveReadingState(input))
  handle(IPC_CHANNELS.bookmarksList, idSchema, (id) => store.listBookmarks(id))
  handle(IPC_CHANNELS.bookmarksCreate, createBookmarkSchema, (input) => store.createBookmark(input))
  handle(IPC_CHANNELS.bookmarksUpdate, updateBookmarkSchema, (input) => store.updateBookmark(input))
  handle(IPC_CHANNELS.bookmarksRemove, idSchema, (id) => store.removeBookmark(id))
  handle(IPC_CHANNELS.annotationsList, idSchema, (id) => store.listAnnotations(id))
  handle(IPC_CHANNELS.annotationsCreate, createAnnotationSchema, (input) =>
    store.createAnnotation(input)
  )
  handle(IPC_CHANNELS.annotationsUpdate, updateAnnotationSchema, (input) =>
    store.updateAnnotation(input)
  )
  handle(IPC_CHANNELS.annotationsRemove, versionedIdSchema, (input) =>
    store.removeAnnotation(input)
  )
  handle(IPC_CHANNELS.writingGoalsList, noInput, () => store.listWritingGoals())
  handle(IPC_CHANNELS.writingGoalsCreate, createWritingGoalSchema, (input) =>
    store.createWritingGoal(input)
  )
  handle(IPC_CHANNELS.writingGoalsUpdate, updateWritingGoalSchema, (input) =>
    store.updateWritingGoal(input)
  )
  handle(IPC_CHANNELS.writingGoalsRemove, versionedIdSchema, (input) =>
    store.removeWritingGoal(input)
  )
  handle(IPC_CHANNELS.writingStats, writingStatsQuerySchema, (input) =>
    store.getWritingStats(input)
  )
  handle(IPC_CHANNELS.searchQuery, searchTermSchema, (term) => store.search(term))
  handle(IPC_CHANNELS.searchLocate, locateSearchHitSchema, (input) => store.locateSearchHit(input))
  handle(IPC_CHANNELS.settingsGet, noInput, () => store.getSettings())
  handle(IPC_CHANNELS.settingsUpdate, settingsUpdateSchema, (input) => store.updateSettings(input))
  const optionalDeviceName = z.string().trim().min(1).max(120).optional()
  handle(IPC_CHANNELS.syncStatus, noInput, () => sync.status())
  handle(IPC_CHANNELS.syncSignUp, syncCredentialsSchema, (input) => sync.signUp(input))
  handle(IPC_CHANNELS.syncSignIn, syncCredentialsSchema, (input) => sync.signIn(input))
  handle(IPC_CHANNELS.syncSignOut, noInput, () => sync.signOut())
  handle(IPC_CHANNELS.syncCreateVault, optionalDeviceName, (deviceName) =>
    sync.createVault(deviceName)
  )
  handle(IPC_CHANNELS.syncRotateRecoveryCode, noInput, () => sync.rotateRecoveryCode())
  handle(
    IPC_CHANNELS.syncRecover,
    z.object({ recoveryCode: syncRecoveryCodeSchema, deviceName: optionalDeviceName }),
    (input) => sync.recoverVault(input.recoveryCode, input.deviceName)
  )
  handle(IPC_CHANNELS.syncRunNow, noInput, () => sync.syncNow())
  handle(IPC_CHANNELS.syncListDevices, noInput, () => sync.listDevices())
  handle(IPC_CHANNELS.syncRevokeDevice, idSchema, (deviceId) => sync.revokeDevice(deviceId))
  handle(IPC_CHANNELS.syncListConflicts, noInput, () => sync.listConflicts())
  handle(
    IPC_CHANNELS.syncResolveConflict,
    z.object({ id: idSchema, resolution: z.enum(['keep-local', 'use-remote']) }),
    (input) => sync.resolveConflict(input.id, input.resolution)
  )
  handle(IPC_CHANNELS.recoveryGet, idSchema, (id) => store.getRecoveryDraft(id))
  handle(IPC_CHANNELS.recoverySave, saveRecoveryDraftSchema, (input) =>
    store.saveRecoveryDraft(input)
  )
  handle(IPC_CHANNELS.recoveryClear, idSchema, (id) => store.clearRecoveryDraft(id))

  handle(IPC_CHANNELS.dataExportBook, idSchema, async (bookId) => {
    const book = store.getBook(bookId)
    const result = await dialog.showSaveDialog(getWindow()!, {
      title: 'Export book',
      defaultPath: join(app.getPath('documents'), `${safeExportName(book.title)}.storybound-book`),
      filters: [{ name: 'Storybound book', extensions: ['storybound-book'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true, message: 'Export canceled.' }
    return store.exportBookToPath(bookId, result.filePath)
  })
  handle(IPC_CHANNELS.dataExportStandard, standardBookExportSchema, async (input) => {
    const book = store.getBook(input.bookId)
    const chapters = book.chapters.map((chapter) => store.getChapter(chapter.id))
    const configuration = {
      markdown: { extension: 'md', label: 'Markdown', mime: 'Markdown' },
      epub: { extension: 'epub', label: 'EPUB book', mime: 'EPUB' },
      pdf: { extension: 'pdf', label: 'PDF document', mime: 'PDF' }
    }[input.format]
    const result = await dialog.showSaveDialog(getWindow()!, {
      title: `Export ${configuration.label}`,
      defaultPath: join(
        app.getPath('documents'),
        `${safeExportName(book.title)}.${configuration.extension}`
      ),
      filters: [{ name: configuration.mime, extensions: [configuration.extension] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true, message: 'Export canceled.' }

    const exportInput = { book, chapters }
    if (input.format === 'markdown') {
      writeAtomically(result.filePath, buildBookMarkdown(exportInput))
    } else if (input.format === 'epub') {
      writeAtomically(result.filePath, buildBookEpub3(exportInput))
    } else {
      const temporaryHtml = join(store.paths.backups, `.print-${randomUUID()}.html`)
      const printWindow = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
      })
      try {
        writeFileSync(temporaryHtml, buildBookPrintHtml(exportInput), { flag: 'wx' })
        await printWindow.loadFile(temporaryHtml)
        const pdf = await printWindow.webContents.printToPDF({
          pageSize: 'A5',
          preferCSSPageSize: true,
          printBackground: true
        })
        writeAtomically(result.filePath, pdf)
      } finally {
        if (!printWindow.isDestroyed()) printWindow.destroy()
        rmSync(temporaryHtml, { force: true })
      }
    }
    return {
      path: result.filePath,
      message: `Exported “${book.title}” as ${configuration.mime}.`
    }
  })
  handle(IPC_CHANNELS.dataExportLibrary, noInput, async () => {
    const result = await dialog.showSaveDialog(getWindow()!, {
      title: 'Back up Storybound library',
      defaultPath: join(
        app.getPath('documents'),
        `Storybound Backup ${new Date().toISOString().slice(0, 10)}.storybound-backup`
      ),
      filters: [{ name: 'Storybound backup', extensions: ['storybound-backup'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true, message: 'Backup canceled.' }
    return store.exportLibraryToPath(result.filePath, app.getVersion())
  })
  handle(IPC_CHANNELS.dataImportPackage, noInput, async () => {
    const result = await dialog.showOpenDialog(getWindow()!, {
      title: 'Import a Storybound book',
      properties: ['openFile'],
      filters: [{ name: 'Storybound book', extensions: ['storybound-book', 'zip'] }]
    })
    if (result.canceled || !result.filePaths[0])
      return { canceled: true, message: 'Import canceled.' }
    return store.importBookFromPath(result.filePaths[0])
  })
  handle(IPC_CHANNELS.dataRestoreBackup, noInput, async () => {
    const result = await dialog.showOpenDialog(getWindow()!, {
      title: 'Restore a Storybound library backup',
      message: 'Your current library will be replaced after the backup passes validation.',
      properties: ['openFile'],
      filters: [{ name: 'Storybound backup', extensions: ['storybound-backup', 'zip'] }]
    })
    if (result.canceled || !result.filePaths[0])
      return { canceled: true, message: 'Restore canceled.' }
    const restored = await store.restoreLibraryFromPath(result.filePaths[0])
    setTimeout(() => getWindow()?.webContents.reload(), 250)
    return restored
  })
  handle(IPC_CHANNELS.dataExportEncrypted, encryptedTransferSchema, async ({ passphrase }) => {
    const result = await dialog.showSaveDialog(getWindow()!, {
      title: 'Export encrypted Storybound vault',
      defaultPath: join(
        app.getPath('documents'),
        `Storybound Vault ${new Date().toISOString().slice(0, 10)}.storybound-vault`
      ),
      filters: [{ name: 'Encrypted Storybound vault', extensions: ['storybound-vault'] }]
    })
    if (result.canceled || !result.filePath)
      return { canceled: true, message: 'Encrypted export canceled.' }

    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'storybound-vault-'))
    const temporaryBackup = join(temporaryDirectory, 'library.storybound-backup')
    try {
      await store.exportLibraryToPath(temporaryBackup, app.getVersion())
      const backup = readFileSync(temporaryBackup)
      try {
        const encrypted = encryptStoryboundArchive(backup, passphrase)
        writeAtomically(result.filePath, encrypted)
      } finally {
        backup.fill(0)
      }
      return {
        path: result.filePath,
        message: 'Encrypted library vault exported. Keep its passphrase somewhere safe.'
      }
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })
  handle(IPC_CHANNELS.dataRestoreEncrypted, encryptedTransferSchema, async ({ passphrase }) => {
    const result = await dialog.showOpenDialog(getWindow()!, {
      title: 'Restore encrypted Storybound vault',
      message: 'Your current library will be replaced only after decryption and validation.',
      properties: ['openFile'],
      filters: [{ name: 'Encrypted Storybound vault', extensions: ['storybound-vault'] }]
    })
    if (result.canceled || !result.filePaths[0])
      return { canceled: true, message: 'Encrypted restore canceled.' }

    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'storybound-vault-'))
    const temporaryBackup = join(temporaryDirectory, 'library.storybound-backup')
    try {
      if (statSync(result.filePaths[0]).size > MAX_ENCRYPTED_ARCHIVE_BYTES) {
        throw new StoryboundError('FILE_ERROR', 'Encrypted archives are limited to 500 MB.')
      }
      const encrypted = readFileSync(result.filePaths[0])
      const decrypted = decryptStoryboundArchive(encrypted, passphrase)
      try {
        writeFileSync(temporaryBackup, decrypted, { flag: 'wx' })
      } finally {
        decrypted.fill(0)
      }
      const restored = await store.restoreLibraryFromPath(temporaryBackup)
      setTimeout(() => getWindow()?.webContents.reload(), 250)
      return restored
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })
  handle(IPC_CHANNELS.dataAiAssist, aiAssistantSchema, async (input) => ({
    text: await requestOpenAIAssistance(input),
    model: OPENAI_ASSISTANT_MODEL
  }))
  handle(IPC_CHANNELS.dataExportCompanion, idSchema, async (bookId) => {
    const book = store.getBook(bookId)
    const result = await dialog.showSaveDialog(getWindow()!, {
      title: 'Export offline companion reader',
      defaultPath: join(app.getPath('documents'), `${safeExportName(book.title)} Companion.html`),
      filters: [{ name: 'Offline HTML reader', extensions: ['html'] }]
    })
    if (result.canceled || !result.filePath)
      return { canceled: true, message: 'Companion export canceled.' }

    let coverDataUrl: string | undefined
    if (book.coverImageUrl) {
      try {
        const filename = decodeURIComponent(new URL(book.coverImageUrl).pathname.split('/').at(-1)!)
        if (filename === basename(filename)) {
          const extension = extname(filename).toLocaleLowerCase()
          const mime =
            extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
          coverDataUrl = `data:${mime};base64,${readFileSync(join(store.paths.media, filename)).toString('base64')}`
        }
      } catch {
        // Missing covers gracefully fall back to the companion's generated title treatment.
      }
    }
    const html = buildOfflineCompanionHtml({
      title: book.title,
      subtitle: book.subtitle,
      author: book.authorName,
      blurb: book.blurb,
      coverDataUrl,
      chapters: book.chapters.map((chapter) => {
        const detail = store.getChapter(chapter.id)
        return { id: detail.id, title: detail.title, content: detail.content }
      })
    })
    writeAtomically(result.filePath, html)
    return {
      path: result.filePath,
      message: `Exported “${book.title}” as a self-contained offline companion reader.`
    }
  })
  handle(IPC_CHANNELS.dataIntegrityCheck, noInput, () => store.integrityCheck())
  handle(IPC_CHANNELS.dataBackupPlansList, noInput, () => store.listBackupPlans())
  handle(IPC_CHANNELS.dataBackupPlansChooseFolder, backupScheduleSchema, async (input) => {
    const result = await dialog.showOpenDialog(getWindow()!, {
      title: 'Choose scheduled backup folder',
      message: 'Storybound will keep verified dated backups in this folder.',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return store.createBackupPlan(result.filePaths[0], input)
  })
  handle(IPC_CHANNELS.dataBackupPlansUpdate, updateBackupPlanSchema, (input) =>
    store.updateBackupPlan(input)
  )
  handle(IPC_CHANNELS.dataBackupPlansRemove, idSchema, (id) => store.removeBackupPlan(id))
  handle(IPC_CHANNELS.dataBackupPlansRun, idSchema, (id) =>
    store.runBackupPlan(id, app.getVersion())
  )

  return () => {
    for (const channel of registered) ipcMain.removeHandler(channel)
  }
}
