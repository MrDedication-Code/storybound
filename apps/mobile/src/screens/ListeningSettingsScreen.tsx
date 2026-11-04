import { GEMINI_DEFAULT_STYLE, type GeminiVoice } from '@storybound/narration'
import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native'
import { AppHeader } from '../components/AppHeader'
import { PrimaryButton } from '../components/PrimaryButton'
import { checkGeminiKey, searchGeminiVoices, speakWithGoogle } from '../narration/googleVoice'
import { listeningSession } from '../narration'
import {
  loadGeminiKey,
  loadNarrationSettings,
  removeGeminiKey,
  saveGeminiKey,
  saveNarrationSettings,
  type NarrationSettings
} from '../narration/narrationSettings'
import { literaryHeading, storyboundColors, storyboundRadii } from '../theme'

const PREVIEW_TEXT =
  'The lamp went out at midnight. Somewhere below, a door closed softly, and then there was nothing at all.'
const KEY_PATTERN = /^[A-Za-z0-9_-]{20,200}$/

/** Listening settings: the Google key, permission to send text, the voice, and how it reads. */
export function ListeningSettingsScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [settings, setSettings] = useState<NarrationSettings | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [style, setStyle] = useState(GEMINI_DEFAULT_STYLE)
  const [search, setSearch] = useState('')
  const [voices, setVoices] = useState<GeminiVoice[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const previewRef = useRef<AudioPlayer | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([loadNarrationSettings(), loadGeminiKey()]).then(([loaded, key]) => {
      if (!active) return
      setSettings(loaded)
      setStyle(loaded.geminiStyle)
      setHasKey(Boolean(key))
    })
    return () => {
      active = false
      previewRef.current?.remove()
    }
  }, [])

  const run = async (name: string, action: () => Promise<void>): Promise<void> => {
    Keyboard.dismiss()
    setBusy(name)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.')
    } finally {
      setBusy('')
    }
  }

  const change = async (changes: Partial<NarrationSettings>, message?: string): Promise<void> => {
    setSettings(await saveNarrationSettings(changes))
    if (message) setNotice(message)
  }

  const requireKey = async (): Promise<string> => {
    const key = await loadGeminiKey()
    if (!key) throw new Error('Add your Google API key first.')
    return key
  }

  if (!settings) {
    return (
      <View style={styles.screen}>
        <AppHeader title="Listening" onBack={onBack} />
        <ActivityIndicator color={storyboundColors.brass} style={styles.spinner} />
      </View>
    )
  }

  const ready = hasKey && settings.geminiConsent

  return (
    <View style={styles.screen}>
      <AppHeader subtitle="Read aloud" title="Listening" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Listen to your books</Text>
        <Text style={styles.intro}>
          Storybound reads chapters aloud in Google&apos;s natural voice. It keeps going with the
          screen off, works with headphone and lock-screen controls, and saves your place as it
          reads.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Google API key</Text>
          <Text style={styles.copy}>
            Uses Gemini text-to-speech with a key from your own Google account, billed by Google as
            you go: roughly $4–9 for a full-length novel until the end of 2026. Passages you have
            heard are kept on this phone, so listening again costs nothing.
          </Text>
          {hasKey ? (
            <View style={styles.row}>
              <Text style={styles.saved}>Key saved on this phone only.</Text>
              <PrimaryButton
                disabled={Boolean(busy)}
                label="Remove key"
                variant="quiet"
                onPress={() =>
                  void run('remove', async () => {
                    listeningSession().stop()
                    await removeGeminiKey()
                    setHasKey(false)
                    setVoices(null)
                    setNotice('Google API key removed.')
                  })
                }
              />
            </View>
          ) : (
            <>
              <TextInput
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                placeholder="Paste the key from Google AI Studio"
                placeholderTextColor={storyboundColors.muted}
                secureTextEntry
                style={styles.input}
                value={keyInput}
                onChangeText={setKeyInput}
              />
              <PrimaryButton
                disabled={Boolean(busy) || !keyInput.trim()}
                label={busy === 'key' ? 'Checking with Google…' : 'Save key'}
                onPress={() =>
                  void run('key', async () => {
                    const key = keyInput.trim()
                    if (!KEY_PATTERN.test(key)) {
                      throw new Error('That does not look like a Google API key. Copy it again.')
                    }
                    const riko = await checkGeminiKey(key)
                    await saveGeminiKey(key)
                    setKeyInput('')
                    setHasKey(true)
                    if (riko && settings.geminiVoiceId === settings.geminiVoiceName) {
                      await change({ geminiVoiceId: riko.id, geminiVoiceName: riko.name })
                    }
                    setNotice('Google accepted the key.')
                  })
                }
              />
            </>
          )}

          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.switchTitle}>Send chapter text to Google to make the audio</Text>
              <Text style={styles.small}>
                Only the passages you listen to are sent, with the voice and reading style. Use a
                key with billing set up: on Google&apos;s free tier, Google may use what you send to
                improve its products.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Send chapter text to Google to make the audio"
              disabled={Boolean(busy)}
              thumbColor={settings.geminiConsent ? storyboundColors.brass : undefined}
              trackColor={{ true: storyboundColors.brassBright, false: storyboundColors.line }}
              value={settings.geminiConsent}
              onValueChange={(geminiConsent) =>
                void run('consent', async () => {
                  if (!geminiConsent) listeningSession().stop()
                  await change({ geminiConsent })
                })
              }
            />
          </View>
        </View>

        {ready ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Voice · {settings.geminiVoiceName}</Text>
              <Text style={styles.copy}>
                Search Google&apos;s voices by name or by how they sound, and tap Preview to hear
                one.
              </Text>
              <View style={styles.row}>
                <TextInput
                  autoCapitalize="none"
                  placeholder="Riko, storyteller, British, deep…"
                  placeholderTextColor={storyboundColors.muted}
                  returnKeyType="search"
                  style={[styles.input, styles.grow]}
                  value={search}
                  onChangeText={setSearch}
                  onSubmitEditing={() =>
                    void run('search', async () => {
                      setVoices((await searchGeminiVoices(await requireKey(), search)).voices)
                    })
                  }
                />
                <PrimaryButton
                  disabled={Boolean(busy)}
                  label={busy === 'search' ? '…' : 'Search'}
                  variant="secondary"
                  onPress={() =>
                    void run('search', async () => {
                      setVoices((await searchGeminiVoices(await requireKey(), search)).voices)
                    })
                  }
                />
              </View>
              {voices ? (
                voices.length ? (
                  voices.map((voice) => {
                    const chosen = voice.id === settings.geminiVoiceId
                    return (
                      <View key={voice.id} style={[styles.voice, chosen && styles.voiceChosen]}>
                        <View style={styles.grow}>
                          <Text style={styles.voiceName}>{voice.name}</Text>
                          <Text style={styles.small}>
                            {[
                              voice.description,
                              voice.pitch && `${voice.pitch} pitch`,
                              voice.accent
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </View>
                        <View style={styles.voiceActions}>
                          <Pressable
                            accessibilityLabel={`Preview ${voice.name}`}
                            accessibilityRole="button"
                            disabled={Boolean(busy)}
                            hitSlop={8}
                            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                            onPress={() =>
                              void run(`preview-${voice.id}`, async () => {
                                const uri = await speakWithGoogle(await requireKey(), {
                                  text: PREVIEW_TEXT,
                                  style: settings.geminiStyle,
                                  voice: voice.id
                                })
                                previewRef.current?.remove()
                                const player = createAudioPlayer({ uri })
                                previewRef.current = player
                                player.play()
                              })
                            }
                          >
                            <Text style={styles.chipLabel}>
                              {busy === `preview-${voice.id}` ? '…' : 'Preview'}
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityLabel={`Use ${voice.name}`}
                            accessibilityRole="button"
                            disabled={Boolean(busy) || chosen}
                            hitSlop={8}
                            style={({ pressed }) => [
                              styles.chip,
                              styles.chipPrimary,
                              chosen && styles.chipChosen,
                              pressed && styles.pressed
                            ]}
                            onPress={() =>
                              void run('voice', () =>
                                change(
                                  { geminiVoiceId: voice.id, geminiVoiceName: voice.name },
                                  `Books will be read by ${voice.name}.`
                                )
                              )
                            }
                          >
                            <Text style={[styles.chipLabel, styles.chipPrimaryLabel]}>
                              {chosen ? 'Chosen' : 'Use'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )
                  })
                ) : (
                  <Text style={styles.small}>No voices matched. Try a shorter word.</Text>
                )
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Reading style</Text>
              <Text style={styles.copy}>
                How the voice reads, in your own words. A paragraph that starts with a performance
                note, such as [[hushed, urgent]], is read that way instead, and notes like [[sigh]]
                or [[long pause]] inside a line are performed.
              </Text>
              <TextInput
                maxLength={500}
                multiline
                placeholderTextColor={storyboundColors.muted}
                style={[styles.input, styles.multiline]}
                value={style}
                onChangeText={setStyle}
              />
              <View style={styles.row}>
                <PrimaryButton
                  disabled={Boolean(busy) || style === settings.geminiStyle}
                  label="Save style"
                  style={styles.grow}
                  onPress={() =>
                    void run('style', () =>
                      change({ geminiStyle: style.trim() }, 'Reading style saved.')
                    )
                  }
                />
                <PrimaryButton
                  disabled={Boolean(busy) || style === GEMINI_DEFAULT_STYLE}
                  label="Default"
                  variant="quiet"
                  onPress={() => setStyle(GEMINI_DEFAULT_STYLE)}
                />
              </View>
            </View>
          </>
        ) : null}

        <View style={styles.privacy}>
          <Text style={styles.switchTitle}>Kept private</Text>
          <Text style={styles.small}>
            The key stays in this phone&apos;s secure storage. It is never synced, backed up, or
            sent anywhere except to Google with each passage.
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: storyboundColors.paper
  },
  spinner: {
    marginTop: 40
  },
  content: {
    gap: 18,
    padding: 22,
    paddingBottom: 64
  },
  title: {
    ...literaryHeading,
    marginTop: 12,
    fontSize: 28,
    textAlign: 'center'
  },
  intro: {
    color: storyboundColors.muted,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center'
  },
  error: {
    padding: 12,
    borderRadius: storyboundRadii.small,
    backgroundColor: '#f0d7d1',
    color: storyboundColors.danger,
    fontSize: 14,
    lineHeight: 20
  },
  notice: {
    padding: 12,
    borderRadius: storyboundRadii.small,
    backgroundColor: '#dfeae2',
    color: storyboundColors.success,
    fontSize: 14,
    fontWeight: '700'
  },
  card: {
    gap: 12,
    padding: 17,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.medium,
    borderWidth: 1,
    backgroundColor: storyboundColors.paperRaised
  },
  cardTitle: {
    ...literaryHeading,
    fontSize: 20
  },
  copy: {
    color: storyboundColors.muted,
    fontSize: 14,
    lineHeight: 21
  },
  small: {
    color: storyboundColors.muted,
    fontSize: 12,
    lineHeight: 18
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  grow: {
    flex: 1
  },
  saved: {
    flex: 1,
    color: storyboundColors.success,
    fontSize: 14,
    fontWeight: '700'
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.small,
    borderWidth: 1,
    backgroundColor: storyboundColors.paper,
    color: storyboundColors.text,
    fontSize: 15
  },
  multiline: {
    minHeight: 84,
    paddingTop: 12,
    textAlignVertical: 'top'
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    borderTopColor: storyboundColors.line,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  switchCopy: {
    flex: 1,
    gap: 4
  },
  switchTitle: {
    color: storyboundColors.text,
    fontSize: 14,
    fontWeight: '700'
  },
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.small,
    borderWidth: 1
  },
  voiceChosen: {
    borderColor: storyboundColors.brass,
    borderWidth: 2
  },
  voiceName: {
    color: storyboundColors.text,
    fontSize: 15,
    fontWeight: '700'
  },
  voiceActions: {
    gap: 8
  },
  chip: {
    minWidth: 78,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderColor: storyboundColors.brass,
    borderRadius: 18,
    borderWidth: 1
  },
  chipPrimary: {
    backgroundColor: storyboundColors.walnut,
    borderColor: storyboundColors.walnut
  },
  chipChosen: {
    backgroundColor: storyboundColors.success,
    borderColor: storyboundColors.success
  },
  chipLabel: {
    color: storyboundColors.walnut,
    fontSize: 13,
    fontWeight: '700'
  },
  chipPrimaryLabel: {
    color: storyboundColors.nightText
  },
  pressed: {
    opacity: 0.6
  },
  privacy: {
    gap: 6,
    padding: 17,
    borderRadius: storyboundRadii.medium,
    backgroundColor: storyboundColors.parchment
  }
})
