import { contextBridge, ipcRenderer } from 'electron'
import type { StoryboundApi } from '../shared/types'
import {
  APP_CLOSE_READY_CHANNEL,
  IPC_CHANNELS,
  MENU_COMMANDS,
  MENU_COMMAND_CHANNEL
} from '../main/channels'

const invoke = <T>(channel: string, input?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, input)

const api: StoryboundApi = {
  app: {
    info: () => invoke(IPC_CHANNELS.appInfo),
    openDataFolder: () => invoke(IPC_CHANNELS.appOpenDataFolder),
    confirmClose: (ready) => invoke(APP_CLOSE_READY_CHANNEL, ready)
  },
  books: {
    list: (query) => invoke(IPC_CHANNELS.booksList, query),
    get: (id) => invoke(IPC_CHANNELS.booksGet, id),
    create: (input) => invoke(IPC_CHANNELS.booksCreate, input),
    update: (input) => invoke(IPC_CHANNELS.booksUpdate, input),
    trash: (id) => invoke(IPC_CHANNELS.booksTrash, id),
    restore: (id) => invoke(IPC_CHANNELS.booksRestore, id),
    removePermanently: (id) => invoke(IPC_CHANNELS.booksRemovePermanently, id),
    chooseCover: (id) => invoke(IPC_CHANNELS.booksChooseCover, id),
    removeCover: (id) => invoke(IPC_CHANNELS.booksRemoveCover, id)
  },
  libraries: {
    list: () => invoke(IPC_CHANNELS.librariesList),
    create: (input) => invoke(IPC_CHANNELS.librariesCreate, input),
    update: (input) => invoke(IPC_CHANNELS.librariesUpdate, input),
    setActive: (id) => invoke(IPC_CHANNELS.librariesSetActive, id),
    remove: (id) => invoke(IPC_CHANNELS.librariesRemove, id)
  },
  tags: {
    list: (libraryId) => invoke(IPC_CHANNELS.tagsList, libraryId),
    create: (input) => invoke(IPC_CHANNELS.tagsCreate, input),
    update: (input) => invoke(IPC_CHANNELS.tagsUpdate, input),
    remove: (id) => invoke(IPC_CHANNELS.tagsRemove, id),
    setForBook: (input) => invoke(IPC_CHANNELS.tagsSetForBook, input)
  },
  collections: {
    list: (libraryId) => invoke(IPC_CHANNELS.collectionsList, libraryId),
    create: (input) => invoke(IPC_CHANNELS.collectionsCreate, input),
    update: (input) => invoke(IPC_CHANNELS.collectionsUpdate, input),
    remove: (id) => invoke(IPC_CHANNELS.collectionsRemove, id),
    setForBook: (input) => invoke(IPC_CHANNELS.collectionsSetForBook, input)
  },
  savedFilters: {
    list: (libraryId) => invoke(IPC_CHANNELS.savedFiltersList, libraryId),
    create: (input) => invoke(IPC_CHANNELS.savedFiltersCreate, input),
    update: (input) => invoke(IPC_CHANNELS.savedFiltersUpdate, input),
    remove: (id) => invoke(IPC_CHANNELS.savedFiltersRemove, id)
  },
  storyBible: {
    entities: {
      list: (query) => invoke(IPC_CHANNELS.storyEntitiesList, query),
      get: (id) => invoke(IPC_CHANNELS.storyEntitiesGet, id),
      create: (input) => invoke(IPC_CHANNELS.storyEntitiesCreate, input),
      update: (input) => invoke(IPC_CHANNELS.storyEntitiesUpdate, input),
      remove: (id) => invoke(IPC_CHANNELS.storyEntitiesRemove, id)
    },
    chapterLinks: {
      list: (entityId) => invoke(IPC_CHANNELS.storyEntityChapterLinksList, entityId),
      create: (input) => invoke(IPC_CHANNELS.storyEntityChapterLinksCreate, input),
      update: (input) => invoke(IPC_CHANNELS.storyEntityChapterLinksUpdate, input),
      remove: (id) => invoke(IPC_CHANNELS.storyEntityChapterLinksRemove, id)
    },
    relations: {
      list: (query) => invoke(IPC_CHANNELS.storyEntityRelationsList, query),
      create: (input) => invoke(IPC_CHANNELS.storyEntityRelationsCreate, input),
      update: (input) => invoke(IPC_CHANNELS.storyEntityRelationsUpdate, input),
      remove: (id) => invoke(IPC_CHANNELS.storyEntityRelationsRemove, id)
    }
  },
  chapters: {
    get: (id) => invoke(IPC_CHANNELS.chaptersGet, id),
    create: (input) => invoke(IPC_CHANNELS.chaptersCreate, input),
    update: (input) => invoke(IPC_CHANNELS.chaptersUpdate, input),
    reorder: (input) => invoke(IPC_CHANNELS.chaptersReorder, input),
    duplicate: (id) => invoke(IPC_CHANNELS.chaptersDuplicate, id),
    remove: (id) => invoke(IPC_CHANNELS.chaptersRemove, id),
    listTrash: (bookId) => invoke(IPC_CHANNELS.chaptersListTrash, bookId),
    restore: (id) => invoke(IPC_CHANNELS.chaptersRestore, id),
    removePermanently: (id) => invoke(IPC_CHANNELS.chaptersRemovePermanently, id),
    listRevisions: (chapterId) => invoke(IPC_CHANNELS.chaptersListRevisions, chapterId),
    getRevision: (id) => invoke(IPC_CHANNELS.chaptersGetRevision, id),
    restoreRevision: (input) => invoke(IPC_CHANNELS.chaptersRestoreRevision, input),
    split: (input) => invoke(IPC_CHANNELS.chaptersSplit, input),
    merge: (input) => invoke(IPC_CHANNELS.chaptersMerge, input),
    detectSplits: (id) => invoke(IPC_CHANNELS.chaptersDetectSplits, id),
    applyDetectedSplits: (chapterId, splits) =>
      invoke(IPC_CHANNELS.chaptersApplyDetectedSplits, { chapterId, splits })
  },
  reading: {
    get: (bookId) => invoke(IPC_CHANNELS.readingGet, bookId),
    save: (input) => invoke(IPC_CHANNELS.readingSave, input)
  },
  bookmarks: {
    list: (bookId) => invoke(IPC_CHANNELS.bookmarksList, bookId),
    create: (input) => invoke(IPC_CHANNELS.bookmarksCreate, input),
    update: (input) => invoke(IPC_CHANNELS.bookmarksUpdate, input),
    remove: (id) => invoke(IPC_CHANNELS.bookmarksRemove, id)
  },
  annotations: {
    list: (bookId) => invoke(IPC_CHANNELS.annotationsList, bookId),
    create: (input) => invoke(IPC_CHANNELS.annotationsCreate, input),
    update: (input) => invoke(IPC_CHANNELS.annotationsUpdate, input),
    remove: (input) => invoke(IPC_CHANNELS.annotationsRemove, input)
  },
  writing: {
    goals: {
      list: () => invoke(IPC_CHANNELS.writingGoalsList),
      create: (input) => invoke(IPC_CHANNELS.writingGoalsCreate, input),
      update: (input) => invoke(IPC_CHANNELS.writingGoalsUpdate, input),
      remove: (input) => invoke(IPC_CHANNELS.writingGoalsRemove, input)
    },
    stats: (query) => invoke(IPC_CHANNELS.writingStats, query)
  },
  search: {
    query: (term) => invoke(IPC_CHANNELS.searchQuery, term),
    locate: (input) => invoke(IPC_CHANNELS.searchLocate, input)
  },
  settings: {
    get: () => invoke(IPC_CHANNELS.settingsGet),
    update: (input) => invoke(IPC_CHANNELS.settingsUpdate, input)
  },
  recovery: {
    get: (chapterId) => invoke(IPC_CHANNELS.recoveryGet, chapterId),
    save: (input) => invoke(IPC_CHANNELS.recoverySave, input),
    clear: (chapterId) => invoke(IPC_CHANNELS.recoveryClear, chapterId)
  },
  data: {
    exportBook: (bookId) => invoke(IPC_CHANNELS.dataExportBook, bookId),
    exportStandard: (input) => invoke(IPC_CHANNELS.dataExportStandard, input),
    exportLibrary: () => invoke(IPC_CHANNELS.dataExportLibrary),
    importPackage: () => invoke(IPC_CHANNELS.dataImportPackage),
    restoreBackup: () => invoke(IPC_CHANNELS.dataRestoreBackup),
    exportEncrypted: (input) => invoke(IPC_CHANNELS.dataExportEncrypted, input),
    restoreEncrypted: (input) => invoke(IPC_CHANNELS.dataRestoreEncrypted, input),
    exportCompanion: (bookId) => invoke(IPC_CHANNELS.dataExportCompanion, bookId),
    aiAssist: (input) => invoke(IPC_CHANNELS.dataAiAssist, input),
    integrityCheck: () => invoke(IPC_CHANNELS.dataIntegrityCheck),
    backupPlans: {
      list: () => invoke(IPC_CHANNELS.dataBackupPlansList),
      chooseFolder: (input) => invoke(IPC_CHANNELS.dataBackupPlansChooseFolder, input),
      update: (input) => invoke(IPC_CHANNELS.dataBackupPlansUpdate, input),
      remove: (id) => invoke(IPC_CHANNELS.dataBackupPlansRemove, id),
      run: (id) => invoke(IPC_CHANNELS.dataBackupPlansRun, id)
    }
  }
}

ipcRenderer.on(MENU_COMMAND_CHANNEL, (_event, command: unknown) => {
  if (
    typeof command === 'string' &&
    MENU_COMMANDS.includes(command as (typeof MENU_COMMANDS)[number])
  ) {
    window.dispatchEvent(new CustomEvent('storybound:command', { detail: command }))
  }
})

contextBridge.exposeInMainWorld('api', Object.freeze(api))
