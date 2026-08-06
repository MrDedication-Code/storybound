import { describe, expect, it, vi } from 'vitest'
import {
  MAX_ASSISTANT_CONTEXT_LENGTH,
  MAX_ASSISTANT_TEXT_LENGTH,
  OPENAI_ASSISTANT_MODEL,
  OPENAI_RESPONSES_URL,
  OpenAIAssistantError,
  requestOpenAIAssistance
} from '../../src/main/openaiAssistant'

describe('optional OpenAI assistant', () => {
  it('sends the privacy-preserving Responses API body with the requested model and no tools', async () => {
    const apiKey = 'private-test-key'
    const fetchImpl = vi.fn(async (...requestArguments: [string, RequestInit]) => {
      void requestArguments
      return {
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => ({ output_text: 'A quiet, compelling blurb.' })
      } as const
    })

    await expect(
      requestOpenAIAssistance(
        {
          apiKey: `  ${apiKey}  `,
          task: 'blurb',
          text: 'A reader finds a sealed library.',
          context: 'A gentle mystery for adults.'
        },
        fetchImpl
      )
    ).resolves.toBe('A quiet, compelling blurb.')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(OPENAI_RESPONSES_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: OPENAI_ASSISTANT_MODEL,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 800
    })
    expect(body).not.toHaveProperty('tools')
    expect(body.instructions).toContain('book blurb')
    expect(body.input).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: expect.stringContaining('A reader finds a sealed library.')
          }
        ]
      }
    ])
    expect(String(init.body)).not.toContain(apiKey)
  })

  it('extracts and joins text from message content for chapter cleanup', async () => {
    const fetchImpl = vi.fn(async (...requestArguments: [string, RequestInit]) => {
      void requestArguments
      return {
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => ({
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: 'First paragraph.' },
                { type: 'output_text', text: 'Second paragraph.' }
              ]
            }
          ]
        })
      } as const
    })

    const result = await requestOpenAIAssistance(
      { apiKey: 'key', task: 'chapter-cleanup', text: 'First paragraph.Second paragraph.' },
      fetchImpl
    )

    expect(result).toBe('First paragraph.\nSecond paragraph.')
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body)) as Record<string, unknown>
    expect(body.max_output_tokens).toBe(16_000)
    expect(body.instructions).toContain('Preserve its meaning, voice, Markdown')
  })

  it('validates key, content, and bounded input before contacting OpenAI', async () => {
    const fetchImpl = vi.fn()

    await expect(
      requestOpenAIAssistance({ apiKey: '   ', task: 'blurb', text: 'Story' }, fetchImpl)
    ).rejects.toMatchObject({ kind: 'validation' })
    await expect(
      requestOpenAIAssistance({ apiKey: 'key', task: 'blurb', text: '   ' }, fetchImpl)
    ).rejects.toMatchObject({ kind: 'validation' })
    await expect(
      requestOpenAIAssistance(
        { apiKey: 'key', task: 'chapter-cleanup', text: 'x'.repeat(MAX_ASSISTANT_TEXT_LENGTH + 1) },
        fetchImpl
      )
    ).rejects.toThrow('50,000 characters')
    await expect(
      requestOpenAIAssistance(
        {
          apiKey: 'key',
          task: 'blurb',
          text: 'Story',
          context: 'x'.repeat(MAX_ASSISTANT_CONTEXT_LENGTH + 1)
        },
        fetchImpl
      )
    ).rejects.toThrow('10,000 characters')

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports HTTP status without reading or exposing the response body', async () => {
    const apiKey = 'do-not-leak-this-key'
    const json = vi.fn(async (): Promise<unknown> => ({
      error: { message: `server echoed ${apiKey}` }
    }))
    const fetchImpl = vi.fn(async (...requestArguments: [string, RequestInit]) => {
      void requestArguments
      return { ok: false, status: 429, json }
    })

    const error = await requestOpenAIAssistance(
      { apiKey, task: 'blurb', text: 'Story' },
      fetchImpl
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpenAIAssistantError)
    expect(error).toMatchObject({ kind: 'http', status: 429 })
    expect((error as Error).message).toContain('HTTP 429')
    expect((error as Error).message).not.toContain(apiKey)
    expect(json).not.toHaveBeenCalled()
  })

  it('hides network details and secrets from the caller', async () => {
    const apiKey = 'network-secret-key'
    const fetchImpl = vi.fn(async (...requestArguments: [string, RequestInit]): Promise<never> => {
      void requestArguments
      throw new Error(`socket failed while using ${apiKey}`)
    })

    const error = await requestOpenAIAssistance(
      { apiKey, task: 'blurb', text: 'Story' },
      fetchImpl
    ).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ kind: 'network' })
    expect((error as Error).message).not.toContain(apiKey)
    expect((error as Error).message).not.toContain('socket failed')
    expect((error as Error).cause).toBeUndefined()
  })

  it('turns refusals, invalid JSON, and empty payloads into safe errors', async () => {
    const refusalFetch = vi.fn(async (...requestArguments: [string, RequestInit]) => {
      void requestArguments
      return {
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => ({
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'sensitive response detail' }]
            }
          ]
        })
      } as const
    })
    await expect(
      requestOpenAIAssistance({ apiKey: 'key', task: 'blurb', text: 'Story' }, refusalFetch)
    ).rejects.toMatchObject({ kind: 'refusal' })

    const invalidJsonFetch = vi.fn(async (...requestArguments: [string, RequestInit]) => {
      void requestArguments
      return {
        ok: true,
        status: 200,
        json: async (): Promise<never> => {
          throw new Error('secret parser detail')
        }
      } as const
    })
    await expect(
      requestOpenAIAssistance({ apiKey: 'key', task: 'blurb', text: 'Story' }, invalidJsonFetch)
    ).rejects.toMatchObject({ kind: 'malformed' })

    const emptyFetch = vi.fn(async (...requestArguments: [string, RequestInit]) => {
      void requestArguments
      return {
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => ({ output: [] })
      } as const
    })
    await expect(
      requestOpenAIAssistance({ apiKey: 'key', task: 'blurb', text: 'Story' }, emptyFetch)
    ).rejects.toMatchObject({ kind: 'malformed' })
  })
})
