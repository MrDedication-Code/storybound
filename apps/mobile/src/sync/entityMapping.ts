import type { CoreSyncEntityType } from './types'

export interface NormalizedRemoteEntity {
  entityType: CoreSyncEntityType
  entityId: string
  rowVersion: number
  values: Record<string, string | number | null>
}

const coverStyles = ['classic', 'moonlit', 'forest', 'ember', 'ocean', 'rose'] as const

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The decrypted sync record is invalid.')
  }
  return value as Record<string, unknown>
}

function stringValue(row: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = row[key]
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`The synced ${key} is invalid.`)
  }
  return value
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`The synced ${key} is invalid.`)
  return value
}

function numberValue(
  row: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
  integer = false
): number {
  const value = row[key]
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`The synced ${key} is invalid.`)
  }
  return value
}

function nullableNumber(
  row: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number | null {
  if (row[key] === null || row[key] === undefined) return null
  return numberValue(row, key, minimum, maximum)
}

function booleanInteger(row: Record<string, unknown>, key: string): number {
  return numberValue(row, key, 0, 1, true)
}

function version(row: Record<string, unknown>): number {
  return numberValue(row, 'row_version', 1, Number.MAX_SAFE_INTEGER, true)
}

function ensureIdentifier(row: Record<string, unknown>, key: string, entityId: string): void {
  if (stringValue(row, key) !== entityId) {
    throw new Error('The synced record identifier does not match its envelope.')
  }
}

export function coverToneFromStyle(style: string): 'forest' | 'moonlit' | 'ember' {
  if (style === 'moonlit' || style === 'ember') return style
  return 'forest'
}

export function normalizeRemoteEntity(
  entityType: CoreSyncEntityType,
  entityId: string,
  value: unknown
): NormalizedRemoteEntity {
  const row = asRecord(value)
  const rowVersion = version(row)

  if (entityType === 'library') {
    ensureIdentifier(row, 'id', entityId)
    return {
      entityType,
      entityId,
      rowVersion,
      values: {
        id: entityId,
        name: stringValue(row, 'name'),
        description: stringValue(row, 'description', true),
        created_at: stringValue(row, 'created_at'),
        updated_at: stringValue(row, 'updated_at'),
        deleted_at: nullableString(row, 'deleted_at'),
        row_version: rowVersion
      }
    }
  }

  if (entityType === 'book') {
    ensureIdentifier(row, 'id', entityId)
    const status = stringValue(row, 'status')
    if (status !== 'ongoing' && status !== 'completed') {
      throw new Error('The synced book status is invalid.')
    }
    const coverStyle = stringValue(row, 'cover_style')
    if (!coverStyles.includes(coverStyle as (typeof coverStyles)[number])) {
      throw new Error('The synced cover style is invalid.')
    }
    return {
      entityType,
      entityId,
      rowVersion,
      values: {
        id: entityId,
        title: stringValue(row, 'title'),
        blurb: stringValue(row, 'blurb', true),
        status,
        created_at: stringValue(row, 'created_at'),
        updated_at: stringValue(row, 'updated_at'),
        last_opened_at: nullableString(row, 'last_opened_at'),
        completed_at: nullableString(row, 'completed_at'),
        total_word_count: numberValue(row, 'total_word_count', 0, Number.MAX_SAFE_INTEGER, true),
        is_archived: booleanInteger(row, 'is_archived'),
        deleted_at: nullableString(row, 'deleted_at'),
        row_version: rowVersion,
        subtitle: stringValue(row, 'subtitle', true),
        author_name: stringValue(row, 'author_name', true),
        language_code: stringValue(row, 'language_code', true),
        source_label: stringValue(row, 'source_label', true),
        source_url: stringValue(row, 'source_url', true),
        personal_notes: stringValue(row, 'personal_notes', true),
        rating: nullableNumber(row, 'rating', 1, 5),
        favourited_at: nullableString(row, 'favourited_at'),
        pinned_at: nullableString(row, 'pinned_at'),
        series_name: stringValue(row, 'series_name', true),
        series_position: nullableNumber(row, 'series_position', Number.MIN_VALUE),
        cover_style: coverStyle,
        cover_tone: coverToneFromStyle(coverStyle),
        cover_position_x: numberValue(row, 'cover_position_x', 0, 100),
        cover_position_y: numberValue(row, 'cover_position_y', 0, 100)
      }
    }
  }

  if (entityType === 'chapter') {
    ensureIdentifier(row, 'id', entityId)
    return {
      entityType,
      entityId,
      rowVersion,
      values: {
        id: entityId,
        book_id: stringValue(row, 'book_id'),
        title: stringValue(row, 'title'),
        content: stringValue(row, 'content', true),
        position: numberValue(row, 'position', 0, Number.MAX_SAFE_INTEGER, true),
        created_at: stringValue(row, 'created_at'),
        updated_at: stringValue(row, 'updated_at'),
        word_count: numberValue(row, 'word_count', 0, Number.MAX_SAFE_INTEGER, true),
        deleted_at: nullableString(row, 'deleted_at'),
        trashed_from_position: nullableNumber(row, 'trashed_from_position', 0),
        row_version: rowVersion
      }
    }
  }

  ensureIdentifier(row, 'book_id', entityId)
  return {
    entityType,
    entityId,
    rowVersion,
    values: {
      book_id: entityId,
      chapter_id: nullableString(row, 'chapter_id'),
      scroll_position: numberValue(row, 'scroll_position', 0, 1),
      progress_percentage: numberValue(row, 'progress_percentage', 0, 100),
      last_read_at: nullableString(row, 'last_read_at'),
      has_finished_current_content: booleanInteger(row, 'has_finished_current_content'),
      updated_at: stringValue(row, 'updated_at'),
      row_version: rowVersion,
      device_id: nullableString(row, 'device_id')
    }
  }
}
