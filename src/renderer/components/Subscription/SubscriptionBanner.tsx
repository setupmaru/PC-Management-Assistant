import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'

const HIDE_UNTIL_KEY = 'subscriptionBannerHideUntil'

export default function SubscriptionBanner() {
  const { currentUser, setShowPricingModal } = useAppStore()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (currentUser?.plan !== 'free') {
      setVisible(false)
      return
    }
    const hideUntil = localStorage.getItem(HIDE_UNTIL_KEY)
    if (hideUntil && Date.now() < parseInt(hideUntil, 10)) {
      setVisible(false)
    } else {
      setVisible(true)
    }
  }, [currentUser?.plan])

  if (!visible) return null

  const handleDismiss = () => {
    // 7일 숨김
    const hideUntil = Date.now() + 7 * 24 * 60 * 60 * 1000
    localStorage.setItem(HIDE_UNTIL_KEY, String(hideUntil))
    setVisible(false)
  }

  return (
    <div style={styles.banner}>
      <div style={styles.left}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" style={{ flexShrink: 0 }}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        <span style={styles.text}>
          <strong>Free 플랜</strong> 사용 중 — Pro로 업그레이드하면 무제한 채팅 및 상세 이벤트 분석을 이용할 수 있습니다.
        </span>
      </div>
      <div style={styles.right}>
        <button
          style={styles.upgradeBtn}
          onClick={() => setShowPricingModal(true)}
        >
          Pro 업그레이드
        </button>
        <button style={styles.dismissBtn} onClick={handleDismiss} title="7일 숨김">
          ✕
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '7px 16px',
    background: 'rgba(251,191,36,0.07)',
    borderBottom: '1px solid rgba(251,191,36,0.2)',
    flexShrink: 0,
    gap: 12,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  text: {
    fontSize: 12,
    color: '#94a3b8',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  upgradeBtn: {
    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '0.02em',
    transition: 'opacity 0.15s',
  },
  dismissBtn: {
    background: 'none',
    border: 'none',
    color: '#475569',
    fontSize: 12,
    cursor: 'pointer',
    padding: '3px 4px',
    fontFamily: 'inherit',
    lineHeight: 1,
  },
}
