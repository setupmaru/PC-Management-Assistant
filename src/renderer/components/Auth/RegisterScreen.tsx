import { useState, useRef, useEffect, KeyboardEvent } from 'react'

interface Props {
  onSuccess: (user: { id: string; email: string; plan: 'free' | 'plus' | 'pro' }) => void
  onGoLogin: () => void
}

export default function RegisterScreen({ onSuccess, onGoLogin }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  const handleRegister = async () => {
    if (!email.trim()) { setError('이메일을 입력해주세요.'); return }
    if (password.length < 8) { setError('비밀번호는 8자 이상이어야 합니다.'); return }
    if (password !== confirmPassword) { setError('비밀번호가 일치하지 않습니다.'); return }

    setLoading(true)
    setError('')

    const res = await window.api.auth.register(email.trim(), password)
    setLoading(false)

    if (res.success && res.user) {
      onSuccess(res.user as { id: string; email: string; plan: 'free' | 'plus' | 'pro' })
    } else {
      setError(res.error ?? '회원가입에 실패했습니다.')
    }
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleRegister()
  }

  const canSubmit = !!email && !!password && !!confirmPassword && !loading

  return (
    <div style={styles.card}>
        {/* 로고 */}
        <div style={styles.logoArea}>
          <div style={styles.logoCircle}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <path d="M8 21h8M12 17v4"/>
            </svg>
          </div>
          <h1 style={styles.appName}>PC Management Assistant</h1>
          <p style={styles.subtitle}>새 계정 만들기</p>
        </div>

        {/* 폼 */}
        <div style={styles.form}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>이메일</label>
            <input
              ref={emailRef}
              type="email"
              style={{ ...styles.input, borderColor: error ? '#ef4444' : '#334155' }}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError('') }}
              onKeyDown={handleKey}
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>비밀번호 (8자 이상)</label>
            <input
              type="password"
              style={{ ...styles.input, borderColor: error ? '#ef4444' : '#334155' }}
              placeholder="비밀번호"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              onKeyDown={handleKey}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>비밀번호 확인</label>
            <input
              type="password"
              style={{ ...styles.input, borderColor: error ? '#ef4444' : '#334155' }}
              placeholder="비밀번호 재입력"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError('') }}
              onKeyDown={handleKey}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div style={styles.errorMsg}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <button
            style={{ ...styles.registerBtn, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
            onClick={handleRegister}
            disabled={!canSubmit}
          >
            {loading ? (
              <span style={styles.spinnerWrapper}>
                <span style={styles.spinner} />
                가입 중...
              </span>
            ) : '회원가입'}
          </button>
        </div>

        <p style={styles.loginLink}>
          이미 계정이 있으신가요?{' '}
          <button style={styles.linkBtn} onClick={onGoLogin}>
            로그인
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
  registerBtn: {
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
  loginLink: {
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
