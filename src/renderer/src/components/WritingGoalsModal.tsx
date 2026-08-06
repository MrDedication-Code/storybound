import { BarChart3, LoaderCircle, Pause, Play, Plus, Target, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import type {
  BookDetail,
  WritingDayStats,
  WritingGoal,
  WritingGoalMetric,
  WritingGoalPeriod,
  WritingGoalProgress,
  WritingStats
} from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { Button, ConfirmDialog, InlineNotice, LoadingState, Modal } from './ui'

export interface WritingGoalsModalProps {
  book: BookDetail
  onClose: () => void
  notify: (message: string) => void
}

const numberFormatter = new Intl.NumberFormat()
const dayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function lastThirtyDays(): { from: string; to: string } {
  const today = new Date()
  const firstDay = new Date(today)
  firstDay.setDate(today.getDate() - 29)
  return { from: localDateString(firstDay), to: localDateString(today) }
}

function formatDay(date: string): string {
  return dayFormatter.format(new Date(`${date}T00:00:00`))
}

function formatMetric(value: number, metric: WritingGoalMetric): string {
  const unit = value === 1 ? metric.replace(/s$/, '') : metric
  return `${numberFormatter.format(value)} ${unit}`
}

function statDescription(day: WritingDayStats): string {
  if (day.netWords === 0) return `${formatDay(day.date)}: no net word change`
  return `${formatDay(day.date)}: ${numberFormatter.format(Math.abs(day.netWords))} words ${
    day.netWords > 0 ? 'added' : 'removed'
  } net`
}

function DailyWordChart({ days }: { days: WritingDayStats[] }): React.JSX.Element {
  if (days.length === 0) {
    return (
      <div className="writing-chart writing-chart--empty">
        <BarChart3 aria-hidden="true" size={23} />
        <p>No writing changes were recorded in this period.</p>
      </div>
    )
  }

  let maximum = 1
  for (const day of days) maximum = Math.max(maximum, Math.abs(day.netWords))

  return (
    <figure aria-label="Daily net word change for the last 30 days" className="writing-chart">
      <div aria-hidden="true" className="writing-chart__plot">
        {days.map((day) => (
          <div className="writing-chart__day" key={day.date} title={statDescription(day)}>
            <span
              className={`writing-chart__bar writing-chart__bar--${
                day.netWords < 0 ? 'negative' : 'positive'
              }`}
              style={
                {
                  '--writing-bar-size': `${Math.max(2, (Math.abs(day.netWords) / maximum) * 100)}%`
                } as CSSProperties
              }
            />
          </div>
        ))}
      </div>
      <figcaption className="visually-hidden">
        Daily net word changes for the last 30 days.
      </figcaption>
      <ul className="visually-hidden">
        {days.map((day) => (
          <li key={day.date}>{statDescription(day)}</li>
        ))}
      </ul>
    </figure>
  )
}

function GoalProgress({ progress }: { progress: WritingGoalProgress }): React.JSX.Element {
  const percentage = Math.max(0, Math.min(100, progress.progressPercentage))
  return (
    <div className="writing-goal__progress">
      <div
        aria-label={`${progress.goal.bookTitle ?? 'Whole library'} ${progress.goal.period} goal progress`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(percentage)}
        aria-valuetext={`${formatMetric(progress.achievedValue, progress.goal.metric)} of ${formatMetric(
          progress.goal.targetValue,
          progress.goal.metric
        )}`}
        className="writing-goal__progress-track"
        role="progressbar"
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <p>
        <strong>{formatMetric(progress.achievedValue, progress.goal.metric)}</strong> of{' '}
        {formatMetric(progress.goal.targetValue, progress.goal.metric)} ·{' '}
        {Math.round(progress.progressPercentage)}%
      </p>
    </div>
  )
}

export function WritingGoalsModal({
  book,
  onClose,
  notify
}: WritingGoalsModalProps): React.JSX.Element {
  const [goals, setGoals] = useState<WritingGoal[]>([])
  const [stats, setStats] = useState<WritingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scope, setScope] = useState<'book' | 'library'>('book')
  const [metric, setMetric] = useState<WritingGoalMetric>('words')
  const [period, setPeriod] = useState<WritingGoalPeriod>('daily')
  const [targetValue, setTargetValue] = useState('500')
  const [startOn, setStartOn] = useState(() => localDateString(new Date()))
  const [endOn, setEndOn] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyGoalId, setBusyGoalId] = useState<string | null>(null)
  const [deleteGoal, setDeleteGoal] = useState<WritingGoal | null>(null)
  const [range] = useState(lastThirtyDays)

  const loadData = useCallback(async (): Promise<void> => {
    try {
      const [goalResult, statsResult] = await Promise.all([
        storyboundApi().writing.goals.list(),
        storyboundApi().writing.stats(range)
      ])
      setGoals(unwrap(goalResult))
      setStats(unwrap(statsResult))
      setError('')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void Promise.resolve().then(loadData)
  }, [loadData])

  const refreshData = async (): Promise<void> => {
    const [goalResult, statsResult] = await Promise.all([
      storyboundApi().writing.goals.list(),
      storyboundApi().writing.stats(range)
    ])
    setGoals(unwrap(goalResult))
    setStats(unwrap(statsResult))
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const target = Number(targetValue)
    if (!Number.isFinite(target) || target <= 0) {
      setError('Set a target greater than zero.')
      return
    }
    if (!startOn) {
      setError('Choose a start date.')
      return
    }
    if (endOn && endOn < startOn) {
      setError('The end date must be on or after the start date.')
      return
    }

    setCreating(true)
    setError('')
    try {
      unwrap(
        await storyboundApi().writing.goals.create({
          libraryId: book.libraryId,
          bookId: scope === 'book' ? book.id : null,
          metric,
          period,
          targetValue: target,
          startOn,
          endOn: endOn || null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          isActive: true
        })
      )
      await refreshData()
      notify(`${period[0].toUpperCase()}${period.slice(1)} writing goal created.`)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setCreating(false)
    }
  }

  const toggleGoal = async (goal: WritingGoal): Promise<void> => {
    setBusyGoalId(goal.id)
    setError('')
    try {
      unwrap(
        await storyboundApi().writing.goals.update({
          id: goal.id,
          expectedRowVersion: goal.rowVersion,
          isActive: !goal.isActive
        })
      )
      await refreshData()
      notify(`Writing goal ${goal.isActive ? 'paused' : 'resumed'}.`)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusyGoalId(null)
    }
  }

  const removeGoal = async (): Promise<void> => {
    if (!deleteGoal) return
    setBusyGoalId(deleteGoal.id)
    setError('')
    try {
      unwrap(
        await storyboundApi().writing.goals.remove({
          id: deleteGoal.id,
          expectedRowVersion: deleteGoal.rowVersion
        })
      )
      setDeleteGoal(null)
      await refreshData()
      notify('Writing goal deleted.')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusyGoalId(null)
    }
  }

  const progressByGoal = new Map(
    (stats?.activeGoals ?? []).map((progress) => [progress.goal.id, progress])
  )

  return (
    <>
      <Modal
        description="See recent momentum and set flexible targets for this book or your whole library."
        onClose={onClose}
        size="large"
        title="Writing goals"
      >
        {loading ? (
          <LoadingState label="Gathering your writing progress…" />
        ) : (
          <div className="writing-dashboard">
            {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
            {!stats && error ? (
              <div className="writing-dashboard__retry">
                <Button
                  onClick={() => {
                    setLoading(true)
                    void loadData()
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <>
                <section aria-labelledby="writing-summary-title" className="writing-summary">
                  <div className="writing-section-heading">
                    <div>
                      <p className="eyebrow">Across this library</p>
                      <h3 id="writing-summary-title">Last 30 days</h3>
                    </div>
                    <span>
                      {formatDay(stats?.from ?? range.from)}–{formatDay(stats?.to ?? range.to)}
                    </span>
                  </div>
                  <dl className="writing-summary__totals">
                    <div>
                      <dt>Added</dt>
                      <dd>+{numberFormatter.format(stats?.totalWordsAdded ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Removed</dt>
                      <dd>−{numberFormatter.format(stats?.totalWordsRemoved ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Net words</dt>
                      <dd>{numberFormatter.format(stats?.netWords ?? 0)}</dd>
                    </div>
                  </dl>
                  <DailyWordChart days={stats?.days ?? []} />
                </section>

                <section aria-labelledby="writing-active-title" className="writing-goals">
                  <div className="writing-section-heading">
                    <div>
                      <p className="eyebrow">Targets</p>
                      <h3 id="writing-active-title">Your goals</h3>
                    </div>
                    <span>{goals.filter((goal) => goal.isActive).length} active</span>
                  </div>
                  {goals.length === 0 ? (
                    <div className="writing-goals__empty">
                      <Target aria-hidden="true" size={25} />
                      <div>
                        <strong>No goals yet</strong>
                        <p>
                          Create a gentle target below and adjust it whenever your routine changes.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="writing-goals__list">
                      {goals.map((goal) => {
                        const progress = progressByGoal.get(goal.id)
                        return (
                          <article
                            className={`writing-goal${goal.isActive ? '' : ' writing-goal--paused'}`}
                            key={goal.id}
                          >
                            <div className="writing-goal__heading">
                              <div>
                                <strong>
                                  {formatMetric(goal.targetValue, goal.metric)} · {goal.period}
                                </strong>
                                <p>{goal.bookTitle ?? 'Whole library'}</p>
                              </div>
                              <span>{goal.isActive ? 'Active' : 'Paused'}</span>
                            </div>
                            {goal.isActive && progress ? (
                              <GoalProgress progress={progress} />
                            ) : goal.isActive ? (
                              <p className="writing-goal__pending">
                                Progress begins with your next edit.
                              </p>
                            ) : (
                              <p className="writing-goal__pending">
                                This target is not currently counting.
                              </p>
                            )}
                            <div className="writing-goal__footer">
                              <span>
                                {formatDay(goal.startOn)}
                                {goal.endOn ? `–${formatDay(goal.endOn)}` : ' onward'}
                              </span>
                              <div>
                                <Button
                                  disabled={busyGoalId === goal.id}
                                  icon={goal.isActive ? Pause : Play}
                                  variant="quiet"
                                  onClick={() => void toggleGoal(goal)}
                                >
                                  {goal.isActive ? 'Pause' : 'Resume'}
                                </Button>
                                <Button
                                  disabled={busyGoalId === goal.id}
                                  icon={Trash2}
                                  variant="quiet"
                                  onClick={() => setDeleteGoal(goal)}
                                >
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </section>

                <section aria-labelledby="writing-new-title" className="writing-create">
                  <div className="writing-section-heading">
                    <div>
                      <p className="eyebrow">New target</p>
                      <h3 id="writing-new-title">Create a goal</h3>
                    </div>
                  </div>
                  <form
                    className="writing-create__form"
                    onSubmit={(event) => void handleCreate(event)}
                  >
                    <div className="writing-create__scope" role="group" aria-label="Goal scope">
                      <button
                        aria-pressed={scope === 'book'}
                        type="button"
                        onClick={() => setScope('book')}
                      >
                        This book
                        <small>{book.title}</small>
                      </button>
                      <button
                        aria-pressed={scope === 'library'}
                        type="button"
                        onClick={() => setScope('library')}
                      >
                        Whole library
                        <small>All books</small>
                      </button>
                    </div>
                    <div className="form-grid form-grid--two">
                      <label className="field">
                        <span>Measure</span>
                        <select
                          value={metric}
                          onChange={(event) => setMetric(event.target.value as WritingGoalMetric)}
                        >
                          <option value="words">Words</option>
                          <option value="minutes">Minutes</option>
                          <option value="chapters">Chapters</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Cadence</span>
                        <select
                          value={period}
                          onChange={(event) => setPeriod(event.target.value as WritingGoalPeriod)}
                        >
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="project">Project</option>
                        </select>
                      </label>
                    </div>
                    <div className="writing-create__dates">
                      <label className="field">
                        <span>Target</span>
                        <input
                          inputMode="numeric"
                          min="1"
                          required
                          step="1"
                          type="number"
                          value={targetValue}
                          onChange={(event) => setTargetValue(event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Start date</span>
                        <input
                          required
                          type="date"
                          value={startOn}
                          onChange={(event) => setStartOn(event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>End date</span>
                        <input
                          min={startOn}
                          type="date"
                          value={endOn}
                          onChange={(event) => setEndOn(event.target.value)}
                        />
                        <small>Optional</small>
                      </label>
                    </div>
                    <div className="writing-create__actions">
                      <Button
                        disabled={creating}
                        icon={creating ? LoaderCircle : Plus}
                        type="submit"
                        variant="primary"
                      >
                        {creating ? 'Creating…' : 'Create goal'}
                      </Button>
                    </div>
                  </form>
                </section>
              </>
            )}
          </div>
        )}
        <div className="modal__actions">
          <Button onClick={onClose}>Done</Button>
        </div>
      </Modal>
      {deleteGoal ? (
        <ConfirmDialog
          busy={busyGoalId === deleteGoal.id}
          confirmLabel="Delete goal"
          dangerous
          description={`Delete the ${deleteGoal.period} ${deleteGoal.metric} goal for ${
            deleteGoal.bookTitle ?? 'the whole library'
          }? Past writing activity will remain intact.`}
          onClose={() => setDeleteGoal(null)}
          onConfirm={removeGoal}
          title="Delete this writing goal?"
        />
      ) : null}
    </>
  )
}
