import { openDatabaseAsync } from 'expo-sqlite'
import type { MobileRepository } from '../../domain/contracts'
import { createSqlWriteCoordinator } from './databasePort'
import { createExpoDatabasePort } from './expoDatabasePort'
import { DATABASE_NAME, migrateDatabase } from './migrations'
import { createSQLiteRepository } from './sqliteRepository'
import { SQLiteSyncStore } from './sqliteSyncStore'

export interface OpenedMobileRepository {
  repository: MobileRepository
  syncStore: SQLiteSyncStore
  close(): Promise<void>
}

export async function openMobileRepository(): Promise<OpenedMobileRepository> {
  const database = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true })
  try {
    const port = createExpoDatabasePort(database)
    await migrateDatabase(port)
    const writes = createSqlWriteCoordinator()
    return {
      repository: createSQLiteRepository(port, () => new Date(), writes),
      syncStore: new SQLiteSyncStore(port, writes),
      close: () => database.closeAsync()
    }
  } catch (error) {
    await database.closeAsync().catch(() => undefined)
    throw error
  }
}
