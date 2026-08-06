import {
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Database,
  Download,
  FolderOpen,
  HardDriveDownload,
  LockKeyhole,
  Moon,
  Play,
  RotateCcw,
  ShieldCheck,
  Sun,
  Trash2,
  Upload
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type {
  AppInfo,
  ApplicationSettings,
  AppTheme,
  BackupCadence,
  BackupPlan,
  LibrarySort,
  ReaderFont,
  ReaderTheme,
  TextAlignment
} from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import {
  Button,
  ConfirmDialog,
  ErrorState,
  InlineNotice,
  LoadingState,
  Modal
} from '../components/ui'

interface SettingsPageProps {
  settings: ApplicationSettings
  updateSettings: (changes: Partial<ApplicationSettings>) => Promise<void>
  notify: (message: string) => void
}

const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'reader-defaults', label: 'Reader' },
  { id: 'data', label: 'Data & recovery' },
  { id: 'about', label: 'About' }
] as const

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

export function SettingsPage({
  settings,
  updateSettings,
  notify
}: SettingsPageProps): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [backupPlans, setBackupPlans] = useState<BackupPlan[]>([])
  const [backupCadence, setBackupCadence] = useState<BackupCadence>('weekly')
  const [backupRetention, setBackupRetention] = useState(7)
  const [error, setError] = useState('')
  const [operation, setOperation] = useState('')
  const [busy, setBusy] = useState('')
  const [reload, setReload] = useState(0)
  const [restoreConfirm, setRestoreConfirm] = useState(false)
  const [encryptedTransfer, setEncryptedTransfer] = useState<'export' | 'restore' | null>(null)
  const [vaultPassphrase, setVaultPassphrase] = useState('')
  const [vaultPassphraseConfirm, setVaultPassphraseConfirm] = useState('')
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('appearance')
  const [showBackToTop, setShowBackToTop] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const [nextInfo, nextBackupPlans] = await Promise.all([
        storyboundApi().app.info(),
        storyboundApi().data.backupPlans.list()
      ])
      setInfo(unwrap(nextInfo))
      setBackupPlans(unwrap(nextBackupPlans))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load, reload])

  useEffect(() => {
    if (!info) return
    const scrollContainer = document.getElementById('main-content')
    if (!scrollContainer) return

    const updateSectionFromScroll = (): void => {
      const containerTop = scrollContainer.getBoundingClientRect().top
      const activationLine = containerTop + Math.min(scrollContainer.clientHeight * 0.2, 150)
      let nextSection: SettingsSectionId = SETTINGS_SECTIONS[0].id

      for (const section of SETTINGS_SECTIONS) {
        const element = document.getElementById(section.id)
        if (element && element.getBoundingClientRect().top <= activationLine) {
          nextSection = section.id
        }
      }
      if (
        scrollContainer.scrollTop + scrollContainer.clientHeight >=
        scrollContainer.scrollHeight - 2
      ) {
        nextSection = SETTINGS_SECTIONS.at(-1)!.id
      }

      setActiveSection(nextSection)
      setShowBackToTop(scrollContainer.scrollTop > 280)
    }

    updateSectionFromScroll()
    scrollContainer.addEventListener('scroll', updateSectionFromScroll, { passive: true })
    window.addEventListener('resize', updateSectionFromScroll)
    return () => {
      scrollContainer.removeEventListener('scroll', updateSectionFromScroll)
      window.removeEventListener('resize', updateSectionFromScroll)
    }
  }, [info])

  const runOperation = async (
    name: string,
    action: () => Promise<{ message: string }>
  ): Promise<boolean> => {
    setBusy(name)
    setError('')
    setOperation('')
    try {
      const result = await action()
      setOperation(result.message)
      notify(result.message)
      return true
    } catch (caught) {
      setError(readableError(caught))
      return false
    } finally {
      setBusy('')
    }
  }

  const scrollToSection = (id: SettingsSectionId): void => {
    setActiveSection(id)
    document.getElementById(id)?.scrollIntoView({
      behavior: settings.reducedMotion ? 'auto' : 'smooth',
      block: 'start'
    })
  }

  const scrollToTop = (): void => {
    const scrollContainer = document.getElementById('main-content')
    const heading = document.getElementById('settings-heading')
    scrollContainer?.scrollTo({
      behavior: settings.reducedMotion ? 'auto' : 'smooth',
      top: 0
    })
    setActiveSection('appearance')
    setShowBackToTop(false)
    heading?.focus({ preventScroll: true })
  }

  const refreshBackupPlans = async (): Promise<void> => {
    setBackupPlans(unwrap(await storyboundApi().data.backupPlans.list()))
  }

  const chooseBackupFolder = async (): Promise<void> => {
    await runOperation('backup-schedule', async () => {
      const plan = unwrap(
        await storyboundApi().data.backupPlans.chooseFolder({
          cadence: backupCadence,
          retentionCount: backupRetention
        })
      )
      if (!plan) return { message: 'Scheduled backup setup canceled.' }
      await refreshBackupPlans()
      return { message: 'Scheduled backups are now enabled.' }
    })
  }

  const updateBackupPlan = async (
    plan: BackupPlan,
    changes: Partial<Pick<BackupPlan, 'cadence' | 'retentionCount' | 'enabled'>>
  ): Promise<void> => {
    await runOperation(`backup-plan-${plan.id}`, async () => {
      unwrap(
        await storyboundApi().data.backupPlans.update({
          id: plan.id,
          cadence: changes.cadence ?? plan.cadence,
          retentionCount: changes.retentionCount ?? plan.retentionCount,
          enabled: changes.enabled ?? plan.enabled
        })
      )
      await refreshBackupPlans()
      return { message: 'Backup schedule updated.' }
    })
  }

  const closeEncryptedTransfer = (): void => {
    setEncryptedTransfer(null)
    setVaultPassphrase('')
    setVaultPassphraseConfirm('')
  }

  const submitEncryptedTransfer = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!encryptedTransfer) return
    if (vaultPassphrase.length < 10) {
      setError('Use at least 10 characters for the vault passphrase.')
      return
    }
    if (encryptedTransfer === 'export' && vaultPassphrase !== vaultPassphraseConfirm) {
      setError('The vault passphrases do not match.')
      return
    }
    const succeeded = await runOperation(`vault-${encryptedTransfer}`, async () =>
      unwrap(
        encryptedTransfer === 'export'
          ? await storyboundApi().data.exportEncrypted({ passphrase: vaultPassphrase })
          : await storyboundApi().data.restoreEncrypted({ passphrase: vaultPassphrase })
      )
    )
    if (succeeded) closeEncryptedTransfer()
  }

  if (error && !info)
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />
      </div>
    )
  if (!info)
    return (
      <div className="page">
        <LoadingState label="Opening settings…" />
      </div>
    )

  return (
    <div className="page page--settings">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Make it yours</p>
          <h1 id="settings-heading" tabIndex={-1}>
            Settings
          </h1>
          <p>Set the mood for your library and keep your stories safe.</p>
        </div>
      </header>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {operation ? <InlineNotice tone="success">{operation}</InlineNotice> : null}

      <div className="settings-layout">
        <nav aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              aria-current={activeSection === section.id ? 'location' : undefined}
              key={section.id}
              type="button"
              onClick={() => scrollToSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <div className="settings-sections">
          <section className="settings-section" id="appearance">
            <div className="settings-section__heading">
              <div className="settings-icon">
                <Moon size={20} />
              </div>
              <div>
                <h2>Appearance</h2>
                <p>Choose how Storybound looks outside the reader.</p>
              </div>
            </div>
            <fieldset className="setting-block">
              <legend>Application theme</legend>
              <div className="theme-cards">
                {(['system', 'dark', 'light'] as AppTheme[]).map((theme) => (
                  <button
                    aria-pressed={settings.appTheme === theme}
                    key={theme}
                    onClick={() => void updateSettings({ appTheme: theme })}
                  >
                    {theme === 'dark' ? (
                      <Moon size={20} />
                    ) : theme === 'light' ? (
                      <Sun size={20} />
                    ) : (
                      <span className="system-theme-icon">
                        <Sun size={16} />
                        <Moon size={16} />
                      </span>
                    )}
                    <strong>{theme[0].toLocaleUpperCase() + theme.slice(1)}</strong>
                    <small>
                      {theme === 'system'
                        ? 'Follow this computer'
                        : `${theme[0].toLocaleUpperCase() + theme.slice(1)} throughout`}
                    </small>
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="switch-row setting-block">
              <span>
                <strong>Reduced motion</strong>
                <small>Minimise lifts, fades, and transitions.</small>
              </span>
              <input
                aria-label="Reduced motion"
                checked={settings.reducedMotion}
                type="checkbox"
                onChange={(event) => void updateSettings({ reducedMotion: event.target.checked })}
              />
            </label>
            <label className="field setting-block">
              <span>Default library sorting</span>
              <select
                aria-label="Default library sorting"
                value={settings.defaultLibrarySort}
                onChange={(event) =>
                  void updateSettings({ defaultLibrarySort: event.target.value as LibrarySort })
                }
              >
                <option value="recently-opened">Recently opened</option>
                <option value="recently-updated">Recently updated</option>
                <option value="title">Title A–Z</option>
                <option value="progress">Reading progress</option>
                <option value="created">Date created</option>
              </select>
            </label>
          </section>

          <section className="settings-section" id="reader-defaults">
            <div className="settings-section__heading">
              <div className="settings-icon">
                <BookTextIcon />
              </div>
              <div>
                <h2>Reader defaults</h2>
                <p>These choices apply to every book and can also be changed while reading.</p>
              </div>
            </div>
            <fieldset className="setting-block">
              <legend>Reading theme</legend>
              <div className="segmented-control wide">
                {(['light', 'sepia', 'dark'] as ReaderTheme[]).map((theme) => (
                  <button
                    aria-pressed={settings.readerTheme === theme}
                    className={`tone-swatch tone-swatch--${theme}`}
                    key={theme}
                    onClick={() => void updateSettings({ readerTheme: theme })}
                  >
                    {theme}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="setting-block">
              <legend>Typeface</legend>
              <div className="segmented-control wide">
                {(['literary', 'classic', 'modern'] as ReaderFont[]).map((font) => (
                  <button
                    aria-pressed={settings.readerFont === font}
                    className={`font-choice font-choice--${font}`}
                    key={font}
                    onClick={() => void updateSettings({ readerFont: font })}
                  >
                    {font}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="settings-range-grid">
              <label className="range-field">
                <span>
                  Font size <output>{settings.readerFontSize}px</output>
                </span>
                <input
                  aria-label="Reader font size"
                  max="34"
                  min="14"
                  step="1"
                  type="range"
                  value={settings.readerFontSize}
                  onChange={(event) =>
                    void updateSettings({ readerFontSize: Number(event.target.value) })
                  }
                />
              </label>
              <label className="range-field">
                <span>
                  Line height <output>{settings.lineHeight.toFixed(1)}</output>
                </span>
                <input
                  aria-label="Reader line height"
                  max="2.2"
                  min="1.3"
                  step="0.1"
                  type="range"
                  value={settings.lineHeight}
                  onChange={(event) =>
                    void updateSettings({ lineHeight: Number(event.target.value) })
                  }
                />
              </label>
              <label className="range-field">
                <span>
                  Column width <output>{settings.columnWidth}px</output>
                </span>
                <input
                  aria-label="Reader column width"
                  max="1000"
                  min="480"
                  step="20"
                  type="range"
                  value={settings.columnWidth}
                  onChange={(event) =>
                    void updateSettings({ columnWidth: Number(event.target.value) })
                  }
                />
              </label>
              <label className="range-field">
                <span>
                  Paragraph spacing <output>{settings.paragraphSpacing.toFixed(1)}em</output>
                </span>
                <input
                  aria-label="Reader paragraph spacing"
                  max="2"
                  min="0"
                  step="0.1"
                  type="range"
                  value={settings.paragraphSpacing}
                  onChange={(event) =>
                    void updateSettings({ paragraphSpacing: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <fieldset className="setting-block">
              <legend>Text alignment</legend>
              <div className="segmented-control">
                {(['left', 'justify'] as TextAlignment[]).map((alignment) => (
                  <button
                    aria-pressed={settings.textAlignment === alignment}
                    key={alignment}
                    onClick={() => void updateSettings({ textAlignment: alignment })}
                  >
                    {alignment}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="switch-row setting-block">
              <span>
                <strong>First-line indentation</strong>
                <small>Use a traditional book-style paragraph indent.</small>
              </span>
              <input
                aria-label="First-line indentation"
                checked={settings.paragraphIndentation}
                type="checkbox"
                onChange={(event) =>
                  void updateSettings({ paragraphIndentation: event.target.checked })
                }
              />
            </label>
          </section>

          <section className="settings-section" id="data">
            <div className="settings-section__heading">
              <div className="settings-icon">
                <Database size={20} />
              </div>
              <div>
                <h2>Data & recovery</h2>
                <p>Your stories live locally. Back them up whenever you like.</p>
              </div>
            </div>
            <div className="scheduled-backups">
              <div className="scheduled-backups__heading">
                <div>
                  <strong>Automatic local backups</strong>
                  <p>Create verified, dated backups while Storybound is open.</p>
                </div>
                <CalendarClock aria-hidden="true" size={21} />
              </div>
              <div className="scheduled-backups__create">
                <label>
                  <span>Frequency</span>
                  <select
                    value={backupCadence}
                    onChange={(event) => setBackupCadence(event.target.value as BackupCadence)}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label>
                  <span>Copies to keep</span>
                  <input
                    max="100"
                    min="1"
                    type="number"
                    value={backupRetention}
                    onChange={(event) =>
                      setBackupRetention(Math.max(1, Math.min(100, Number(event.target.value))))
                    }
                  />
                </label>
                <Button disabled={Boolean(busy)} onClick={() => void chooseBackupFolder()}>
                  Choose folder
                </Button>
              </div>
              {backupPlans.map((plan) => (
                <div className="scheduled-backup-plan" key={plan.id}>
                  <div>
                    <strong>
                      {plan.enabled ? 'Scheduled backups on' : 'Scheduled backups paused'}
                    </strong>
                    <span className="path-text">{plan.destinationPath}</span>
                    <small>
                      {plan.lastRun?.status === 'succeeded'
                        ? `Last verified ${new Date(plan.lastRun.verifiedAt!).toLocaleString()}`
                        : plan.lastRun?.status === 'failed'
                          ? `Last attempt failed: ${plan.lastRun.errorMessage}`
                          : 'No scheduled backup has run yet.'}
                    </small>
                  </div>
                  <label>
                    <span>Frequency</span>
                    <select
                      disabled={Boolean(busy)}
                      value={plan.cadence}
                      onChange={(event) =>
                        void updateBackupPlan(plan, {
                          cadence: event.target.value as BackupCadence
                        })
                      }
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </label>
                  <label className="switch-row">
                    <span>Enabled</span>
                    <input
                      checked={plan.enabled}
                      disabled={Boolean(busy)}
                      type="checkbox"
                      onChange={(event) =>
                        void updateBackupPlan(plan, { enabled: event.target.checked })
                      }
                    />
                  </label>
                  <Button
                    disabled={Boolean(busy)}
                    icon={Play}
                    onClick={() =>
                      void runOperation(`backup-run-${plan.id}`, async () => {
                        const run = unwrap(await storyboundApi().data.backupPlans.run(plan.id))
                        await refreshBackupPlans()
                        return {
                          message: run.outputPath
                            ? `Verified backup created at ${run.outputPath}`
                            : 'Verified backup created.'
                        }
                      })
                    }
                  >
                    Back up now
                  </Button>
                  <Button
                    disabled={Boolean(busy)}
                    icon={Trash2}
                    variant="quiet"
                    onClick={() =>
                      void runOperation(`backup-remove-${plan.id}`, async () => {
                        unwrap(await storyboundApi().data.backupPlans.remove(plan.id))
                        await refreshBackupPlans()
                        return {
                          message: 'Backup schedule removed. Existing backup files were kept.'
                        }
                      })
                    }
                  >
                    Remove schedule
                  </Button>
                </div>
              ))}
            </div>
            <div className="data-actions">
              <div>
                <span className="data-action-icon">
                  <HardDriveDownload size={21} />
                </span>
                <div>
                  <strong>Export library backup</strong>
                  <p>Save every book, cover, bookmark, reading position, and setting.</p>
                </div>
                <Button
                  disabled={Boolean(busy)}
                  icon={Download}
                  onClick={() =>
                    void runOperation('export', async () =>
                      unwrap(await storyboundApi().data.exportLibrary())
                    )
                  }
                >
                  {busy === 'export' ? 'Exporting…' : 'Export backup'}
                </Button>
              </div>
              <div>
                <span className="data-action-icon">
                  <LockKeyhole size={21} />
                </span>
                <div>
                  <strong>Encrypted transfer vault</strong>
                  <p>
                    Create a passphrase-protected library file for a private shared folder or
                    another computer.
                  </p>
                </div>
                <div className="button-pair">
                  <Button
                    disabled={Boolean(busy)}
                    icon={Download}
                    onClick={() => setEncryptedTransfer('export')}
                  >
                    Export vault
                  </Button>
                  <Button
                    disabled={Boolean(busy)}
                    icon={Upload}
                    onClick={() => setEncryptedTransfer('restore')}
                  >
                    Restore vault
                  </Button>
                </div>
              </div>
              <div data-testid="settings-import">
                <span className="data-action-icon">
                  <Upload size={21} />
                </span>
                <div>
                  <strong>Import a Storybound package</strong>
                  <p>Add a previously exported book without changing the rest of your library.</p>
                </div>
                <Button
                  disabled={Boolean(busy)}
                  icon={Upload}
                  onClick={() =>
                    void runOperation('import', async () =>
                      unwrap(await storyboundApi().data.importPackage())
                    )
                  }
                >
                  {busy === 'import' ? 'Importing…' : 'Import package'}
                </Button>
              </div>
              <div>
                <span className="data-action-icon">
                  <RotateCcw size={21} />
                </span>
                <div>
                  <strong>Restore a full backup</strong>
                  <p>
                    Choose a Storybound library backup. Existing data is protected until validation
                    succeeds.
                  </p>
                </div>
                <Button
                  disabled={Boolean(busy)}
                  icon={RotateCcw}
                  onClick={() => setRestoreConfirm(true)}
                >
                  {busy === 'restore' ? 'Restoring…' : 'Restore backup'}
                </Button>
              </div>
              <div>
                <span className="data-action-icon">
                  <ShieldCheck size={21} />
                </span>
                <div>
                  <strong>Check database health</strong>
                  <p>Verify the structure and integrity of your local library.</p>
                </div>
                <Button
                  disabled={Boolean(busy)}
                  icon={CheckCircle2}
                  onClick={() =>
                    void runOperation('integrity', async () => {
                      const result = unwrap(await storyboundApi().data.integrityCheck())
                      return { message: result.details }
                    })
                  }
                >
                  {busy === 'integrity' ? 'Checking…' : 'Run integrity check'}
                </Button>
              </div>
              <div>
                <span className="data-action-icon">
                  <FolderOpen size={21} />
                </span>
                <div>
                  <strong>Local data folder</strong>
                  <p className="path-text">{info.dataPath}</p>
                </div>
                <Button
                  disabled={Boolean(busy)}
                  icon={FolderOpen}
                  onClick={() =>
                    void runOperation('folder', async () =>
                      unwrap(await storyboundApi().app.openDataFolder())
                    )
                  }
                >
                  Open folder
                </Button>
              </div>
            </div>
          </section>

          <section className="settings-section" id="about">
            <div className="about-row">
              <div className="about-mark">S</div>
              <div>
                <strong>{info.name}</strong>
                <span>Version {info.version}</span>
              </div>
              <p>
                No account or telemetry. Story text stays local unless you explicitly run an opt-in
                AI action.
              </p>
            </div>
          </section>
        </div>
      </div>
      {showBackToTop ? (
        <Button className="settings-back-to-top" icon={ArrowUp} onClick={scrollToTop}>
          Back to top
        </Button>
      ) : null}
      {restoreConfirm ? (
        <ConfirmDialog
          busy={busy === 'restore'}
          confirmLabel="Choose backup to restore"
          dangerous
          description="A valid full backup will replace the current library. Export a fresh backup first if you may need these current books later."
          onClose={() => setRestoreConfirm(false)}
          onConfirm={async () => {
            await runOperation('restore', async () =>
              unwrap(await storyboundApi().data.restoreBackup())
            )
            setRestoreConfirm(false)
          }}
          title="Replace this library from a backup?"
        />
      ) : null}
      {encryptedTransfer ? (
        <Modal
          description={
            encryptedTransfer === 'export'
              ? 'Storybound encrypts a complete backup with AES-256-GCM. The passphrase is never saved.'
              : 'Choose an encrypted vault after entering its passphrase. A valid vault replaces this library only after full validation.'
          }
          onClose={closeEncryptedTransfer}
          size="small"
          title={
            encryptedTransfer === 'export' ? 'Export encrypted vault' : 'Restore encrypted vault'
          }
        >
          <form className="form-stack" onSubmit={(event) => void submitEncryptedTransfer(event)}>
            {encryptedTransfer === 'restore' ? (
              <InlineNotice tone="info">
                Restoring replaces the current library. Export a fresh backup first if you may need
                the current books later.
              </InlineNotice>
            ) : null}
            <label className="field">
              <span>Vault passphrase</span>
              <input
                autoComplete="new-password"
                minLength={10}
                required
                type="password"
                value={vaultPassphrase}
                onChange={(event) => setVaultPassphrase(event.target.value)}
              />
              <small>This cannot be recovered by Storybound. Store it in a password manager.</small>
            </label>
            {encryptedTransfer === 'export' ? (
              <label className="field">
                <span>Confirm passphrase</span>
                <input
                  autoComplete="new-password"
                  minLength={10}
                  required
                  type="password"
                  value={vaultPassphraseConfirm}
                  onChange={(event) => setVaultPassphraseConfirm(event.target.value)}
                />
              </label>
            ) : null}
            <div className="modal__actions">
              <Button onClick={closeEncryptedTransfer}>Cancel</Button>
              <Button
                disabled={Boolean(busy)}
                icon={encryptedTransfer === 'export' ? Download : RotateCcw}
                type="submit"
                variant="primary"
              >
                {busy
                  ? encryptedTransfer === 'export'
                    ? 'Encrypting…'
                    : 'Restoring…'
                  : encryptedTransfer === 'export'
                    ? 'Choose destination'
                    : 'Choose vault'}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

function BookTextIcon(): React.JSX.Element {
  return <HardDriveDownload aria-hidden="true" size={20} />
}
