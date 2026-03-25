import CpuCard from './CpuCard'
import MemoryCard from './MemoryCard'
import DiskCard from './DiskCard'
import NetworkCard from './NetworkCard'
import ProcessTable from './ProcessTable'
import AlertBanner from './AlertBanner'
import WindowsUpdateCard from './WindowsUpdateCard'
import SystemMaintenanceCard from './SystemMaintenanceCard'
import { useAppStore } from '../../store/appStore'

export default function DashboardPanel() {
  const metrics = useAppStore((s) => s.metrics)
  const authStatus = useAppStore((s) => s.authStatus)
  const currentUser = useAppStore((s) => s.currentUser)
  const setCurrentUser = useAppStore((s) => s.setCurrentUser)
  const setSubscriptionStatus = useAppStore((s) => s.setSubscriptionStatus)
  const setAuthStatus = useAppStore((s) => s.setAuthStatus)
  const setShowSettings = useAppStore((s) => s.setShowSettings)
  const setShowPricingModal = useAppStore((s) => s.setShowPricingModal)

  const handleLogout = async () => {
    await window.api.auth.logout()
    setCurrentUser(null)
    setSubscriptionStatus(null)
    setAuthStatus('login')
    setShowSettings(false)
  }

  const lastUpdate = metrics?.timestamp
    ? new Date(metrics.timestamp).toLocaleTimeString('ko-KR')
    : '로딩 중..'

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.dot} />
          <span style={styles.headerTitle}>DASHBOARD</span>
        </div>
        <span style={styles.updateTime}>업데이트: {lastUpdate}</span>
      </div>

      <div style={styles.content}>
        <div style={styles.cardGrid}>
          <CpuCard />
          <MemoryCard />
          <DiskCard />
          <NetworkCard />
        </div>

        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionTitle}>TOP PROCESSES</span>
          </div>
          <ProcessTable />
        </div>

        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionTitle}>EVENTS (24H)</span>
          </div>
          <AlertBanner />
        </div>

        <WindowsUpdateCard />
        <SystemMaintenanceCard />

        {authStatus === 'authenticated' && (
          <div style={styles.userBar}>
            {(currentUser?.plan === 'free' || currentUser?.plan === 'plus') && (
              <button style={styles.upgradeBtn} onClick={() => setShowPricingModal(true)} title="Upgrade plan">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
                {currentUser?.plan === 'plus' ? 'Upgrade to Pro' : 'Upgrade plan'}
              </button>
            )}
            <button style={styles.logoutBtn} onClick={handleLogout} title="Logout">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Logout
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0f172a',
    borderRight: '1px solid #334155',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    height: 44,
    borderBottom: '1px solid #334155',
    background: '#0f172a',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#22c55e',
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: '#94a3b8',
    textTransform: 'uppercase' as const,
  },
  userBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  upgradeBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(251,191,36,0.1)',
    border: '1px solid rgba(251,191,36,0.3)',
    borderRadius: 5,
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: 700,
    padding: '3px 7px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '0.05em',
  },
  logoutBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(239,68,68,0.15)',
    border: '1px solid rgba(239,68,68,0.4)',
    borderRadius: 5,
    color: '#f87171',
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 7px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '0.03em',
  },
  updateTime: {
    fontSize: 10,
    color: '#475569',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: '#64748b',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
  },
}
