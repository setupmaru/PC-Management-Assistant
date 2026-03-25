import { KeyboardEvent, useEffect, useRef, useState } from 'react'

interface Props {
  onSuccess: (user: { id: string; email: string; plan: 'free' | 'plus' | 'pro' }) => void
  onGoRegister: () => void
}

interface ConnectionInfo {
  reachable: boolean
  activeBase: string
  triedBases: string[]
  error?: string
}

export default function LoginScreen({ onSuccess, onGoRegister }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  useEffect(() => {
    let mounted = true

    window.api.auth.getConnectionInfo()
      .then((info) => {
        if (mounted) setConnectionInfo(info)
      })
      .catch(() => {
        if (!mounted) return
        setConnectionInfo({
          reachable: false,
          activeBase: '',
          triedBases: [],
          error: 'Failed to read API connection status.',
        })
      })

    return () => {
      mounted = false
    }
  }, [])

  const handleLogin = async () => {
    if (!email.trim()) {
      setError('Please enter your email.')
      return
    }
    if (!password) {
      setError('Please enter your password.')
      return
    }

    setLoading(true)
    setError('')

    const res = await window.api.auth.login(email.trim(), password)
    setLoading(false)

    if (res.success && res.user) {
      onSuccess(res.user)
      return
    }

    setError(res.error ?? 'Login failed.')
    setPassword('')

    window.api.auth.getConnectionInfo()
      .then((info) => setConnectionInfo(info))
      .catch(() => {})
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleLogin()
  }

  const canSubmit = !!email && !!password && !loading

  return (
    <div style={styles.card}>
      <div style={styles.logoArea}>
        <div style={styles.logoCircle}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        </div>
        <h1 style={styles.appName}>PC Management Assistant</h1>
        <p style={styles.subtitle}>Sign in to continue</p>
      </div>

      {connectionInfo && (
        <div
          style={{
            ...styles.connectionCard,
            borderColor: connectionInfo.reachable ? 'rgba(74, 222, 128, 0.28)' : 'rgba(248, 113, 113, 0.28)',
            background: connectionInfo.reachable ? 'rgba(22, 101, 52, 0.14)' : 'rgba(127, 29, 29, 0.14)',
          }}
        >
          <div
            style={{
              ...styles.connectionBadge,
              color: connectionInfo.reachable ? '#86efac' : '#fca5a5',
            }}
          >
            {connectionInfo.reachable ? 'API connected' : 'API unreachable'}
          </div>
          <div style={styles.connectionText}>
            <strong>Active base:</strong> {connectionInfo.activeBase || 'not configured'}
          </div>
          {connectionInfo.triedBases.length > 1 && (
            <div style={styles.connectionText}>
              <strong>Tried:</strong> {connectionInfo.triedBases.join(', ')}
            </div>
          )}
          {!connectionInfo.reachable && connectionInfo.error && (
            <div style={{ ...styles.connectionText, color: '#fecaca' }}>{connectionInfo.error}</div>
          )}
        </div>
      )}

      <div style={styles.form}>
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Email</label>
          <input
            ref={emailRef}
            type="email"
            style={{ ...styles.input, borderColor: error ? '#ef4444' : '#334155' }}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError('')
            }}
            onKeyDown={handleKey}
            disabled={loading}
            autoComplete="email"
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Password</label>
          <input
            type="password"
            style={{ ...styles.input, borderColor: error ? '#ef4444' : '#334155' }}
            placeholder="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError('')
            }}
            onKeyDown={handleKey}
            disabled={loading}
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div style={styles.errorMsg}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ flexShrink: 0 }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        <button
          style={{
            ...styles.loginBtn,
            opacity: canSubmit ? 1 : 0.5,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
          onClick={handleLogin}
          disabled={!canSubmit}
        >
          {loading ? (
            <span style={styles.spinnerWrapper}>
              <span style={styles.spinner} />
              Signing in...
            </span>
          ) : 'Sign in'}
        </button>
      </div>

      <p style={styles.registerLink}>
        Need an account?{' '}
        <button style={styles.linkBtn} onClick={onGoRegister}>
          Create one
        </button>
      </p>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderTop: '2px solid #334155',
    borderRadius: 12,
    padding: '24px 16px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 24,
    boxSizing: 'border-box',
  },
  logoArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    textAlign: 'center' as const,
  },
  logoCircle: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'rgba(59,130,246,0.1)',
    border: '1px solid rgba(59,130,246,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    fontSize: 16,
    fontWeight: 700,
    color: '#f1f5f9',
    margin: 0,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    margin: 0,
  },
  connectionCard: {
    width: '100%',
    border: '1px solid',
    borderRadius: 10,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    boxSizing: 'border-box' as const,
  },
  connectionBadge: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  },
  connectionText: {
    fontSize: 12,
    color: '#cbd5e1',
    lineHeight: 1.45,
    wordBreak: 'break-word' as const,
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: '#94a3b8',
  },
  input: {
    width: '100%',
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 10,
    color: '#f1f5f9',
    fontSize: 14,
    padding: '11px 14px',
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box' as const,
  },
  errorMsg: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#f87171',
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 7,
    padding: '7px 10px',
  },
  loginBtn: {
    width: '100%',
    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
    border: 'none',
    borderRadius: 10,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    padding: '12px',
    transition: 'opacity 0.15s',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  spinnerWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin 0.7s linear infinite',
  },
  registerLink: {
    fontSize: 13,
    color: '#64748b',
    margin: 0,
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#3b82f6',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
    textDecoration: 'underline',
  },
}
