import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  X,
  type LucideIcon
} from 'lucide-react'
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode
} from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  icon?: LucideIcon
}

export function Button({
  variant = 'secondary',
  icon: Icon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button className={`button button--${variant} ${className}`} type={type} {...props}>
      {Icon ? <Icon aria-hidden="true" size={17} strokeWidth={1.8} /> : null}
      {children}
    </button>
  )
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  icon: LucideIcon
}

export function IconButton({
  label,
  icon: Icon,
  className = '',
  type = 'button',
  ...props
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className={`icon-button ${className}`}
      title={label}
      type={type}
      {...props}
    >
      <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
    </button>
  )
}

export type ModalCloseReason = 'backdrop' | 'close-button' | 'escape'

interface ModalProps {
  title: string
  description?: string
  onClose: () => void
  onRequestClose?: (reason: ModalCloseReason) => void
  children: ReactNode
  size?: 'small' | 'medium' | 'large'
}

export function Modal({
  title,
  description,
  onClose,
  onRequestClose,
  children,
  size = 'medium'
}: ModalProps): React.JSX.Element {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const requestClose = (reason: ModalCloseReason): void => {
    if (onRequestClose) onRequestClose(reason)
    else onClose()
  }
  const requestCloseFromEffect = useEffectEvent(requestClose)

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const focusable = panel?.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
    const preferredFocus = panel?.querySelector<HTMLElement>(
      '[autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
    )
    ;(preferredFocus ?? focusable)?.focus()

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestCloseFromEffect('escape')
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [])

  return (
    <div
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      className="modal-backdrop"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) requestClose('backdrop')
      }}
    >
      <div className={`modal modal--${size}`} ref={panelRef}>
        <div className="modal__header">
          <div>
            <p className="eyebrow">Storybound</p>
            <h2 id={titleId}>{title}</h2>
            {description ? (
              <p className="modal__description" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <IconButton icon={X} label="Close dialog" onClick={() => requestClose('close-button')} />
        </div>
        {children}
      </div>
    </div>
  )
}

interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  onClose: () => void
  dangerous?: boolean
  busy?: boolean
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  dangerous = false,
  busy = false
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <Modal description={description} onClose={onClose} size="small" title={title}>
      <div className="confirm-illustration" aria-hidden="true">
        <AlertTriangle size={28} />
      </div>
      <div className="modal__actions">
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          variant={dangerous ? 'danger' : 'primary'}
          onClick={() => void onConfirm()}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

export function LoadingState({
  label = 'Opening your library…'
}: {
  label?: string
}): React.JSX.Element {
  return (
    <div aria-live="polite" className="state-card state-card--loading" role="status">
      <LoaderCircle aria-hidden="true" className="spin" size={26} />
      <p>{label}</p>
    </div>
  )
}

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'This page could not be opened',
  message,
  onRetry
}: ErrorStateProps): React.JSX.Element {
  return (
    <div className="state-card state-card--error" role="alert">
      <CircleAlert aria-hidden="true" size={28} />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
      {onRetry ? (
        <Button onClick={onRetry} variant="primary">
          Try again
        </Button>
      ) : null}
    </div>
  )
}

export function InlineNotice({
  children,
  tone = 'info'
}: {
  children: ReactNode
  tone?: 'info' | 'success' | 'error'
}): React.JSX.Element {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? CircleAlert : CircleAlert
  return (
    <div
      className={`inline-notice inline-notice--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" size={17} />
      <span>{children}</span>
    </div>
  )
}

export function VisuallyHidden({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="visually-hidden">{children}</span>
}
