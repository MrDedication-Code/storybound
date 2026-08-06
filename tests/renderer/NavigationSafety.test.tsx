// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../../src/renderer/src/components/AppShell'
import { SettingsPage } from '../../src/renderer/src/pages/SettingsPage'
import { installApi, settings } from './mockApi'

void React

const scrollIntoView = vi.fn()

describe('hash-router-safe in-page navigation', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })
    scrollIntoView.mockClear()
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('scrolls between Settings sections without replacing the application route', async () => {
    installApi()
    window.location.hash = '#/settings'
    const user = userEvent.setup()
    render(<SettingsPage notify={vi.fn()} settings={settings} updateSettings={vi.fn()} />)

    await screen.findByRole('heading', { level: 1, name: 'Settings' })
    await user.click(screen.getByRole('button', { name: 'Data & recovery' }))

    expect(window.location.hash).toBe('#/settings')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(screen.getByRole('button', { name: 'Data & recovery' })).toHaveAttribute(
      'aria-current',
      'location'
    )
    expect(screen.getByRole('button', { name: 'Appearance' })).not.toHaveAttribute('aria-current')
  })

  it('returns Settings to its heading without changing the application route', async () => {
    installApi()
    window.location.hash = '#/settings'
    const user = userEvent.setup()
    render(
      <main id="main-content">
        <SettingsPage notify={vi.fn()} settings={settings} updateSettings={vi.fn()} />
      </main>
    )

    const heading = await screen.findByRole('heading', { level: 1, name: 'Settings' })
    const mainContent = document.getElementById('main-content')!
    const scrollTo = vi.fn()
    Object.defineProperties(mainContent, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_600 },
      scrollTop: { configurable: true, value: 700, writable: true },
      scrollTo: { configurable: true, value: scrollTo }
    })
    fireEvent.scroll(mainContent)

    await user.click(await screen.findByRole('button', { name: 'Back to top' }))

    expect(window.location.hash).toBe('#/settings')
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 0 })
    expect(heading).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute(
      'aria-current',
      'location'
    )
  })

  it('focuses main content from the skip link without replacing the Library route', async () => {
    window.location.hash = '#/library'
    const user = userEvent.setup()
    render(
      <AppShell active="library" onAddBook={vi.fn()}>
        <h1>Library</h1>
      </AppShell>
    )

    await user.click(screen.getByRole('link', { name: 'Skip to content' }))

    expect(window.location.hash).toBe('#/library')
    expect(document.getElementById('main-content')).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })
})
