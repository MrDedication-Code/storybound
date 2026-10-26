import type {
  SyncConflictRecord,
  SyncCredentialsInput,
  SyncDeviceSummary,
  SyncEnableResult,
  SyncRecoveryInput,
  SyncResolveConflictInput,
  SyncRunResult,
  SyncRuntimeStatus
} from '@storybound/contracts'

export const APP_NAME = 'Storybound'
export const DATA_FORMAT_VERSION = 2

export type BookStatus = 'ongoing' | 'completed'
export type LibraryFilter = 'all' | 'ongoing' | 'completed' | 'unread' | 'in-progress' | 'finished'
export type LibrarySort = 'recently-opened' | 'recently-updated' | 'title' | 'progress' | 'created'
export type AppTheme = 'system' | 'dark' | 'light'
export type ReaderTheme = 'light' | 'sepia' | 'dark'
export type ReaderFont = 'literary' | 'classic' | 'modern'
export type TextAlignment = 'left' | 'justify'
export type StoryEntityType = 'character' | 'location' | 'lore' | 'event' | 'custom'
export type AnnotationKind = 'highlight' | 'note'
export type AnchorResolutionStatus = 'resolved' | 'approximate' | 'unresolved'
export type WritingGoalMetric = 'words' | 'minutes' | 'chapters'
export type WritingGoalPeriod = 'daily' | 'weekly' | 'monthly' | 'project'
export type StandardBookExportFormat = 'markdown' | 'epub' | 'pdf'
export type BackupCadence = 'daily' | 'weekly' | 'monthly'
export type CoverStyle = 'classic' | 'moonlit' | 'forest' | 'ember' | 'ocean' | 'rose'
export type AiAssistantTask = 'blurb' | 'chapter-cleanup'
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface StoryEntityDetails {
  date?: string
  order?: number
  [key: string]: JsonValue | undefined
}

export interface BookSummary {
  id: string
  libraryId: string
  title: string
  subtitle: string
  seriesName: string
  seriesPosition: number | null
  authorName: string
  blurb: string
  status: BookStatus
  languageCode: string
  sourceLabel: string
  sourceUrl: string
  personalNotes: string
  rating: number | null
  isFavourite: boolean
  isPinned: boolean
  coverImageUrl: string | null
  coverStyle: CoverStyle
  coverPositionX: number
  coverPositionY: number
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
  completedAt: string | null
  totalWordCount: number
  chapterCount: number
  progressPercentage: number
  hasFinishedCurrentContent: boolean
  isArchived: boolean
}

export interface ChapterSummary {
  id: string
  bookId: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
  wordCount: number
  isRead: boolean
}

export interface Chapter extends ChapterSummary {
  content: string
}

export interface ChapterTrashItem extends ChapterSummary {
  deletedAt: string
  originalPosition: number
}

export interface ChapterRevision {
  id: string
  chapterId: string
  revisionNumber: number
  title: string
  content?: string
  wordCount: number
  reason: string
  createdAt: string
}

export interface BookDetail extends BookSummary {
  chapters: ChapterSummary[]
  tagIds: string[]
  collectionIds: string[]
}

export interface Library {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  isActive: boolean
  bookCount: number
}

export interface Tag {
  id: string
  libraryId: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
  bookCount: number
}

export interface Collection {
  id: string
  libraryId: string
  name: string
  description: string
  color: string
  icon: string
  position: number
  createdAt: string
  updatedAt: string
  bookCount: number
}

export interface SavedFilter {
  id: string
  libraryId: string
  name: string
  query: LibraryQuery
  position: number
  createdAt: string
  updatedAt: string
}

export interface StoryEntity {
  id: string
  bookId: string
  entityType: StoryEntityType
  title: string
  summary: string
  bodyMarkdown: string
  detailsVersion: number
  details: StoryEntityDetails
  position: number
  createdAt: string
  updatedAt: string
  rowVersion: number
}

export interface StoryEntityChapterLink {
  id: string
  bookId: string
  entityId: string
  chapterId: string
  chapterTitle: string
  note: string
  createdAt: string
  updatedAt: string
  rowVersion: number
}

export interface StoryEntityRelation {
  id: string
  bookId: string
  fromEntityId: string
  toEntityId: string
  relationshipType: string
  label: string
  notes: string
  createdAt: string
  updatedAt: string
  rowVersion: number
}

export interface ReadingState {
  bookId: string
  chapterId: string | null
  scrollPosition: number
  progressPercentage: number
  lastReadAt: string | null
  hasFinishedCurrentContent: boolean
}

export interface Bookmark {
  id: string
  bookId: string
  chapterId: string
  chapterTitle: string
  location: number
  note: string
  label: string
  color: string
  anchor: ChapterAnchor
  createdAt: string
  updatedAt: string
  rowVersion: number
}

export interface ChapterAnchor {
  id: string
  chapterId: string
  startOffset: number | null
  endOffset: number | null
  fallbackLocation: number
  quote: string
  prefix: string
  suffix: string
  contentHash: string
  resolutionStatus: AnchorResolutionStatus
  createdAt: string
  updatedAt: string
  rowVersion: number
}

export interface AnchorInput {
  startOffset?: number | null
  endOffset?: number | null
  fallbackLocation: number
  quote?: string
  prefix?: string
  suffix?: string
}

export interface Annotation {
  id: string
  bookId: string
  chapterId: string
  chapterTitle: string
  kind: AnnotationKind
  body: string
  color: string
  anchor: ChapterAnchor
  createdAt: string
  updatedAt: string
  rowVersion: number
}

export interface CreateAnnotationInput {
  bookId: string
  chapterId: string
  kind: AnnotationKind
  body?: string
  color?: string
  anchor: AnchorInput
}

export interface UpdateAnnotationInput {
  id: string
  expectedRowVersion: number
  kind?: AnnotationKind
  body?: string
  color?: string
  anchor?: AnchorInput
}

export interface VersionedIdInput {
  id: string
  expectedRowVersion: number
}

export interface WritingGoal {
  id: string
  libraryId: string
  bookId: string | null
  bookTitle: string | null
  metric: WritingGoalMetric
  period: WritingGoalPeriod
  targetValue: number
  startOn: string
  endOn: string | null
  timezone: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  rowVersion: number
}

export interface CreateWritingGoalInput {
  libraryId?: string
  bookId?: string | null
  metric: WritingGoalMetric
  period: WritingGoalPeriod
  targetValue: number
  startOn: string
  endOn?: string | null
  timezone?: string
  isActive?: boolean
}

export interface UpdateWritingGoalInput {
  id: string
  expectedRowVersion: number
  bookId?: string | null
  metric?: WritingGoalMetric
  period?: WritingGoalPeriod
  targetValue?: number
  startOn?: string
  endOn?: string | null
  timezone?: string
  isActive?: boolean
}

export interface WritingStatsQuery {
  from: string
  to: string
  bookId?: string
}

export interface WritingDayStats {
  date: string
  wordsAdded: number
  wordsRemoved: number
  netWords: number
  wordCountAfter: number
}

export interface WritingBookStats {
  bookId: string
  bookTitle: string
  wordsAdded: number
  wordsRemoved: number
  netWords: number
  currentWordCount: number
}

export interface WritingGoalProgress {
  goal: WritingGoal
  periodStart: string
  periodEnd: string
  achievedValue: number
  remainingValue: number
  progressPercentage: number
}

export interface WritingStats {
  from: string
  to: string
  totalWordsAdded: number
  totalWordsRemoved: number
  netWords: number
  days: WritingDayStats[]
  books: WritingBookStats[]
  activeGoals: WritingGoalProgress[]
}

export interface ApplicationSettings {
  appTheme: AppTheme
  reducedMotion: boolean
  hasSeenGettingStarted: boolean
  readerTheme: ReaderTheme
  readerFont: ReaderFont
  readerFontSize: number
  lineHeight: number
  columnWidth: number
  paragraphSpacing: number
  paragraphIndentation: boolean
  textAlignment: TextAlignment
  defaultLibrarySort: LibrarySort
}

export interface LibraryQuery {
  libraryId?: string
  search?: string
  filter?: LibraryFilter
  sort?: LibrarySort
  includeArchived?: boolean
  favouriteOnly?: boolean
  pinnedOnly?: boolean
  tagIds?: string[]
  collectionId?: string
  seriesName?: string
  limit?: number
  offset?: number
}

export interface CreateBookInput {
  libraryId?: string
  title: string
  blurb?: string
  status?: BookStatus
  initialChapterTitle?: string
  initialChapterContent?: string
}

export interface UpdateBookInput {
  id: string
  title?: string
  blurb?: string
  status?: BookStatus
  subtitle?: string
  seriesName?: string
  seriesPosition?: number | null
  authorName?: string
  languageCode?: string
  sourceLabel?: string
  sourceUrl?: string
  personalNotes?: string
  rating?: number | null
  isFavourite?: boolean
  isPinned?: boolean
  coverStyle?: CoverStyle
  coverPositionX?: number
  coverPositionY?: number
}

export interface EncryptedTransferInput {
  passphrase: string
}

export interface AiAssistantInput {
  task: AiAssistantTask
  apiKey: string
  text: string
  context?: string
}

export interface AiAssistantResult {
  text: string
  model: string
}

export interface CreateLibraryInput {
  name: string
  description?: string
}

export interface UpdateLibraryInput {
  id: string
  name?: string
  description?: string
}

export interface CreateTagInput {
  libraryId?: string
  name: string
  color?: string
}

export interface UpdateTagInput {
  id: string
  name?: string
  color?: string
}

export interface CreateCollectionInput {
  libraryId?: string
  name: string
  description?: string
  color?: string
  icon?: string
}

export interface UpdateCollectionInput {
  id: string
  name?: string
  description?: string
  color?: string
  icon?: string
}

export interface SetBookRelationsInput {
  bookId: string
  ids: string[]
}

export interface CreateSavedFilterInput {
  libraryId?: string
  name: string
  query: LibraryQuery
}

export interface UpdateSavedFilterInput {
  id: string
  name?: string
  query?: LibraryQuery
}

export interface StoryEntityQuery {
  bookId: string
  entityType?: StoryEntityType
  search?: string
  limit?: number
  offset?: number
}

export interface CreateStoryEntityInput {
  bookId: string
  entityType: StoryEntityType
  title: string
  summary?: string
  bodyMarkdown?: string
  detailsVersion?: number
  details?: StoryEntityDetails
  position?: number
}

export interface UpdateStoryEntityInput {
  id: string
  entityType?: StoryEntityType
  title?: string
  summary?: string
  bodyMarkdown?: string
  detailsVersion?: number
  details?: StoryEntityDetails
  position?: number
}

export interface CreateStoryEntityChapterLinkInput {
  entityId: string
  chapterId: string
  note?: string
}

export interface UpdateStoryEntityChapterLinkInput {
  id: string
  chapterId?: string
  note?: string
}

export interface StoryEntityRelationQuery {
  bookId: string
  entityId?: string
}

export interface CreateStoryEntityRelationInput {
  fromEntityId: string
  toEntityId: string
  relationshipType: string
  label?: string
  notes?: string
}

export interface UpdateStoryEntityRelationInput {
  id: string
  fromEntityId?: string
  toEntityId?: string
  relationshipType?: string
  label?: string
  notes?: string
}

export interface CreateChapterInput {
  bookId: string
  title: string
  content?: string
}

export interface UpdateChapterInput {
  id: string
  title?: string
  content?: string
  writingTimezone?: string
}

export interface RestoreChapterRevisionInput {
  chapterId: string
  revisionId: string
}

export interface ReorderChaptersInput {
  bookId: string
  chapterIds: string[]
}

export interface SplitChapterInput {
  chapterId: string
  offset: number
  newTitle: string
}

export interface MergeChapterInput {
  chapterId: string
  direction: 'previous' | 'next'
}

export interface SplitCandidate {
  offset: number
  title: string
  line: number
}

export interface SearchResult {
  type: 'book' | 'chapter' | 'story-entity'
  bookId: string
  bookTitle: string
  chapterId: string | null
  chapterTitle: string | null
  storyEntityId?: string | null
  storyEntityType?: StoryEntityType | null
  excerpt: string
  rank: number
}

export interface LocateSearchHitInput {
  chapterId: string
  term: string
}

export interface SearchHit {
  chapterId: string
  location: number
  matchedTerm: string
}

export interface SaveReadingStateInput {
  bookId: string
  chapterId: string
  scrollPosition: number
  progressPercentage: number
  hasFinishedCurrentContent: boolean
}

export interface CreateBookmarkInput {
  bookId: string
  chapterId: string
  location: number
  note?: string
  label?: string
  color?: string
  anchor?: AnchorInput
}

export interface UpdateBookmarkInput {
  id: string
  expectedRowVersion: number
  note?: string
  label?: string
  color?: string
  anchor?: AnchorInput
}

export interface SaveRecoveryDraftInput {
  chapterId: string
  title: string
  content: string
}

export interface RecoveryDraft {
  chapterId: string
  title: string
  content: string
  savedAt: string
}

export interface OperationResult {
  canceled?: boolean
  path?: string
  message: string
  importedBookId?: string
}

export interface StandardBookExportInput {
  bookId: string
  format: StandardBookExportFormat
}

export interface BackupPlan {
  id: string
  destinationPath: string
  cadence: BackupCadence
  retentionCount: number
  enabled: boolean
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
  lastRun: BackupRun | null
}

export interface BackupRun {
  id: string
  planId: string
  startedAt: string
  completedAt: string | null
  status: 'running' | 'succeeded' | 'failed'
  outputPath: string | null
  byteSize: number | null
  verifiedAt: string | null
  errorMessage: string | null
}

export interface BackupScheduleInput {
  cadence: BackupCadence
  retentionCount: number
}

export interface UpdateBackupPlanInput extends BackupScheduleInput {
  id: string
  enabled: boolean
}

export interface IntegrityResult {
  healthy: boolean
  details: string
}

export interface AppInfo {
  name: string
  version: string
  dataPath: string
}

export type AgentActivitySource = 'mcp' | 'inbox'

export interface AgentActivity {
  at: string
  source: AgentActivitySource
  message: string
  failed: boolean
}

export interface AgentBridgeStatus {
  mcpEnabled: boolean
  mcpRunning: boolean
  mcpUrl: string | null
  mcpError: string | null
  inboxEnabled: boolean
  inboxPath: string | null
  inboxError: string | null
  claudeCodeCommand: string
  claudeDesktopConfig: string
  claudeDesktopConfigPath: string | null
  recentActivity: AgentActivity[]
}

export interface UpdateAgentBridgeInput {
  mcpEnabled?: boolean
  inboxEnabled?: boolean
}

export type AgentBridgeCopyKind =
  'claude-code-command' | 'claude-desktop-config' | 'http-token' | 'inbox-instructions'

export interface InboxScanResult {
  imported: number
  failed: number
  skipped: number
}

export interface ContentChangedDetail {
  bookId: string
  chapterId: string | null
  message: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

export interface StoryboundApi {
  app: {
    info(): Promise<ApiResult<AppInfo>>
    openDataFolder(): Promise<ApiResult<OperationResult>>
    confirmClose(ready: boolean): Promise<ApiResult<void>>
  }
  books: {
    list(query?: LibraryQuery): Promise<ApiResult<BookSummary[]>>
    get(id: string): Promise<ApiResult<BookDetail>>
    create(input: CreateBookInput): Promise<ApiResult<BookDetail>>
    update(input: UpdateBookInput): Promise<ApiResult<BookDetail>>
    trash(id: string): Promise<ApiResult<void>>
    restore(id: string): Promise<ApiResult<void>>
    removePermanently(id: string): Promise<ApiResult<void>>
    chooseCover(id: string): Promise<ApiResult<BookDetail | null>>
    removeCover(id: string): Promise<ApiResult<BookDetail>>
  }
  libraries: {
    list(): Promise<ApiResult<Library[]>>
    create(input: CreateLibraryInput): Promise<ApiResult<Library>>
    update(input: UpdateLibraryInput): Promise<ApiResult<Library>>
    setActive(id: string): Promise<ApiResult<Library>>
    remove(id: string): Promise<ApiResult<void>>
  }
  tags: {
    list(libraryId?: string): Promise<ApiResult<Tag[]>>
    create(input: CreateTagInput): Promise<ApiResult<Tag>>
    update(input: UpdateTagInput): Promise<ApiResult<Tag>>
    remove(id: string): Promise<ApiResult<void>>
    setForBook(input: SetBookRelationsInput): Promise<ApiResult<Tag[]>>
  }
  collections: {
    list(libraryId?: string): Promise<ApiResult<Collection[]>>
    create(input: CreateCollectionInput): Promise<ApiResult<Collection>>
    update(input: UpdateCollectionInput): Promise<ApiResult<Collection>>
    remove(id: string): Promise<ApiResult<void>>
    setForBook(input: SetBookRelationsInput): Promise<ApiResult<Collection[]>>
  }
  savedFilters: {
    list(libraryId?: string): Promise<ApiResult<SavedFilter[]>>
    create(input: CreateSavedFilterInput): Promise<ApiResult<SavedFilter>>
    update(input: UpdateSavedFilterInput): Promise<ApiResult<SavedFilter>>
    remove(id: string): Promise<ApiResult<void>>
  }
  storyBible: {
    entities: {
      list(query: StoryEntityQuery): Promise<ApiResult<StoryEntity[]>>
      get(id: string): Promise<ApiResult<StoryEntity>>
      create(input: CreateStoryEntityInput): Promise<ApiResult<StoryEntity>>
      update(input: UpdateStoryEntityInput): Promise<ApiResult<StoryEntity>>
      remove(id: string): Promise<ApiResult<void>>
    }
    chapterLinks: {
      list(entityId: string): Promise<ApiResult<StoryEntityChapterLink[]>>
      create(input: CreateStoryEntityChapterLinkInput): Promise<ApiResult<StoryEntityChapterLink>>
      update(input: UpdateStoryEntityChapterLinkInput): Promise<ApiResult<StoryEntityChapterLink>>
      remove(id: string): Promise<ApiResult<void>>
    }
    relations: {
      list(query: StoryEntityRelationQuery): Promise<ApiResult<StoryEntityRelation[]>>
      create(input: CreateStoryEntityRelationInput): Promise<ApiResult<StoryEntityRelation>>
      update(input: UpdateStoryEntityRelationInput): Promise<ApiResult<StoryEntityRelation>>
      remove(id: string): Promise<ApiResult<void>>
    }
  }
  chapters: {
    get(id: string): Promise<ApiResult<Chapter>>
    create(input: CreateChapterInput): Promise<ApiResult<Chapter>>
    update(input: UpdateChapterInput): Promise<ApiResult<Chapter>>
    reorder(input: ReorderChaptersInput): Promise<ApiResult<ChapterSummary[]>>
    duplicate(id: string): Promise<ApiResult<Chapter>>
    remove(id: string): Promise<ApiResult<void>>
    listTrash(bookId: string): Promise<ApiResult<ChapterTrashItem[]>>
    restore(id: string): Promise<ApiResult<Chapter>>
    removePermanently(id: string): Promise<ApiResult<void>>
    listRevisions(chapterId: string): Promise<ApiResult<ChapterRevision[]>>
    getRevision(id: string): Promise<ApiResult<ChapterRevision>>
    restoreRevision(input: RestoreChapterRevisionInput): Promise<ApiResult<Chapter>>
    split(input: SplitChapterInput): Promise<ApiResult<Chapter>>
    merge(input: MergeChapterInput): Promise<ApiResult<Chapter>>
    detectSplits(id: string): Promise<ApiResult<SplitCandidate[]>>
    applyDetectedSplits(
      chapterId: string,
      splits: SplitCandidate[]
    ): Promise<ApiResult<ChapterSummary[]>>
  }
  reading: {
    get(bookId: string): Promise<ApiResult<ReadingState>>
    save(input: SaveReadingStateInput): Promise<ApiResult<ReadingState>>
  }
  bookmarks: {
    list(bookId: string): Promise<ApiResult<Bookmark[]>>
    create(input: CreateBookmarkInput): Promise<ApiResult<Bookmark>>
    update(input: UpdateBookmarkInput): Promise<ApiResult<Bookmark>>
    remove(id: string): Promise<ApiResult<void>>
  }
  annotations: {
    list(bookId: string): Promise<ApiResult<Annotation[]>>
    create(input: CreateAnnotationInput): Promise<ApiResult<Annotation>>
    update(input: UpdateAnnotationInput): Promise<ApiResult<Annotation>>
    remove(input: VersionedIdInput): Promise<ApiResult<void>>
  }
  writing: {
    goals: {
      list(): Promise<ApiResult<WritingGoal[]>>
      create(input: CreateWritingGoalInput): Promise<ApiResult<WritingGoal>>
      update(input: UpdateWritingGoalInput): Promise<ApiResult<WritingGoal>>
      remove(input: VersionedIdInput): Promise<ApiResult<void>>
    }
    stats(query: WritingStatsQuery): Promise<ApiResult<WritingStats>>
  }
  search: {
    query(term: string): Promise<ApiResult<SearchResult[]>>
    locate(input: LocateSearchHitInput): Promise<ApiResult<SearchHit>>
  }
  settings: {
    get(): Promise<ApiResult<ApplicationSettings>>
    update(input: Partial<ApplicationSettings>): Promise<ApiResult<ApplicationSettings>>
  }
  agentBridge: {
    status(): Promise<ApiResult<AgentBridgeStatus>>
    update(input: UpdateAgentBridgeInput): Promise<ApiResult<AgentBridgeStatus>>
    regenerateToken(): Promise<ApiResult<AgentBridgeStatus>>
    chooseInbox(): Promise<ApiResult<AgentBridgeStatus>>
    openInbox(): Promise<ApiResult<OperationResult>>
    scanInbox(): Promise<ApiResult<InboxScanResult>>
    copy(kind: AgentBridgeCopyKind): Promise<ApiResult<OperationResult>>
    connectClaudeDesktop(): Promise<ApiResult<OperationResult>>
  }
  sync: {
    status(): Promise<ApiResult<SyncRuntimeStatus>>
    signUp(input: SyncCredentialsInput): Promise<ApiResult<SyncRuntimeStatus>>
    signIn(input: SyncCredentialsInput): Promise<ApiResult<SyncRuntimeStatus>>
    signOut(): Promise<ApiResult<SyncRuntimeStatus>>
    createVault(deviceName?: string): Promise<ApiResult<SyncEnableResult>>
    rotateRecoveryCode(): Promise<ApiResult<SyncEnableResult>>
    recover(input: SyncRecoveryInput): Promise<ApiResult<SyncRuntimeStatus>>
    runNow(): Promise<ApiResult<SyncRunResult>>
    listDevices(): Promise<ApiResult<SyncDeviceSummary[]>>
    revokeDevice(deviceId: string): Promise<ApiResult<SyncRuntimeStatus>>
    listConflicts(): Promise<ApiResult<SyncConflictRecord[]>>
    resolveConflict(input: SyncResolveConflictInput): Promise<ApiResult<SyncRunResult>>
  }
  recovery: {
    get(chapterId: string): Promise<ApiResult<RecoveryDraft | null>>
    save(input: SaveRecoveryDraftInput): Promise<ApiResult<RecoveryDraft>>
    clear(chapterId: string): Promise<ApiResult<void>>
  }
  data: {
    exportBook(bookId: string): Promise<ApiResult<OperationResult>>
    exportStandard(input: StandardBookExportInput): Promise<ApiResult<OperationResult>>
    exportLibrary(): Promise<ApiResult<OperationResult>>
    importPackage(): Promise<ApiResult<OperationResult>>
    restoreBackup(): Promise<ApiResult<OperationResult>>
    exportEncrypted(input: EncryptedTransferInput): Promise<ApiResult<OperationResult>>
    restoreEncrypted(input: EncryptedTransferInput): Promise<ApiResult<OperationResult>>
    exportCompanion(bookId: string): Promise<ApiResult<OperationResult>>
    aiAssist(input: AiAssistantInput): Promise<ApiResult<AiAssistantResult>>
    integrityCheck(): Promise<ApiResult<IntegrityResult>>
    backupPlans: {
      list(): Promise<ApiResult<BackupPlan[]>>
      chooseFolder(input: BackupScheduleInput): Promise<ApiResult<BackupPlan | null>>
      update(input: UpdateBackupPlanInput): Promise<ApiResult<BackupPlan>>
      remove(id: string): Promise<ApiResult<void>>
      run(id: string): Promise<ApiResult<BackupRun>>
    }
  }
}

export {
  SYNC_ENCRYPTION_ALGORITHM,
  SYNC_PROTOCOL_VERSION,
  type SyncCiphertext,
  type SyncConflictRecord,
  type SyncConflictResolution,
  type SyncConnectionPhase,
  type SyncCredentialsInput,
  type SyncDeviceSummary,
  type SyncEnableResult,
  type SyncEntityType,
  type SyncKeyEnvelope,
  type SyncMutationEnvelope,
  type SyncOperation,
  type SyncPullResult,
  type SyncPushBatchRequest,
  type SyncPushBatchResult,
  type SyncRemoteBatch,
  type SyncRecoveryInput,
  type SyncResolveConflictInput,
  type SyncRunResult,
  type SyncRuntimeStatus
} from '@storybound/contracts'
