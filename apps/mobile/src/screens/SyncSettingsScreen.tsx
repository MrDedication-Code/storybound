import type { DeviceLinkState, SyncRuntimeStatus } from '@storybound/contracts'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { AppHeader } from '../components/AppHeader'
import { PrimaryButton } from '../components/PrimaryButton'
import { ErrorScreen, LoadingScreen } from '../components/ScreenState'
import type { MobileSyncController } from '../sync/types'
import { compactCaps, literaryHeading, storyboundColors, storyboundRadii } from '../theme'

export function SyncSettingsScreen({
  controller,
  onBack,
  onHome
}: {
  controller: MobileSyncController
  onBack: () => void
  onHome: () => void
}): React.JSX.Element {
  const [status, setStatus] = useState<SyncRuntimeStatus | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [deviceName, setDeviceName] = useState('Storybound mobile')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [newRecoveryCode, setNewRecoveryCode] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<DeviceLinkState | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setStatus(await controller.status())
  }, [controller])

  useEffect(() => {
    let active = true
    void controller
      .status()
      .then((nextStatus) => {
        if (active) setStatus(nextStatus)
      })
      .catch((caught: unknown) => {
        if (active) setError(messageFrom(caught, 'Sync status could not be checked.'))
      })
    return () => {
      active = false
    }
  }, [controller])

  const linkPhase = link?.phase
  useEffect(() => {
    let active = true
    // Resume a link started before this screen was last open.
    void controller
      .checkDeviceLink()
      .then((state) => {
        if (active && state) setLink(state)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [controller])

  useEffect(() => {
    if (linkPhase !== 'waiting' && linkPhase !== 'compare') return
    let active = true
    const timer = setInterval(() => {
      void controller
        .checkDeviceLink()
        .then(async (state) => {
          if (!active) return
          setLink(state)
          if (state?.phase === 'linked') {
            setNotice('This device is linked. Downloading your library…')
            await refresh()
            const result = await controller.syncNow()
            if (active) setNotice(`Linked and synced: ${result.pulled} items downloaded.`)
            await refresh()
          }
        })
        .catch((caught: unknown) => {
          if (!active) return
          setLink(null)
          setError(messageFrom(caught, 'Linking could not be completed.'))
        })
    }, LINK_POLL_MILLISECONDS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [controller, linkPhase, refresh])

  const perform = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await refresh()
    } catch (caught) {
      setError(messageFrom(caught, 'That sync action could not be completed.'))
      await refresh().catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  if (error && !status) return <ErrorScreen message={error} onBack={onBack} />
  if (!status) return <LoadingScreen label="Checking encrypted sync…" />

  const signedIn = Boolean(status.accountEmail)
  const unlocked = signedIn && Boolean(status.deviceId)

  return (
    <View style={styles.screen}>
      <AppHeader title="Sync & devices" onBack={onBack} />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Encrypted device sync</Text>
        <Text style={styles.intro}>
          Your library is encrypted on this device before it is uploaded. Link this phone by
          approving it from your Mac, or unlock it with your recovery code.
        </Text>

        <StatusCard status={status} />

        {!status.configured ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Local-only build</Text>
            <Text style={styles.noticeCopy}>
              Add the Storybound Supabase URL and publishable key at build time to enable optional
              account sync. Your library remains available without them.
            </Text>
          </View>
        ) : !signedIn ? (
          <View style={styles.section}>
            <Text style={compactCaps}>Storybound account</Text>
            <Field
              autoComplete="email"
              keyboardType="email-address"
              label="Email"
              value={email}
              onChangeText={setEmail}
            />
            <Field
              autoComplete="current-password"
              label="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <PrimaryButton
              disabled={busy || !email.trim() || !password}
              label="Sign in"
              onPress={() =>
                void perform(async () => {
                  await controller.signIn(email, password)
                  setPassword('')
                  setNotice('Signed in securely.')
                })
              }
            />
            <PrimaryButton
              disabled={busy || !email.trim() || !password}
              label="Create account"
              style={styles.secondaryAction}
              variant="secondary"
              onPress={() =>
                void perform(async () => {
                  const next = await controller.signUp(email, password)
                  setPassword('')
                  setNotice(
                    next.accountEmail
                      ? 'Account created and signed in.'
                      : 'Account created. Confirm your email, then sign in.'
                  )
                })
              }
            />
          </View>
        ) : !unlocked ? (
          <View style={styles.section}>
            <Text style={compactCaps}>Link to your Mac</Text>
            <LinkPanel
              busy={busy}
              link={link}
              onCancel={() =>
                void perform(async () => {
                  await controller.cancelDeviceLink()
                  setLink(null)
                })
              }
              onConfirm={() =>
                void perform(async () => {
                  const state = await controller.confirmDeviceLinkWords()
                  setLink(state)
                  if (state?.phase === 'linked') {
                    const result = await controller.syncNow()
                    setNotice(`Linked and synced: ${result.pulled} items downloaded.`)
                  }
                })
              }
              onStart={() =>
                void perform(async () => {
                  setLink(await controller.startDeviceLink(deviceName))
                })
              }
            />
            <Field label="Device name" value={deviceName} onChangeText={setDeviceName} />
            <Text style={[compactCaps, styles.alternativeHeading]}>Or use your recovery code</Text>
            <Text style={styles.sectionCopy}>
              Enter the recovery code from your first Storybound device, or create a new encrypted
              vault if this account has none yet.
            </Text>
            <Field
              autoCapitalize="characters"
              label="Recovery code"
              multiline
              value={recoveryInput}
              onChangeText={setRecoveryInput}
            />
            <PrimaryButton
              disabled={busy || !recoveryInput.trim()}
              label="Recover existing vault"
              onPress={() =>
                void perform(async () => {
                  await controller.recoverVault(recoveryInput, deviceName)
                  setRecoveryInput('')
                  setNotice('This device can now decrypt your synced library.')
                })
              }
            />
            <PrimaryButton
              disabled={busy}
              label="Create new vault"
              style={styles.secondaryAction}
              variant="secondary"
              onPress={() =>
                void perform(async () => {
                  const result = await controller.createVault(deviceName)
                  setNewRecoveryCode(result.recoveryCode)
                  setNotice('Encrypted sync is ready. Save the recovery code below now.')
                })
              }
            />
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={compactCaps}>This device</Text>
            <Text style={styles.sectionCopy}>
              Sync uploads only ciphertext and downloads changes made by your other Storybound
              devices.
            </Text>
            <PrimaryButton
              disabled={busy}
              label={busy ? 'Syncing…' : 'Sync now'}
              onPress={() =>
                void perform(async () => {
                  const result = await controller.syncNow()
                  setNotice(
                    `Sync complete: ${result.pulled} pulled, ${result.pushed} pushed, ${result.conflicts} conflicts.`
                  )
                })
              }
            />
            <PrimaryButton
              disabled={busy}
              label="Sign out"
              style={styles.secondaryAction}
              variant="quiet"
              onPress={() =>
                void perform(async () => {
                  await controller.signOut()
                  setNotice('Signed out. Local stories remain on this device.')
                })
              }
            />
          </View>
        )}

        {newRecoveryCode ? (
          <View style={styles.recoveryCard}>
            <Text style={styles.recoveryTitle}>Save this recovery code</Text>
            <Text selectable style={styles.recoveryCode}>
              {newRecoveryCode}
            </Text>
            <Text style={styles.recoveryWarning}>
              Store it somewhere private. Storybound cannot recover the vault key without it.
            </Text>
          </View>
        ) : null}

        {busy ? <ActivityIndicator color={storyboundColors.brass} style={styles.spinner} /> : null}
        {notice ? <Text style={styles.successMessage}>{notice}</Text> : null}
        {error ? <Text style={styles.errorMessage}>{error}</Text> : null}
        {status.lastError && status.lastError !== error ? (
          <Text style={styles.errorMessage}>{status.lastError}</Text>
        ) : null}

        <View style={styles.privacyCard}>
          <Text style={styles.noticeTitle}>Your key never reaches the server readable</Text>
          <Text style={styles.noticeCopy}>
            When you link by approval, your Mac seals the library key so only this phone can open
            it, and the six words prove nothing swapped in between. The server stores only sealed
            envelopes, never your readable key or stories. Signing out never removes the local
            library.
          </Text>
        </View>
        <PrimaryButton label="Return to library" onPress={onHome} />
      </ScrollView>
    </View>
  )
}

function Field({
  label,
  value,
  onChangeText,
  secureTextEntry = false,
  multiline = false,
  keyboardType = 'default',
  autoComplete,
  autoCapitalize = 'none'
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  secureTextEntry?: boolean
  multiline?: boolean
  keyboardType?: 'default' | 'email-address'
  autoComplete?: 'email' | 'current-password'
  autoCapitalize?: 'none' | 'characters'
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        keyboardType={keyboardType}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  )
}

const LINK_POLL_MILLISECONDS = 2_000

function LinkPanel({
  link,
  busy,
  onStart,
  onConfirm,
  onCancel
}: {
  link: DeviceLinkState | null
  busy: boolean
  onStart: () => void
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  if (link?.phase === 'waiting') {
    return (
      <View style={styles.linkCard}>
        <Text style={styles.linkTitle}>Waiting for your Mac…</Text>
        <Text style={styles.sectionCopy}>
          On your Mac, open Storybound, then Settings → Sync & devices. A request from this phone
          will appear there with six words.
        </Text>
        <ActivityIndicator color={storyboundColors.brass} style={styles.spinner} />
        <PrimaryButton disabled={busy} label="Cancel" variant="quiet" onPress={onCancel} />
      </View>
    )
  }
  if (link?.phase === 'compare' && link.words) {
    return (
      <View style={styles.linkCard}>
        <Text style={styles.linkTitle}>
          {link.confirmed ? 'Now approve on your Mac' : 'Do these words match your Mac?'}
        </Text>
        <View accessibilityLabel={`Words: ${link.words.join(', ')}`} style={styles.wordGrid}>
          {link.words.map((word, index) => (
            <Text key={`${index}-${word}`} style={styles.word}>
              <Text style={styles.wordNumber}>{index + 1}. </Text>
              {word}
            </Text>
          ))}
        </View>
        {link.confirmed ? (
          <>
            <Text style={styles.sectionCopy}>
              On your Mac, click “The words match, approve”. This phone will finish by itself.
            </Text>
            <ActivityIndicator color={storyboundColors.brass} style={styles.spinner} />
            <PrimaryButton disabled={busy} label="Cancel" variant="quiet" onPress={onCancel} />
          </>
        ) : (
          <>
            <Text style={styles.sectionCopy}>
              Check that your Mac shows exactly these six words, in this order.
            </Text>
            <PrimaryButton disabled={busy} label="They match" onPress={onConfirm} />
            <PrimaryButton
              disabled={busy}
              label="They don’t match"
              style={styles.secondaryAction}
              variant="quiet"
              onPress={onCancel}
            />
          </>
        )}
      </View>
    )
  }
  const ended =
    link?.phase === 'expired'
      ? 'That request expired. Start again when your Mac is ready.'
      : link?.phase === 'declined'
        ? 'Your Mac declined that request.'
        : null
  return (
    <View style={styles.linkCard}>
      <Text style={styles.sectionCopy}>
        The easy way: approve this phone from Storybound on your Mac. No code to type.
      </Text>
      {ended ? <Text style={styles.errorMessage}>{ended}</Text> : null}
      <PrimaryButton disabled={busy} label="Link to my Mac" onPress={onStart} />
    </View>
  )
}

function StatusCard({ status }: { status: SyncRuntimeStatus }): React.JSX.Element {
  return (
    <View style={styles.statusCard}>
      <View style={styles.statusTop}>
        <View>
          <Text style={compactCaps}>Current mode</Text>
          <Text style={styles.statusTitle}>{phaseLabel(status.phase)}</Text>
        </View>
        <View style={styles.statusBadge}>
          <Text style={styles.statusBadgeText}>{status.configured ? 'Encrypted' : 'Local'}</Text>
        </View>
      </View>
      <Detail label="Account" value={status.accountEmail ?? 'Not signed in'} />
      <Detail label="Pending changes" value={String(status.pendingChanges)} />
      <Detail label="Open conflicts" value={String(status.openConflicts)} />
      <Detail label="Last sync" value={formatDate(status.lastSyncAt)} />
    </View>
  )
}

function Detail({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.detailValue}>
        {value}
      </Text>
    </View>
  )
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function phaseLabel(phase: SyncRuntimeStatus['phase']): string {
  return {
    'local-only': 'Offline only',
    'signed-out': 'Signed out',
    locked: 'Recovery required',
    idle: 'Ready to sync',
    syncing: 'Syncing',
    offline: 'Offline',
    error: 'Needs attention'
  }[phase]
}

function formatDate(value: string | null): string {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: storyboundColors.paper
  },
  content: {
    padding: 22,
    paddingBottom: 64
  },
  title: {
    ...literaryHeading,
    marginTop: 18,
    fontSize: 30,
    textAlign: 'center'
  },
  intro: {
    maxWidth: 600,
    alignSelf: 'center',
    marginTop: 10,
    color: storyboundColors.muted,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center'
  },
  statusCard: {
    marginTop: 26,
    padding: 18,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.medium,
    borderWidth: 1,
    backgroundColor: storyboundColors.paperRaised
  },
  statusTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15
  },
  statusTitle: {
    marginTop: 4,
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 21,
    fontWeight: '700'
  },
  statusBadge: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#dfeae2'
  },
  statusBadgeText: {
    color: storyboundColors.success,
    fontSize: 12,
    fontWeight: '700'
  },
  detailRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopColor: storyboundColors.line,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  detailLabel: {
    color: storyboundColors.muted,
    fontSize: 13
  },
  detailValue: {
    flex: 1,
    color: storyboundColors.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right'
  },
  section: {
    marginTop: 30
  },
  sectionCopy: {
    marginTop: 8,
    marginBottom: 4,
    color: storyboundColors.muted,
    fontSize: 14,
    lineHeight: 21
  },
  field: {
    marginTop: 16
  },
  fieldLabel: {
    marginBottom: 7,
    color: storyboundColors.text,
    fontSize: 13,
    fontWeight: '700'
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.small,
    borderWidth: 1,
    backgroundColor: storyboundColors.paperRaised,
    color: storyboundColors.text,
    fontSize: 15
  },
  multilineInput: {
    minHeight: 84,
    paddingTop: 13,
    textAlignVertical: 'top'
  },
  alternativeHeading: {
    marginTop: 24
  },
  linkCard: {
    gap: 10,
    marginBottom: 18,
    padding: 16,
    borderColor: storyboundColors.brass,
    borderRadius: storyboundRadii.medium,
    borderWidth: 1,
    backgroundColor: storyboundColors.paperRaised
  },
  linkTitle: {
    ...literaryHeading,
    fontSize: 20
  },
  wordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  word: {
    width: '47%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.medium - 6,
    borderWidth: 1,
    color: storyboundColors.text,
    fontSize: 18,
    fontWeight: '600'
  },
  wordNumber: {
    color: storyboundColors.muted,
    fontSize: 12
  },
  secondaryAction: {
    marginTop: 10
  },
  notice: {
    marginTop: 28,
    padding: 17,
    borderRadius: storyboundRadii.medium,
    backgroundColor: storyboundColors.parchment
  },
  privacyCard: {
    marginVertical: 28,
    padding: 17,
    borderRadius: storyboundRadii.medium,
    backgroundColor: storyboundColors.parchment
  },
  noticeTitle: {
    color: storyboundColors.text,
    fontWeight: '700'
  },
  noticeCopy: {
    marginTop: 6,
    color: storyboundColors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  recoveryCard: {
    marginTop: 24,
    padding: 17,
    borderColor: storyboundColors.brass,
    borderRadius: storyboundRadii.medium,
    borderWidth: 1,
    backgroundColor: '#fff4d9'
  },
  recoveryTitle: {
    color: storyboundColors.text,
    fontSize: 15,
    fontWeight: '700'
  },
  recoveryCode: {
    marginTop: 12,
    color: storyboundColors.text,
    fontFamily: 'monospace',
    fontSize: 17,
    lineHeight: 25
  },
  recoveryWarning: {
    marginTop: 10,
    color: storyboundColors.danger,
    fontSize: 13,
    lineHeight: 19
  },
  spinner: {
    marginTop: 18
  },
  successMessage: {
    marginTop: 18,
    color: storyboundColors.success,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center'
  },
  errorMessage: {
    marginTop: 18,
    color: storyboundColors.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center'
  }
})
