import { contextBridge, ipcRenderer } from 'electron'
import type { ContentChangedDetail, StoryboundApi } from '../shared/types'
import {
  APP_CLOSE_READY_CHANNEL,
  CONTENT_CHANGED_CHANNEL,
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
  agentBridge: {
    status: () => invoke(IPC_CHANNELS.agentBridgeStatus),
    update: (input) => invoke(IPC_CHANNELS.agentBridgeUpdate, input),
    regenerateToken: () => invoke(IPC_CHANNELS.agentBridgeRegenerateToken),
    chooseInbox: () => invoke(IPC_CHANNELS.agentBridgeChooseInbox),
    openInbox: () => invoke(IPC_CHANNELS.agentBridgeOpenInbox),
    scanInbox: () => invoke(IPC_CHANNELS.agentBridgeScanInbox),
    copy: (kind) => invoke(IPC_CHANNELS.agentBridgeCopy, kind),
    connectClaudeDesktop: () => invoke(IPC_CHANNELS.agentBridgeConnectClaudeDesktop)
  },
  bookstore: {
    status: () => invoke(IPC_CHANNELS.bookstoreStatus),
    join: (termsVersion) => invoke(IPC_CHANNELS.bookstoreJoin, termsVersion),
    setPenName: (penName) => invoke(IPC_CHANNELS.bookstoreSetPenName, penName),
    browse: (input) => invoke(IPC_CHANNELS.bookstoreBrowse, input),
    listing: (listingId) => invoke(IPC_CHANNELS.bookstoreListing, listingId),
    openBook: (listingId) => invoke(IPC_CHANNELS.bookstoreOpenBook, listingId),
    collectBook: (listingId) => invoke(IPC_CHANNELS.bookstoreCollectBook, listingId),
    publish: (input) => invoke(IPC_CHANNELS.bookstorePublish, input),
    myListings: () => invoke(IPC_CHANNELS.bookstoreMyListings),
    withdraw: (listingId) => invoke(IPC_CHANNELS.bookstoreWithdraw, listingId),
    report: (input) => invoke(IPC_CHANNELS.bookstoreReport, input),
    checkBooks: () => invoke(IPC_CHANNELS.bookstoreCheckBooks),
    reviewQueue: () => invoke(IPC_CHANNELS.bookstoreReviewQueue),
    readForReview: (input) => invoke(IPC_CHANNELS.bookstoreReadForReview, input),
    decide: (input) => invoke(IPC_CHANNELS.bookstoreDecide, input),
    remove: (input) => invoke(IPC_CHANNELS.bookstoreRemove, input),
    reports: () => invoke(IPC_CHANNELS.bookstoreReports),
    closeReport: (input) => invoke(IPC_CHANNELS.bookstoreCloseReport, input)
  },
  sharing: {
    status: () => invoke(IPC_CHANNELS.sharingStatus),
    contacts: () => invoke(IPC_CHANNELS.sharingContacts),
    copyAddress: () => invoke(IPC_CHANNELS.sharingCopyAddress),
    listShares: (bookId) => invoke(IPC_CHANNELS.sharingListShares, bookId),
    shareBook: (input) => invoke(IPC_CHANNELS.sharingShareBook, input),
    sendUpdate: (input) => invoke(IPC_CHANNELS.sharingSendUpdate, input),
    stop: (shareId) => invoke(IPC_CHANNELS.sharingStop, shareId),
    listParcels: () => invoke(IPC_CHANNELS.sharingListParcels),
    openParcel: (parcelId) => invoke(IPC_CHANNELS.sharingOpenParcel, parcelId),
    acceptParcel: (parcelId) => invoke(IPC_CHANNELS.sharingAcceptParcel, parcelId),
    declineParcel: (parcelId) => invoke(IPC_CHANNELS.sharingDeclineParcel, parcelId)
  },
  sync: {
    status: () => invoke(IPC_CHANNELS.syncStatus),
    signUp: (input) => invoke(IPC_CHANNELS.syncSignUp, input),
    signIn: (input) => invoke(IPC_CHANNELS.syncSignIn, input),
    signOut: () => invoke(IPC_CHANNELS.syncSignOut),
    requestPasswordReset: (input) => invoke(IPC_CHANNELS.syncRequestPasswordReset, input),
    resetPassword: (input) => invoke(IPC_CHANNELS.syncResetPassword, input),
    deleteAccount: () => invoke(IPC_CHANNELS.syncDeleteAccount),
    createVault: (deviceName) => invoke(IPC_CHANNELS.syncCreateVault, deviceName),
    rotateRecoveryCode: () => invoke(IPC_CHANNELS.syncRotateRecoveryCode),
    recover: (input) => invoke(IPC_CHANNELS.syncRecover, input),
    listLinkRequests: () => invoke(IPC_CHANNELS.syncListLinkRequests),
    approveLinkRequest: (requestId) => invoke(IPC_CHANNELS.syncApproveLinkRequest, requestId),
    declineLinkRequest: (requestId) => invoke(IPC_CHANNELS.syncDeclineLinkRequest, requestId),
    runNow: () => invoke(IPC_CHANNELS.syncRunNow),
    listDevices: () => invoke(IPC_CHANNELS.syncListDevices),
    revokeDevice: (deviceId) => invoke(IPC_CHANNELS.syncRevokeDevice, deviceId),
    listConflicts: () => invoke(IPC_CHANNELS.syncListConflicts),
    resolveConflict: (input) => invoke(IPC_CHANNELS.syncResolveConflict, input)
  },
  narration: {
    status: () => invoke(IPC_CHANNELS.narrationStatus),
    update: (input) => invoke(IPC_CHANNELS.narrationUpdate, input),
    setGeminiKey: (apiKey) => invoke(IPC_CHANNELS.narrationSetGeminiKey, apiKey),
    clearGeminiKey: () => invoke(IPC_CHANNELS.narrationClearGeminiKey),
    listVoices: (input) => invoke(IPC_CHANNELS.narrationListVoices, input),
    synthesize: (input) => invoke(IPC_CHANNELS.narrationSynthesize, input),
    installKokoro: () => invoke(IPC_CHANNELS.narrationInstallKokoro),
    removeKokoro: () => invoke(IPC_CHANNELS.narrationRemoveKokoro)
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

ipcRenderer.on(CONTENT_CHANGED_CHANNEL, (_event, detail: unknown) => {
  const candidate = detail as Partial<ContentChangedDetail> | null
  if (
    candidate &&
    typeof candidate.bookId === 'string' &&
    (candidate.chapterId === null || typeof candidate.chapterId === 'string') &&
    typeof candidate.message === 'string'
  ) {
    const changed: ContentChangedDetail = {
      bookId: candidate.bookId,
      chapterId: candidate.chapterId,
      message: candidate.message
    }
    window.dispatchEvent(new CustomEvent('storybound:content-changed', { detail: changed }))
  }
})

contextBridge.exposeInMainWorld('api', Object.freeze(api))
