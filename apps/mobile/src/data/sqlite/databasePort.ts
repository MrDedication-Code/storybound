export type SqlValue = string | number | null
export type SqlParameters = readonly SqlValue[]

export interface SqlRunResult {
  changes: number
  lastInsertRowId: number
}

export interface SqlDatabasePort {
  execAsync(source: string): Promise<void>
  runAsync(source: string, parameters?: SqlParameters): Promise<SqlRunResult>
  getFirstAsync<Row>(source: string, parameters?: SqlParameters): Promise<Row | null>
  getAllAsync<Row>(source: string, parameters?: SqlParameters): Promise<Row[]>
  transactionAsync(task: (transaction: SqlDatabasePort) => Promise<void>): Promise<void>
}

export interface SqlWriteCoordinator {
  run<Result>(task: () => Promise<Result>): Promise<Result>
}

export function createSqlWriteCoordinator(): SqlWriteCoordinator {
  let queue: Promise<void> = Promise.resolve()
  return {
    run<Result>(task: () => Promise<Result>): Promise<Result> {
      const result = queue.then(task, task)
      queue = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
  }
}
