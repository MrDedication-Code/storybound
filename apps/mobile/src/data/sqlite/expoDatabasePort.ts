import type { SQLiteDatabase } from 'expo-sqlite'
import type { SqlDatabasePort } from './databasePort'

export function createExpoDatabasePort(database: SQLiteDatabase): SqlDatabasePort {
  return {
    execAsync(source) {
      return database.execAsync(source)
    },

    runAsync(source, parameters = []) {
      return database.runAsync(source, [...parameters])
    },

    getFirstAsync<Row>(source: string, parameters = []) {
      return database.getFirstAsync<Row>(source, [...parameters])
    },

    getAllAsync<Row>(source: string, parameters = []) {
      return database.getAllAsync<Row>(source, [...parameters])
    },

    transactionAsync(task) {
      return database.withTransactionAsync(async () => {
        await task(createExpoDatabasePort(database))
      })
    }
  }
}
