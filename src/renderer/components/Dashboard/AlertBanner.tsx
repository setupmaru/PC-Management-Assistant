import { useState } from 'react'
import { useAppStore } from '../../store/appStore'

const LEVEL_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  'Critical': { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.3)' },
  '중요':     { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.3)' },
  'Error':    { bg: 'rgba(239,68,68,0.08)', color: '#f87171', border: 'rgba(239,68,68,0.2)' },
  '오류':     { bg: 'rgba(239,68,68,0.08)', color: '#f87171', border: 'rgba(239,68,68,0.2)' },
  'Warning':  { bg: 'rgba(234,179,8,0.08)', color: '#fbbf24', border: 'rgba(234,179,8,0.25)' },
  '경고':     { bg: 'rgba(234,179,8,0.08)', color: '#fbbf24', border: 'rgba(234,179,8,0.25)' },
}

export default function AlertBanner() {
  const eventLog = useAppStore((s) => s.eventLog)
  const setEventLog = useAppStore((s) => s.setEventLog)
  const [isUpdating, setIsUpdating] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const { events, error } = eventLog
  const autoRepair = eventLog.autoRepair

  const updateAutoRepair = async (enabled: boolean) => {
    setIsUpdating(true)
    setOperationError(null)
    try {
      const result = await window.api.events.setAutoRepairEnabled(enabled)
      if (!result.success || !result.data) {
        throw new Error(result.error ?? '자동 복구 설정을 변경하지 못했습니다.')
      }
      setEventLog({ ...useAppStore.getState().eventLog, autoRepair: result.data })
    } catch (updateError) {
      setOperationError(updateError instanceof Error ? updateError.message : String(updateError))
    } finally {
      setIsUpdating(false)
    }
  }

  const runAutoRepair = async () => {
    setIsUpdating(true)
    setOperationError(null)
    try {
      const result = await window.api.events.runAutoRepair()
      if (!result.success || !result.data) {
        throw new Error(result.error ?? '이벤트 자동 복구를 실행하지 못했습니다.')
      }
      setEventLog({ ...useAppStore.getState().eventLog, autoRepair: result.data })
    } catch (runError) {
      setOperationError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setIsUpdating(false)
    }
  }

  let eventBanner: React.ReactNode
  if (error) {
    eventBanner = (
      <div style={{ ...styles.banner, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)' }}>
        <span style={styles.icon}>⚠</span>
        <span style={{ ...styles.text, color: '#94a3b8' }}>이벤트 로그 수집 실패 (권한 부족 가능)</span>
      </div>
    )
  } else {
    const critical = events.filter(e =>
      e.LevelDisplayName === 'Critical' || e.LevelDisplayName === '중요'
    )
    const errors = events.filter(e =>
      e.LevelDisplayName === 'Error' || e.LevelDisplayName === '오류'
    )
    const warnings = events.filter(e =>
      e.LevelDisplayName === 'Warning' || e.LevelDisplayName === '경고'
    )

    if (critical.length === 0 && errors.length === 0 && warnings.length === 0) {
      eventBanner = (
        <div style={{ ...styles.banner, background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <span style={styles.icon}>✓</span>
          <span style={{ ...styles.text, color: '#4ade80' }}>최근 24시간 내 중요 이벤트 없음</span>
        </div>
      )
    } else {
      const mostSevere = critical[0] ?? errors[0] ?? warnings[0]
      const levelStyle = LEVEL_STYLES[mostSevere.LevelDisplayName] ?? LEVEL_STYLES['Warning']
      const summary = [
        critical.length > 0 && `중요 ${critical.length}건`,
        errors.length > 0 && `오류 ${errors.length}건`,
        warnings.length > 0 && `경고 ${warnings.length}건`,
      ].filter(Boolean).join(' · ')

      eventBanner = (
        <div style={{ ...styles.banner, background: levelStyle.bg, border: `1px solid ${levelStyle.border}` }}>
          <span style={{ ...styles.icon, color: levelStyle.color }}>!</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ ...styles.text, color: levelStyle.color, fontWeight: 600 }}>{summary} </span>
            <span style={{ ...styles.text, color: levelStyle.color, opacity: 0.8 }}>
              최근: {mostSevere.ProviderName} (ID:{mostSevere.Id})
            </span>
          </div>
        </div>
      )
    }
  }

  const lastAction = autoRepair.actions[autoRepair.actions.length - 1]
  const busy = isUpdating || autoRepair.running

  return (
    <div style={styles.container}>
      {eventBanner}
      <div style={styles.repairRow}>
        <span style={{ ...styles.repairDot, background: autoRepair.enabled ? '#22c55e' : '#64748b' }} />
        <div style={styles.repairStatus}>
          <span style={styles.repairTitle}>
            자동 복구 {autoRepair.enabled ? '켜짐' : '꺼짐'}
            {autoRepair.supportedEventCount > 0 && ` · 지원 이벤트 ${autoRepair.supportedEventCount}건`}
          </span>
          <span
            style={{
              ...styles.repairSummary,
              color: operationError || lastAction?.status === 'failed' ? '#f87171' : '#94a3b8',
            }}
            title={operationError ?? lastAction?.detail ?? autoRepair.summary}
          >
            {operationError ?? (lastAction
              ? `${autoRepair.summary} ${lastAction.title}: ${lastAction.detail}`
              : autoRepair.summary)}
          </span>
        </div>
        {autoRepair.enabled && (
          <button
            type="button"
            style={{ ...styles.actionButton, opacity: busy || autoRepair.supportedEventCount === 0 ? 0.5 : 1 }}
            disabled={busy || autoRepair.supportedEventCount === 0}
            onClick={runAutoRepair}
          >
            {busy ? '실행 중' : '지금 실행'}
          </button>
        )}
        <button
          type="button"
          style={{ ...styles.toggleButton, opacity: busy ? 0.5 : 1 }}
          disabled={busy}
          onClick={() => updateAutoRepair(!autoRepair.enabled)}
        >
          {autoRepair.enabled ? '끄기' : '켜기'}
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    lineHeight: 1.4,
  },
  icon: {
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
    width: 16,
    textAlign: 'center' as const,
  },
  text: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  repairRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid rgba(71,85,105,0.45)',
    background: 'rgba(15,23,42,0.55)',
  },
  repairDot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: '50%',
  },
  repairStatus: {
    display: 'flex',
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  repairTitle: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: 600,
  },
  repairSummary: {
    overflow: 'hidden',
    fontSize: 10,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  actionButton: {
    padding: '5px 8px',
    border: '1px solid rgba(59,130,246,0.4)',
    borderRadius: 6,
    background: 'rgba(59,130,246,0.12)',
    color: '#93c5fd',
    cursor: 'pointer',
    fontSize: 10,
    whiteSpace: 'nowrap',
  },
  toggleButton: {
    padding: '5px 8px',
    border: '1px solid rgba(100,116,139,0.4)',
    borderRadius: 6,
    background: 'rgba(100,116,139,0.1)',
    color: '#cbd5e1',
    cursor: 'pointer',
    fontSize: 10,
  },
}
