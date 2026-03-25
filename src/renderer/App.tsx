import { useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { useSystemMetrics } from './hooks/useSystemMetrics'
import DashboardPanel from './components/Dashboard/DashboardPanel'
import ChatPanel from './components/Chat/ChatPanel'
import SettingsModal from './components/Settings/SettingsModal'
import SubscriptionBanner from './components/Subscription/SubscriptionBanner'
import PricingModal from './components/Subscription/PricingModal'
import LoginScreen from './components/Auth/LoginScreen'
import RegisterScreen from './components/Auth/RegisterScreen'
import UpdateBanner from './components/Update/UpdateBanner'

export default function App() {
  const {
    showSettings, setShowSettings, setApiKeyStatus,
    authStatus, setAuthStatus, setCurrentUser, setSubscriptionStatus,
    currentUser,
    showPricingModal, setShowPricingModal,
    showRegister, setShowRegister,
    setAppUpdate,
  } = useAppStore()

  // 시스템 메트릭 주기적 업데이트
  useSystemMetrics()

  // 앱 시작 시 저장된 refresh token으로 자동 로그인 시도
  useEffect(() => {
      window.api.auth.refreshToken().then((res) => {
      if (res.success && res.user) {
        setCurrentUser(res.user as { id: string; email: string; plan: 'free' | 'plus' | 'pro' })
        setAuthStatus('authenticated')
      } else {
        setAuthStatus('login')
      }
    })
  }, [setAuthStatus, setCurrentUser])


  // 인증 후 API 키 + 구독 상태 로드
  useEffect(() => {
    if (authStatus !== 'authenticated') return

    window.api.loadApiKey().then((res) => {
      setApiKeyStatus(res.hasKey, res.maskedKey)
    })

    window.api.subscription.getStatus().then((res) => {
      if (res.success && res.data) {
        setSubscriptionStatus(res.data)
        if (currentUser) {
          setCurrentUser({ ...currentUser, plan: res.data.plan })
        }
      }
    })
  }, [authStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.api.updater.getState().then((state) => {
      setAppUpdate(state)
    }).catch(() => {})

    const unsubscribe = window.api.updater.onStateChange((state) => {
      setAppUpdate(state)
    })

    return () => {
      unsubscribe()
    }
  }, [setAppUpdate])

  const handleLogout = async () => {
    await window.api.auth.logout()
    setCurrentUser(null)
    setSubscriptionStatus(null)
    setAuthStatus('login')
    setShowRegister(false)
    setShowSettings(false)
  }

  const handleAuthSuccess = (user: { id: string; email: string; plan: 'free' | 'plus' | 'pro' }) => {
    setCurrentUser(user)
    setAuthStatus('authenticated')
    setShowRegister(false)
  }

  // 로딩 화면
  if (authStatus === 'loading') {
    return (
      <div style={styles.loadingRoot}>
        <div style={styles.loadingSpinner} />
      </div>
    )
  }

  // 메인 UI (login + authenticated 모두 같은 레이아웃)
  return (
    <div style={styles.root}>
      {/* 타이틀바 */}
      {authStatus !== 'authenticated' ? (
        <TitlebarMinimal />
      ) : (
        <div style={styles.titlebar} className="titlebar">
          <div style={styles.titlebarDrag}>
            <div style={styles.appIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
            </div>
            <span style={styles.titlebarText}>PC Management Assistant</span>
            {currentUser?.plan === 'pro' && (
              <span style={styles.proBadge}>PRO</span>
            )}
          </div>
          <div style={styles.titlebarControls} className="titlebar-controls">
            <button
              style={styles.titlebarBtn}
              onClick={() => setShowSettings(true)}
              title="Settings"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
              </svg>
            </button>
            <button style={styles.titlebarBtn} onClick={() => window.api.windowMinimize()} title="Minimize">
              <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor">
                <rect width="10" height="2"/>
              </svg>
            </button>
            <button style={styles.titlebarBtn} onClick={() => window.api.windowMaximize()} title="Maximize">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="0.75" y="0.75" width="8.5" height="8.5"/>
              </svg>
            </button>
            <button
              style={{ ...styles.titlebarBtn, ...styles.closeBtn }}
              onClick={() => window.api.windowClose()}
              title="Close"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 1l8 8M9 1l-8 8"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      <UpdateBanner />

      {/* 구독 배너 (authenticated 전용) */}
      {authStatus === 'authenticated' && <SubscriptionBanner />}

      {/* 메인 레이아웃 */}
      {authStatus === 'authenticated' ? (
        <div style={styles.main}>
          <div style={styles.dashboardPane}>
            <DashboardPanel />
          </div>
          {(currentUser?.plan === 'plus' || currentUser?.plan === 'pro') && (
            <div style={styles.chatPane}>
              <ChatPanel onOpenSettings={() => setShowSettings(true)} />
            </div>
          )}
        </div>
      ) : (
        <div style={styles.authBase} />
      )}

      {/* 로그인 오버레이 */}
      {authStatus !== 'authenticated' && (
        <div style={styles.authOverlay}>
          <div style={styles.authModal} onClick={(e) => e.stopPropagation()}>
            {showRegister ? (
              <RegisterScreen
                onSuccess={handleAuthSuccess}
                onGoLogin={() => setShowRegister(false)}
              />
            ) : (
              <LoginScreen
                onSuccess={handleAuthSuccess}
                onGoRegister={() => setShowRegister(true)}
              />
            )}
          </div>
        </div>
      )}

      {/* 구독 모달 (프라이싱 팝업) */}
      {authStatus === 'authenticated' && showPricingModal && (
        <PricingModal onClose={() => setShowPricingModal(false)} />
      )}

      {/* 설정 모달 (authenticated 전용) */}
      {authStatus === 'authenticated' && showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onLogout={handleLogout}
        />
      )}

      <GlobalStyles />
    </div>
  )
}

// 인증 페이지 전용 타이틀바 (최소화 + 닫기)
function TitlebarMinimal() {
  return (
    <div style={stylesTitlebarMinimal.bar} className="titlebar">
      <div style={{ flex: 1 }} />
      <div className="titlebar-controls" style={stylesTitlebarMinimal.controls}>
        <button style={stylesTitlebarMinimal.btn} onClick={() => window.api.windowMinimize()} title="Minimize">
          <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor"><rect width="10" height="2"/></svg>
        </button>
        <button style={stylesTitlebarMinimal.btn} onClick={() => window.api.windowClose()} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 1l8 8M9 1l-8 8"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

function GlobalStyles() {
  return (
    <style>{`
      @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      @keyframes spin { to { transform: rotate(360deg); } }
      .titlebar { -webkit-app-region: drag; }
      .titlebar-controls { -webkit-app-region: no-drag; }
      textarea:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 2px rgba(59,130,246,0.2); }
      input:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 2px rgba(59,130,246,0.2); }
      button:hover { opacity: 0.85; }
    `}</style>
  )
}

const stylesTitlebarMinimal: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    height: 40,
    background: '#0a1020',
    borderBottom: '1px solid #1e293b',
    flexShrink: 0,
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    height: '100%',
  },
  btn: {
    background: 'none',
    border: 'none',
    color: '#475569',
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}

const styles: Record<string, React.CSSProperties> = {
  loadingRoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#0f172a',
  },
  loadingSpinner: {
    width: 32,
    height: 32,
    border: '3px solid #334155',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0f172a',
    overflow: 'hidden',
    userSelect: 'none',
  },
  titlebar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    background: '#0a1020',
    borderBottom: '1px solid #334155',
    flexShrink: 0,
  },
  titlebarDrag: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    flex: 1,
  },
  appIcon: { display: 'flex', alignItems: 'center' },
  titlebarText: {
    fontSize: 12,
    fontWeight: 600,
    color: '#94a3b8',
    letterSpacing: '0.03em',
  },
  proBadge: {
    fontSize: 9,
    fontWeight: 700,
    color: '#fbbf24',
    background: 'rgba(251,191,36,0.12)',
    border: '1px solid rgba(251,191,36,0.3)',
    borderRadius: 4,
    padding: '2px 6px',
    letterSpacing: '0.08em',
  },
  titlebarControls: {
    display: 'flex',
    alignItems: 'center',
    height: '100%',
  },
  titlebarBtn: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'background 0.1s, color 0.1s',
    fontFamily: 'inherit',
  },
  closeBtn: {},
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    userSelect: 'text',
  },
  authBase: {
    flex: 1,
    background: 'radial-gradient(circle at 50% 15%, rgba(59,130,246,0.16), rgba(15,23,42,0) 42%), #0f172a',
  },
  authOverlay: {
    position: 'fixed',
    top: 40,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(2,6,23,0.5)',
    backdropFilter: 'blur(2px)',
    zIndex: 10,
    padding: 20,
  },
  authModal: {
    width: 'min(460px, 100%)',
  },
  dashboardPane: {
    width: 380,
    flexShrink: 0,
    overflow: 'hidden',
  },
  dashboardPaneFullWidth: {
    width: 380,
    flexShrink: 0,
    overflow: 'hidden',
  },
  chatPane: {
    flex: 1,
    overflow: 'hidden',
  },
}
