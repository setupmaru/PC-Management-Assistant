import { useAppStore } from '../../store/appStore'

function getColor(usage: number | null) {
  if (usage === null) return '#64748b'
  if (usage >= 90) return '#ef4444'
  if (usage >= 70) return '#f97316'
  if (usage >= 50) return '#eab308'
  return '#22c55e'
}

function fmtMemory(megabytes: number): string {
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)}GB`
  return `${megabytes}MB`
}

function fmtMemoryUsage(usedMb: number, totalMb: number): string {
  if (totalMb >= 1024) return `${(usedMb / 1024).toFixed(1)} / ${(totalMb / 1024).toFixed(1)}GB`
  return `${usedMb} / ${totalMb}MB`
}

export default function GpuCard() {
  const gpu = useAppStore((s) => s.metrics?.gpu)
  const usage = gpu?.usage ?? null
  const color = getColor(usage)
  const memory = gpu?.memoryTotalMb
    ? gpu.memoryUsedMb !== undefined
      ? `VRAM ${fmtMemoryUsage(gpu.memoryUsedMb, gpu.memoryTotalMb)}`
      : `VRAM ${fmtMemory(gpu.memoryTotalMb)}`
    : gpu?.vendor ?? ''

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" style={styles.icon}>
          <rect x="3" y="5" width="18" height="12" rx="2" />
          <path d="M8 21h8M12 17v4M7 9h4v4H7zM15 9h2M15 13h2" />
        </svg>
        <div style={styles.titleWrap}>
          <span style={styles.label}>GPU</span>
          <span style={styles.model}>{gpu?.model || '감지되지 않음'}</span>
        </div>
      </div>

      <div style={styles.value} title={usage === null ? '사용률 측정값 없음' : `${usage}%`}>
        <span style={{ color }}>{usage === null ? '--' : usage}</span>
        <span style={styles.unit}>%</span>
      </div>

      <div style={styles.barBg}>
        <div style={{ ...styles.barFill, width: `${usage ?? 0}%`, background: color }} />
      </div>

      <div style={styles.footer}>
        <span style={styles.meta}>{memory}</span>
        {gpu?.temperature && (
          <span style={{ ...styles.meta, color: gpu.temperature > 85 ? '#ef4444' : '#94a3b8' }}>
            {gpu.temperature}°C
          </span>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 10,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
  },
  icon: {
    marginTop: 2,
    flexShrink: 0,
  },
  titleWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  label: {
    fontSize: 11,
    fontWeight: 700,
    color: '#94a3b8',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  model: {
    fontSize: 10,
    color: '#64748b',
    lineHeight: 1.3,
    wordBreak: 'break-word' as const,
  },
  value: {
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1,
  },
  unit: {
    fontSize: 14,
    color: '#64748b',
    marginLeft: 2,
  },
  barBg: {
    height: 4,
    background: '#0f172a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.5s ease',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 15,
  },
  meta: {
    fontSize: 11,
    color: '#94a3b8',
  },
}
