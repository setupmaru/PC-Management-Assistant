import { useAppStore } from '../../store/appStore'

function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${bytesPerSec} B/s`
}

export default function NetworkCard() {
  const metrics = useAppStore((s) => s.metrics)
  const network = metrics?.network ?? []

  const totalRx = network.reduce((s, n) => s + n.rxSec, 0)
  const totalTx = network.reduce((s, n) => s + n.txSec, 0)

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2">
          <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
          <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
          <circle cx="12" cy="20" r="1" fill="#06b6d4"/>
        </svg>
        <span style={styles.label}>네트워크</span>
      </div>

      <div style={styles.speeds}>
        <div style={styles.speedItem}>
          <span style={styles.arrow}>↓</span>
          <span style={{ ...styles.speedValue, color: '#22c55e' }}>{fmtSpeed(totalRx)}</span>
        </div>
        <div style={styles.divider} />
        <div style={styles.speedItem}>
          <span style={styles.arrow}>↑</span>
          <span style={{ ...styles.speedValue, color: '#f97316' }}>{fmtSpeed(totalTx)}</span>
        </div>
      </div>

      {network.length > 0 && (
        <div style={styles.interfaces}>
          {network.slice(0, 2).map(n => (
            <div key={n.iface} style={styles.ifaceRow}>
              <span style={styles.ifaceName} title={n.iface}>
                {n.iface.length > 14 ? n.iface.substring(0, 13) + '…' : n.iface}
              </span>
              <span style={{ ...styles.ifaceSpeed, color: '#22c55e' }}>↓{fmtSpeed(n.rxSec)}</span>
              <span style={{ ...styles.ifaceSpeed, color: '#f97316' }}>↑{fmtSpeed(n.txSec)}</span>
            </div>
          ))}
        </div>
      )}

      {network.length === 0 && (
        <div style={styles.noNet}>활성 네트워크 없음</div>
      )}
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
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: 700,
    color: '#94a3b8',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  speeds: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  speedItem: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
  },
  arrow: {
    fontSize: 16,
    color: '#64748b',
    lineHeight: 1,
  },
  speedValue: {
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1,
  },
  divider: {
    width: 1,
    height: 20,
    background: '#334155',
  },
  interfaces: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    borderTop: '1px solid #334155',
    paddingTop: 8,
  },
  ifaceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  ifaceName: {
    flex: 1,
    fontSize: 10,
    color: '#64748b',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  ifaceSpeed: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  noNet: {
    fontSize: 12,
    color: '#64748b',
  },
}
