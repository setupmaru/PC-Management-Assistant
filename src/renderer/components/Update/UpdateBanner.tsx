import { useState } from 'react'
import { useAppStore } from '../../store/appStore'

function formatProgress(progressPercent: number | null): string {
  if (progressPercent === null || Number.isNaN(progressPercent)) return ''
  return `${Math.max(0, Math.min(100, Math.round(progressPercent)))}%`
}

export default function UpdateBanner() {
  const updateState = useAppStore((state) => state.appUpdate)
  const [isApplying, setIsApplying] = useState(false)

  if (!updateState.enabled) return null
  if (updateState.status === 'idle' || updateState.status === 'checking') return null

  let message = ''
  let actionLabel = ''
  let accent = '#3b82f6'
  let background = 'rgba(59,130,246,0.08)'
  let border = 'rgba(59,130,246,0.25)'
  let disabled = false

  switch (updateState.status) {
    case 'available':
      message = `Version ${updateState.availableVersion ?? ''} is available. Click once to download and install.`
      actionLabel = 'Update now'
      break
    case 'downloading':
      message = `Downloading update ${formatProgress(updateState.progressPercent)}`
      actionLabel = 'Downloading'
      disabled = true
      break
    case 'downloaded':
      message = `Installing version ${updateState.availableVersion ?? ''}. The app will restart soon.`
      actionLabel = 'Installing'
      disabled = true
      break
    case 'error':
      message = updateState.error
        ? `Update failed: ${updateState.error}`
        : 'The update process failed.'
      actionLabel = updateState.availableVersion ? 'Retry' : ''
      accent = '#f59e0b'
      background = 'rgba(245,158,11,0.08)'
      border = 'rgba(245,158,11,0.25)'
      disabled = !updateState.availableVersion
      break
    default:
      return null
  }

  const handleApply = async () => {
    if (disabled || isApplying || !actionLabel) return
    setIsApplying(true)
    try {
      const result = await window.api.updater.apply()
      if (!result.success && result.error) {
        alert(result.error)
      }
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div
      style={{
        ...styles.banner,
        background,
        borderBottom: `1px solid ${border}`,
      }}
    >
      <div style={styles.left}>
        <div style={{ ...styles.dot, background: accent }} />
        <span style={styles.text}>{message}</span>
      </div>
      {actionLabel && (
        <button
          type="button"
          onClick={handleApply}
          disabled={disabled || isApplying}
          style={{
            ...styles.button,
            background: accent,
            opacity: disabled || isApplying ? 0.6 : 1,
            cursor: disabled || isApplying ? 'default' : 'pointer',
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 16px',
    flexShrink: 0,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  text: {
    color: '#cbd5e1',
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  button: {
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    padding: '6px 12px',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
    flexShrink: 0,
  },
}
