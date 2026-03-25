import { useState } from 'react'
import { useAppStore } from '../../store/appStore'

interface Props {
  onClose: () => void
}

const FREE_FEATURES = [
  { text: '기본 시스템 모니터링', ok: true },
  { text: '프로세스/이벤트 로그', ok: true },
  { text: '채팅 (AI 어시스턴트)', ok: false },
  { text: '우선 응답', ok: false },
]

const PLUS_FEATURES = [
  { text: '기본 시스템 모니터링', ok: true },
  { text: '프로세스/이벤트 로그', ok: true },
  { text: '채팅 5회/일', ok: true },
  { text: '우선 응답', ok: false },
]

const PRO_FEATURES = [
  { text: '기본 시스템 모니터링', ok: true },
  { text: '프로세스/이벤트 로그', ok: true },
  { text: '무제한 채팅', ok: true },
  { text: '우선 응답', ok: true },
]

export default function PricingModal({ onClose }: Props) {
  const { currentUser, setSubscriptionStatus, setCurrentUser } = useAppStore()
  const [loadingPlan, setLoadingPlan] = useState<'plus' | 'pro' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleUpgrade = async (plan: 'plus' | 'pro') => {
    setLoadingPlan(plan)
    setError(null)
    const res = await window.api.subscription.openCheckout(plan)
    setLoadingPlan(null)

    if (!res.success) {
      setError(res.error ?? '결제를 진행할 수 없습니다.')
      return
    }

    if (res.status) {
      const s = res.status as { plan: 'free' | 'plus' | 'pro'; status: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean }
      setSubscriptionStatus(s)
      if (currentUser) {
        setCurrentUser({ ...currentUser, plan: s.plan })
      }
      if (s.plan === plan) {
        onClose()
        return
      }
    }

    onClose()
  }

  const currentPlan = currentUser?.plan ?? 'free'

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span style={styles.headerTitle}>플랜 업그레이드</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1l8 8M9 1l-8 8"/>
            </svg>
          </button>
        </div>

        {/* 플랜 비교 카드 */}
        <div style={styles.cards}>
          {/* FREE 카드 */}
          <div style={{ ...styles.card, ...(currentPlan === 'free' ? styles.cardActiveFree : {}) }}>
            <div style={styles.cardHeader}>
              <span style={styles.planLabel}>FREE</span>
              <span style={styles.planPrice}>무료</span>
            </div>
            <ul style={styles.featureList}>
              {FREE_FEATURES.map((f) => (
                <li key={f.text} style={styles.featureItem}>
                  <span style={{ color: f.ok ? '#4ade80' : '#475569', flexShrink: 0 }}>
                    {f.ok ? '✓' : '✗'}
                  </span>
                  <span style={{ color: f.ok ? '#94a3b8' : '#475569' }}>{f.text}</span>
                </li>
              ))}
            </ul>
            <div style={styles.cardFooter}>
              <span style={styles.currentPlanTag}>{currentPlan === 'free' ? '현재 플랜' : ''}</span>
            </div>
          </div>

          {/* PLUS 카드 */}
          <div style={{ ...styles.card, ...styles.cardPlus, ...(currentPlan === 'plus' ? styles.cardActivePlus : {}) }}>
            <div style={styles.cardHeader}>
              <span style={{ ...styles.planLabel, color: '#38bdf8' }}>PLUS</span>
              <div style={styles.priceBlock}>
                <span style={styles.planPrice}>₩4,900</span>
                <span style={styles.planPricePer}>/월</span>
              </div>
            </div>
            <ul style={styles.featureList}>
              {PLUS_FEATURES.map((f) => (
                <li key={f.text} style={styles.featureItem}>
                  <span style={{ color: f.ok ? '#38bdf8' : '#475569', flexShrink: 0 }}>
                    {f.ok ? '✓' : '✗'}
                  </span>
                  <span style={{ color: f.ok ? '#cbd5e1' : '#475569' }}>{f.text}</span>
                </li>
              ))}
            </ul>
            <div style={styles.cardFooter}>
              {currentPlan === 'plus' ? (
                <span style={styles.currentPlanTag}>현재 플랜</span>
              ) : currentPlan === 'pro' ? (
                <span style={styles.currentPlanTag}></span>
              ) : (
                <button
                  style={{ ...styles.upgradeBtnPlus, opacity: loadingPlan ? 0.6 : 1 }}
                  onClick={() => handleUpgrade('plus')}
                  disabled={!!loadingPlan}
                >
                  {loadingPlan === 'plus' ? '처리 중...' : 'Plus 시작하기'}
                </button>
              )}
            </div>
          </div>

          {/* PRO 카드 */}
          <div style={{ ...styles.card, ...styles.cardPro, ...(currentPlan === 'pro' ? styles.cardActivePro : {}) }}>
            <div style={styles.cardHeader}>
              <span style={{ ...styles.planLabel, color: '#fbbf24' }}>PRO</span>
              <div style={styles.priceBlock}>
                <span style={styles.planPrice}>₩15,000</span>
                <span style={styles.planPricePer}>/월</span>
              </div>
            </div>
            <ul style={styles.featureList}>
              {PRO_FEATURES.map((f) => (
                <li key={f.text} style={styles.featureItem}>
                  <span style={{ color: '#fbbf24', flexShrink: 0 }}>✓</span>
                  <span style={{ color: '#cbd5e1' }}>{f.text}</span>
                </li>
              ))}
            </ul>
            <div style={styles.cardFooter}>
              {currentPlan === 'pro' ? (
                <span style={styles.currentPlanTag}>현재 플랜</span>
              ) : (
                <button
                  style={{ ...styles.upgradeBtnPro, opacity: loadingPlan ? 0.6 : 1 }}
                  onClick={() => handleUpgrade('pro')}
                  disabled={!!loadingPlan}
                >
                  {loadingPlan === 'pro' ? '처리 중...' : 'Pro 시작하기'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 에러 메시지 */}
        {error && (
          <div style={styles.errorBox}>{error}</div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 14,
    width: 600,
    maxWidth: 'calc(100vw - 40px)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    borderBottom: '1px solid #334155',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#e2e8f0',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#475569',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  },
  cards: {
    display: 'flex',
  },
  card: {
    flex: 1,
    padding: '18px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    borderRight: '1px solid #334155',
  },
  cardActiveFree: {
    background: 'rgba(100,116,139,0.06)',
  },
  cardPlus: {
    borderRight: '1px solid #334155',
  },
  cardActivePlus: {
    background: 'rgba(56,189,248,0.04)',
  },
  cardPro: {
    borderRight: 'none',
  },
  cardActivePro: {
    background: 'rgba(251,191,36,0.04)',
  },
  cardHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  planLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
    letterSpacing: '0.1em',
  },
  planPrice: {
    fontSize: 18,
    fontWeight: 700,
    color: '#e2e8f0',
  },
  priceBlock: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 3,
  },
  planPricePer: {
    fontSize: 11,
    color: '#64748b',
  },
  featureList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: 1,
  },
  featureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
  },
  cardFooter: {
    minHeight: 32,
    display: 'flex',
    alignItems: 'center',
  },
  currentPlanTag: {
    fontSize: 11,
    color: '#475569',
    fontStyle: 'italic',
  },
  upgradeBtnPlus: {
    width: '100%',
    background: 'linear-gradient(135deg, #38bdf8, #0284c7)',
    border: 'none',
    borderRadius: 7,
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    padding: '7px 0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  },
  upgradeBtnPro: {
    width: '100%',
    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
    border: 'none',
    borderRadius: 7,
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    padding: '7px 0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  },
  errorBox: {
    margin: '0 18px 16px',
    padding: '9px 12px',
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: 7,
    color: '#f87171',
    fontSize: 12,
  },
}
