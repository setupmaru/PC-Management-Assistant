import { useEffect, useState } from 'react'

interface Report {
  startedAt: number
  finishedAt: number
  summary: string
  steps: Array<{
    key: 'memory' | 'startup' | 'disk' | 'network' | 'dcom' | 'windowsUpdate'
    title: string
    status: 'success' | 'warning' | 'error'
    detail: string
  }>
}

const STATUS_COLOR: Record<'success' | 'warning' | 'error', string> = {
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
}

const STATUS_LABEL: Record<'success' | 'warning' | 'error', string> = {
  success: '정상',
  warning: '주의',
  error: '오류',
}

export default function SystemMaintenanceCard() {
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getLastMaintenanceReport().then((res) => {
      if (res.success && res.data) {
        setReport(res.data)
      }
    }).catch(() => {})
  }, [])

  const handleRun = async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      const res = await window.api.runMaintenance()
      if (res.success && res.data) {
        setReport(res.data)
      } else {
        setError(res.error ?? '유지보수 실행 실패')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const finishedAt = report?.finishedAt
    ? new Date(report.finishedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <div style={styles.titleGroup}>
          <span style={styles.title}>SYSTEM MAINTENANCE</span>
          <span style={styles.subTitle}>
            {running ? '점검/정리 실행 중...' : (report?.summary ?? '미실행')}
          </span>
        </div>
        <button
          style={{ ...styles.runBtn, opacity: running ? 0.55 : 1 }}
          onClick={handleRun}
          disabled={running}
          title="유지보수 실행"
        >
          {running ? '실행중' : '실행'}
        </button>
      </div>

      {report && (
        <div style={styles.stepList}>
          {report.steps.map((step) => (
            <div key={step.key} style={styles.stepRow}>
              <span style={{ ...styles.statusDot, background: STATUS_COLOR[step.status] }} />
              <span style={styles.stepTitle}>{step.title}</span>
              <span style={{ ...styles.statusLabel, color: STATUS_COLOR[step.status] }}>
                {STATUS_LABEL[step.status]}
              </span>
              <span style={styles.stepDetail}>{step.detail}</span>
            </div>
          ))}
        </div>
      )}

      {finishedAt && <div style={styles.footer}>마지막 실행 {finishedAt}</div>}
      {error && <div style={styles.error}>{error}</div>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  title: {
    fontSize: 10,
    fontWeight: 700,
    color: '#94a3b8',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
  },
  subTitle: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: 600,
  },
  runBtn: {
    background: 'rgba(34,197,94,0.15)',
    border: '1px solid rgba(34,197,94,0.35)',
    color: '#4ade80',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  stepList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  stepRow: {
    display: 'grid',
    gridTemplateColumns: '8px auto auto',
    columnGap: 6,
    rowGap: 2,
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    marginTop: 2,
  },
  stepTitle: {
    fontSize: 11,
    color: '#e2e8f0',
    fontWeight: 600,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: 700,
    justifySelf: 'end' as const,
  },
  stepDetail: {
    gridColumn: '2 / 4',
    fontSize: 10,
    color: '#94a3b8',
    lineHeight: 1.4,
    wordBreak: 'break-word' as const,
  },
  footer: {
    fontSize: 9,
    color: '#64748b',
    textAlign: 'right' as const,
  },
  error: {
    fontSize: 10,
    color: '#f87171',
  },
}
