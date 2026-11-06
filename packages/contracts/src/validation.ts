import { z } from 'zod'
import { SYNC_PROTOCOL_VERSION } from './sync'

const boundedBase64 = z
  .string()
  .min(1)
  .max(8 * 1024 * 1024)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/)
const sequence = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const protocolVersion = z.literal(SYNC_PROTOCOL_VERSION)

export const syncPushBatchRequestSchema = z.object({
  vaultId: z.uuid(),
  deviceId: z.uuid(),
  operationId: z.uuid(),
  baseSequence: sequence,
  protocolVersion,
  keyEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  nonce: boundedBase64.max(64),
  ciphertext: boundedBase64,
  ciphertextHash: boundedBase64.max(128)
})

export const syncPushBatchResultSchema = z.object({
  sequence: sequence,
  headSequence: sequence,
  duplicate: z.boolean()
})

export const syncRemoteBatchSchema = z.object({
  sequence,
  operationId: z.uuid(),
  deviceId: z.uuid(),
  baseSequence: sequence,
  protocolVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  keyEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  nonce: boundedBase64.max(64),
  ciphertext: boundedBase64,
  ciphertextHash: boundedBase64.max(128),
  createdAt: z.iso.datetime({ offset: true })
})

export const syncPullResultSchema = z.object({
  batches: z.array(syncRemoteBatchSchema).max(500),
  nextCursor: sequence,
  headSequence: sequence,
  hasMore: z.boolean()
})

export const ACCOUNT_EXISTS_MESSAGE = 'That email already has an account. Sign in instead.'

/**
 * When an email already has an account, the server answers as if signing up worked, sends nothing,
 * and returns a user with no identities.
 */
export function signUpFoundExistingAccount(
  user: { identities?: unknown[] | null } | null | undefined
): boolean {
  return user?.identities?.length === 0
}

/** With email confirmation off, the server says so directly rather than hiding it. */
export function signUpErrorMessage(error: { code?: string; message: string }): string {
  return error.code === 'user_already_exists' ? ACCOUNT_EXISTS_MESSAGE : error.message
}

export const syncCredentialsSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(10).max(1024)
})

export const syncRecoveryCodeSchema = z
  .string()
  .trim()
  .min(39)
  .max(80)
  .regex(/^[A-Za-z2-9\s-]+$/)
