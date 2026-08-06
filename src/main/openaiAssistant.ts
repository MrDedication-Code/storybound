export type OpenAIAssistantTask = 'blurb' | 'chapter-cleanup'

export interface OpenAIAssistantRequest {
  apiKey: string
  task: OpenAIAssistantTask
  text: string
  context?: string
}

export interface OpenAIAssistantFetchResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type OpenAIAssistantFetch = (
  url: string,
  init: RequestInit
) => Promise<OpenAIAssistantFetchResponse>

export type OpenAIAssistantErrorKind = 'validation' | 'network' | 'http' | 'refusal' | 'malformed'

export class OpenAIAssistantError extends Error {
  readonly kind: OpenAIAssistantErrorKind
  readonly status?: number

  constructor(kind: OpenAIAssistantErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'OpenAIAssistantError'
    this.kind = kind
    this.status = status
  }
}

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
export const OPENAI_ASSISTANT_MODEL = 'gpt-5.6-luna'
export const MAX_ASSISTANT_TEXT_LENGTH = 50_000
export const MAX_ASSISTANT_CONTEXT_LENGTH = 10_000

const TASK_OPTIONS: Record<OpenAIAssistantTask, { instructions: string; maxOutputTokens: number }> =
  {
    blurb: {
      instructions:
        'Write a concise, engaging book blurb from the supplied text. Preserve factual details and do not invent plot points. Return only the blurb.',
      maxOutputTokens: 800
    },
    'chapter-cleanup': {
      instructions:
        'Lightly correct grammar, spelling, punctuation, and readability in the supplied chapter. Preserve its meaning, voice, Markdown, and paragraph structure. Return only the revised chapter.',
      maxOutputTokens: 16_000
    }
  }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateRequest(request: OpenAIAssistantRequest): {
  apiKey: string
  text: string
  context?: string
} {
  const apiKey = typeof request.apiKey === 'string' ? request.apiKey.trim() : ''
  if (!apiKey) {
    throw new OpenAIAssistantError('validation', 'Add an OpenAI API key before using this helper.')
  }

  const text = typeof request.text === 'string' ? request.text : ''
  if (!text.trim()) {
    throw new OpenAIAssistantError('validation', 'Add some text for the assistant to work with.')
  }
  if (text.length > MAX_ASSISTANT_TEXT_LENGTH) {
    throw new OpenAIAssistantError(
      'validation',
      `The selected text is too long. Use no more than ${MAX_ASSISTANT_TEXT_LENGTH.toLocaleString('en-US')} characters.`
    )
  }

  const context = typeof request.context === 'string' ? request.context : undefined
  if (context && context.length > MAX_ASSISTANT_CONTEXT_LENGTH) {
    throw new OpenAIAssistantError(
      'validation',
      `The supporting context is too long. Use no more than ${MAX_ASSISTANT_CONTEXT_LENGTH.toLocaleString('en-US')} characters.`
    )
  }

  return { apiKey, text, context: context?.trim() ? context : undefined }
}

function inputText(text: string, context?: string): string {
  if (!context) return text
  return `Context (use only when relevant):\n${context}\n\nText:\n${text}`
}

function extractAssistantText(payload: unknown): { text?: string; refused: boolean } {
  if (!isRecord(payload)) return { refused: false }

  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return { text: payload.output_text.trim(), refused: false }
  }

  const textParts: string[] = []
  let refused = false
  if (!Array.isArray(payload.output)) return { refused }

  for (const item of payload.output) {
    if (!isRecord(item)) continue
    if (item.type === 'refusal' || typeof item.refusal === 'string') refused = true
    if (!Array.isArray(item.content)) continue

    for (const content of item.content) {
      if (!isRecord(content)) continue
      if (content.type === 'refusal' || typeof content.refusal === 'string') refused = true
      if (
        (content.type === 'output_text' || content.type === 'text') &&
        typeof content.text === 'string' &&
        content.text.trim()
      ) {
        textParts.push(content.text.trim())
      }
    }
  }

  const text = textParts.join('\n').trim()
  return { text: text || undefined, refused }
}

function httpError(status: number): OpenAIAssistantError {
  if (status === 401 || status === 403) {
    return new OpenAIAssistantError(
      'http',
      `OpenAI could not authorize the request (HTTP ${status}). Check the API key and try again.`,
      status
    )
  }
  if (status === 429) {
    return new OpenAIAssistantError(
      'http',
      'OpenAI is receiving too many requests (HTTP 429). Wait a moment and try again.',
      status
    )
  }
  return new OpenAIAssistantError(
    'http',
    `OpenAI could not complete the request (HTTP ${status}). Please try again.`,
    status
  )
}

/**
 * Run a small, opt-in text task through the Responses API.
 *
 * The transport is injectable so callers can test this boundary without making a network request.
 */
export async function requestOpenAIAssistance(
  request: OpenAIAssistantRequest,
  fetchImpl: OpenAIAssistantFetch = globalThis.fetch
): Promise<string> {
  const { apiKey, text, context } = validateRequest(request)
  const options = TASK_OPTIONS[request.task]
  if (!options) {
    throw new OpenAIAssistantError('validation', 'Choose a supported assistant task.')
  }

  let response: OpenAIAssistantFetchResponse
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_ASSISTANT_MODEL,
        store: false,
        reasoning: { effort: 'low' },
        instructions: options.instructions,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: inputText(text, context) }]
          }
        ],
        max_output_tokens: options.maxOutputTokens
      })
    })
  } catch {
    throw new OpenAIAssistantError(
      'network',
      'OpenAI could not be reached. Check your connection and try again.'
    )
  }

  if (!response.ok) throw httpError(response.status)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new OpenAIAssistantError(
      'malformed',
      'OpenAI returned an unreadable response. Please try again.'
    )
  }

  const output = extractAssistantText(payload)
  if (output.text) return output.text
  if (output.refused) {
    throw new OpenAIAssistantError(
      'refusal',
      'OpenAI could not help with that text. Try changing the selection or task.'
    )
  }

  throw new OpenAIAssistantError(
    'malformed',
    'OpenAI returned an empty response. Please try again.'
  )
}
