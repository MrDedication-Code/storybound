import { DatabaseSync } from 'node:sqlite'
import type {
  SqlDatabasePort,
  SqlParameters,
  SqlRunResult
} from '../../src/data/sqlite/databasePort'

export class NodeSqliteDatabase implements SqlDatabasePort {
  private readonly database: DatabaseSync

  constructor(path: string) {
    this.database = new DatabaseSync(path)
  }

  close(): void {
    this.database.close()
  }

  async execAsync(source: string): Promise<void> {
    this.database.exec(source)
  }

  async runAsync(source: string, parameters: SqlParameters = []): Promise<SqlRunResult> {
    const result = this.database.prepare(source).run(...parameters)
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid)
    }
  }

  async getFirstAsync<Row>(source: string, parameters: SqlParameters = []): Promise<Row | null> {
    return (this.database.prepare(source).get(...parameters) as Row | undefined) ?? null
  }

  async getAllAsync<Row>(source: string, parameters: SqlParameters = []): Promise<Row[]> {
    return this.database.prepare(source).all(...parameters) as Row[]
  }

  async transactionAsync(task: (transaction: SqlDatabasePort) => Promise<void>): Promise<void> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      await task(this)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}
