import { useState } from 'react'
import { useAppStore } from '../../store/appStore'

interface Props {
  onLogout: () => void
}

export default function SubscriptionSection({ onLogout }: Props) {
  const { currentUser, subscriptionStatus, setSubscriptionStatus, setCurrentUser, setShowPricingModal } = useAppStore()
  const [loading, setLoading] = useState<'cancel' | 'logout' | null>(null)
  const [notice, setNotice] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null)

  const plan = currentUser?.plan ?? 'free'
  const isPro = plan === 'pro'

  const refreshStatus = async () => {
    const res = await window.api.subscription.getStatus()
    if (res.success && res.data) {
      setSubscriptionStatus(res.data)
      if (currentUser) {
        setCurrentUser({ ...currentUser, plan: res.data.plan })
      }
    }
  }

  const handleCancel = async () => {
    if (!confirm('구독을 취소하시겠습니까?\n현재 기간 만료 후 Free 플랜으로 전환됩니다.')) return
    setLoading('cancel')
    const res = await window.api.subscription.cancel()
    setLoading(null)
    if (res.success) {
      await refreshStatus()
      setNotice({ type: 'info', text: '구독 취소가 예약되었습니다. 기간 만료 후 Free로 전환됩니다.' })
    } else {
      setNotice({ type: 'error', text: res.error ?? '취소에 실패했습니다.' })
    }
  }

  const handleLogout = async () => {
    setLoading('logout')
    await onLogout()
    setLoading(null)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  }

  const noticeColors = {
    info:    { color: '#93c5fd', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.25)' },
    success: { color: '#4ade80', bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)' },
    error:   { color: '#f87171', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)' },
  }

  return (
    <div style={styles.section}>
      <label style={styles.label}>계정 & 구독</label>

      {/* 계정 정보 */}
      <div style={styles.accountRow}>
        <div style={styles.emailBadge}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <span style={styles.email}>{currentUser?.email ?? '-'}</span>
        </div>
        <div style={{ ...styles.planBadge, ...(isPro ? styles.planBadgePro : styles.planBadgeFree) }}>
          {isPro ? 'PRO' : 'FREE'}
        </div>
      </div>

      {/* Pro 구독 상세 */}
      {isPro && subscriptionStatus && (
        <div style={styles.subDetails}>
          {subscriptionStatus.periodEnd && (
            <div style={styles.subRow}>
              <span style={styles.subKey}>
                {subscriptionStatus.cancelAtPeriodEnd ? '만료 예정일' : '다음 결제일'}
              </span>
              <span style={styles.subVal}>{formatDate(subscriptionStatus.periodEnd)}</span>
            </div>
          )}
          {subscriptionStatus.cancelAtPeriodEnd && (
            <p style={styles.cancelNote}>취소 예약됨 — 기간 만료 후 Free로 전환됩니다.</p>
          )}
        </div>
      )}

      {/* 알림 메시지 */}
      {notice && (
        <div style={{
          ...styles.notice,
          color: noticeColors[notice.type].color,
          background: noticeColors[notice.type].bg,
          border: `1px solid ${noticeColors[notice.type].border}`,
        }}>
          {notice.text}
        </div>
      )}

      {/* 액션 버튼 */}
      <div style={styles.btnRow}>
        {!isPro ? (
          <button
            style={styles.upgradeBtn}
            onClick={() => setShowPricingModal(true)}
          >
            토스페이먼츠로 Pro 업그레이드
          </button>
        ) : (
          !subscriptionStatus?.cancelAtPeriodEnd && (
            <button
              style={{ ...styles.cancelBtn, opacity: loading === 'cancel' ? 0.6 : 1 }}
              onClick={handleCancel}
              disabled={loading === 'cancel'}
            >
              {loading === 'cancel' ? '처리 중...' : '구독 취소'}
            </button>
          )
        )}
        <button
          style={{ ...styles.logoutBtn, opacity: loading === 'logout' ? 0.6 : 1 }}
          onClick={handleLogout}
          disabled={loading === 'logout'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          {loading === 'logout' ? '로그아웃 중...' : '로그아웃'}
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 10 },
  label: { fontSize: 13, fontWeight: 600, color: '#cbd5e1' },
  accountRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '9px 12px',
  },
  emailBadge: { display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 },
  email: {
    fontSize: 13, color: '#94a3b8',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  planBadge: {
    fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 7px',
    letterSpacing: '0.06em', flexShrink: 0,
  },
  planBadgeFree: {
    color: '#64748b', background: 'rgba(100,116,139,0.12)', border: '1px solid rgba(100,116,139,0.3)',
  },
  planBadgePro: {
    color: '#fbbf24', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)',
  },
  subDetails: {
    background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.15)',
    borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
  },
  subRow: { display: 'flex', justifyContent: 'space-between', fontSize: 12 },
  subKey: { color: '#64748b' },
  subVal: { color: '#94a3b8', fontWeight: 500 },
  cancelNote: { fontSize: 11, color: '#f87171', marginTop: 2 },
  notice: {
    fontSize: 12, padding: '9px 12px', borderRadius: 7, lineHeight: 1.5,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  btnRow: { display: 'flex', gap: 8 },
  upgradeBtn: {
    flex: 1,
    background: 'linear-gradient(135deg, #3cb6d3, #1a83ff)',
    border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, fontWeight: 700,
    padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.15s',
  },
  cancelBtn: {
    flex: 1, background: '#1e293b', border: '1px solid #334155',
    borderRadius: 7, color: '#94a3b8', fontSize: 12, padding: '8px 14px',
    cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.15s',
  },
  logoutBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: 7, color: '#f87171', fontSize: 12, padding: '8px 14px',
    cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.15s',
  },
}
