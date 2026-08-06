// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../../src/renderer/src/App'
import { installApi } from './mockApi'

void React

describe('application close preparation', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('immediately confirms an ordinary route with no pending durability tasks', async () => {
    const api = installApi()
    window.location.hash = '#/library'
    render(<App />)
    await screen.findByRole('heading', { name: 'Library' })

    act(() => {
      window.dispatchEvent(new CustomEvent('storybound:command', { detail: 'prepare-close' }))
    })

    await waitFor(() => expect(api.app.confirmClose).toHaveBeenCalledWith(true))
  })

  it('announces route changes through the window title and main-content focus', async () => {
    installApi()
    window.location.hash = '#/library'
    render(<App />)

    await screen.findByRole('heading', { name: 'Library' })
    await waitFor(() => expect(document.title).toBe('Library — Storybound'))
    await waitFor(() => expect(document.getElementById('main-content')).toHaveFocus())
  })
})
