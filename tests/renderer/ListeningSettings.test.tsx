// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ListeningSettings } from '../../src/renderer/src/components/ListeningSettings'
import { installApi } from './mockApi'

void React

describe('the free voice on a Mac that cannot run it', () => {
  it('explains why, and offers no download', async () => {
    const api = installApi()
    const status = (await api.narration.status()) as { ok: true; data: never }
    const data = status.data as { kokoro: Record<string, unknown> }
    vi.mocked(api.narration.status).mockResolvedValue({
      ok: true,
      data: {
        ...(data as object),
        kokoro: { ...data.kokoro, unsupportedReason: 'The free voice needs macOS 14 or later.' }
      }
    } as never)
    render(<ListeningSettings notify={vi.fn()} />)
    expect(await screen.findByText(/needs macOS 14 or later/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download the free voice/ })).toBeNull()
  })
})
