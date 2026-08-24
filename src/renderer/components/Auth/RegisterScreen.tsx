import { KeyboardEvent, useEffect, useRef, useState } from 'react'

interface Props {
  onSuccess: (user: { id: string; email: string; plan: 'free' | 'plus' | 'pro' }) => void
  onGoLogin: () => void
  initialVerificationEmail?: string
}

type Phase = 'register' | 'verify'

export default function RegisterScreen({ onSuccess, onGoLogin, initialVerificationEmail }: Props) {
  const [phase, setPhase] = useState<Phase>(initialVerificationEmail ? 'verify' : 'register')
  const [email, setEmail] = useState(initialVerificationEmail ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const emailRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (phase === 'register') emailRef.current?.focus()
    else codeRef.current?.focus()
  }, [phase])

  useEffect(() => {
    if (!initialVerificationEmail) return
    setEmail(initialVerificationEmail)
    setPhase('verify')
    setError('')
    setInfo('이메일로 받은 6자리 인증번호를 입력해주세요.')
  }, [initialVerificationEmail])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  const handleRegister = async () => {
    if (!email.trim()) { setError('이메일을 입력해주세요.'); return }
    if (password.length < 8) { setError('비밀번호는 8자 이상이어야 합니다.'); return }
    if (password !== confirmPassword) { setError('비밀번호가 일치하지 않습니다.'); return }

    setLoading(true)
    setError('')
    setInfo('')

    const res = await window.api.auth.register(email.trim(), password)
    setLoading(false)

    if (res.success && res.verificationRequired) {
      setEmail(res.email ?? email.trim())
      setPassword('')
      setConfirmPassword('')
      setCode('')
      setPhase('verify')
      setResendCooldown(60)
      setInfo(res.message ?? '입력한 이메일로 인증번호를 보냈습니다.')
      return
    }

    if (res.success && res.user) {
      onSuccess(res.user as { id: string; email: string; plan: 'free' | 'plus' | 'pro' })
      return
    }

    setError(res.error ?? '회원가입에 실패했습니다.')
  }

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('6자리 인증번호를 입력해주세요.')
      return
    }

    setLoading(true)
    setError('')
    setInfo('')

    const res = await window.api.auth.verifyEmail(email, code)
    setLoading(false)

    if (res.success && res.user) {
      onSuccess(res.user as { id: string; email: string; plan: 'free' | 'plus' | 'pro' })
      return
    }

    setError(res.error ?? '이메일 인증에 실패했습니다.')
    setCode('')
    codeRef.current?.focus()
  }

  const handleResend = async () => {
    if (resending || resendCooldown > 0) return

    setResending(true)
    setError('')
    setInfo('')
    const res = await window.api.auth.resendVerification(email)
    setResending(false)

    if (res.success) {
      setResendCooldown(60)
      setInfo(res.message ?? '인증번호를 다시 보냈습니다.')
      return
    }

    if (res.retryAfterSeconds) setResendCooldown(res.retryAfterSeconds)
    setError(res.error ?? '인증번호 재전송에 실패했습니다.')
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    if (phase === 'register') handleRegister()
    else handleVerify()
  }

  const canRegister = !!email && !!password && !!confirmPassword && !loading
  const canVerify = /^\d{6}$/.test(code) && !loading

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
        <p style={styles.subtitle}>{phase === 'register' ? '새 계정 만들기' : '이메일 인증'}</p>
      </div>

      <RegistrationSteps phase={phase} />

      {phase === 'register' ? (
        <div style={styles.form}>
          <div style={styles.verificationNotice}>
            <div style={styles.noticeIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            </div>
            <div style={styles.noticeText}>
              <strong style={styles.noticeTitle}>이메일 인증이 필요합니다</strong>
              <span style={styles.noticeDescription}>회원가입 후 입력한 이메일로 6자리 인증번호를 보내드립니다.</span>
            </div>
          </div>

          <div style={styles.fieldGroup}>
            <div style={styles.labelRow}>
              <label style={styles.label}>이메일</label>
              <span style={styles.requiredBadge}>인증 필수</span>
            </div>
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

          {error && <StatusMessage kind="error" message={error} />}

          <button
            style={{ ...styles.primaryBtn, opacity: canRegister ? 1 : 0.5, cursor: canRegister ? 'pointer' : 'not-allowed' }}
            onClick={handleRegister}
            disabled={!canRegister}
          >
            {loading ? <LoadingLabel label="인증번호 전송 중..." /> : '인증번호 받고 계속하기'}
          </button>
        </div>
      ) : (
        <div style={styles.form}>
          <div style={styles.emailSummary}>
            <span style={styles.emailSummaryLabel}>인증 이메일</span>
            <strong style={styles.emailSummaryValue}>{email}</strong>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>6자리 인증번호</label>
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              style={{ ...styles.input, ...styles.codeInput, borderColor: error ? '#ef4444' : '#334155' }}
              placeholder="000000"
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
              onKeyDown={handleKey}
              disabled={loading}
              autoComplete="one-time-code"
            />
          </div>

          {info && <StatusMessage kind="info" message={info} />}
          {error && <StatusMessage kind="error" message={error} />}

          <button
            style={{ ...styles.primaryBtn, opacity: canVerify ? 1 : 0.5, cursor: canVerify ? 'pointer' : 'not-allowed' }}
            onClick={handleVerify}
            disabled={!canVerify}
          >
            {loading ? <LoadingLabel label="인증 중..." /> : '인증하고 시작하기'}
          </button>

          <button
            style={{ ...styles.secondaryBtn, opacity: resending || resendCooldown > 0 ? 0.55 : 1 }}
            onClick={handleResend}
            disabled={resending || resendCooldown > 0}
          >
            {resending
              ? '전송 중...'
              : resendCooldown > 0
                ? `${resendCooldown}초 후 재전송`
                : '인증번호 다시 보내기'}
          </button>
        </div>
      )}

      <p style={styles.loginLink}>
        이미 계정이 있으신가요?{' '}
        <button style={styles.linkBtn} onClick={onGoLogin}>로그인</button>
      </p>
    </div>
  )
}

function RegistrationSteps({ phase }: { phase: Phase }) {
  const verifying = phase === 'verify'

  return (
    <div style={styles.steps} aria-label="회원가입 진행 단계">
      <div style={styles.step}>
        <span style={{ ...styles.stepCircle, ...(verifying ? styles.stepComplete : styles.stepActive) }}>
          {verifying ? '✓' : '1'}
        </span>
        <span style={{ ...styles.stepLabel, ...(verifying ? styles.stepLabelComplete : styles.stepLabelActive) }}>
          계정 정보
        </span>
      </div>
      <span style={{ ...styles.stepLine, ...(verifying ? styles.stepLineActive : {}) }} />
      <div style={styles.step}>
        <span style={{ ...styles.stepCircle, ...(verifying ? styles.stepActive : {}) }}>2</span>
        <span style={{ ...styles.stepLabel, ...(verifying ? styles.stepLabelActive : {}) }}>이메일 인증</span>
      </div>
    </div>
  )
}

function StatusMessage({ kind, message }: { kind: 'error' | 'info'; message: string }) {
  return (
    <div style={kind === 'error' ? styles.errorMsg : styles.infoMsg}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {message}
    </div>
  )
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <span style={styles.spinnerWrapper}>
      <span style={styles.spinner} />
      {label}
    </span>
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
    textAlign: 'center',
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
  appName: { fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: 0 },
  subtitle: { fontSize: 13, color: '#64748b', margin: 0 },
  steps: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  step: { display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    border: '1px solid #475569',
    color: '#64748b',
    fontSize: 11,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
  },
  stepActive: { borderColor: '#3b82f6', background: '#2563eb', color: '#fff' },
  stepComplete: { borderColor: '#22c55e', background: 'rgba(34,197,94,0.15)', color: '#86efac' },
  stepLabel: { fontSize: 12, fontWeight: 600, color: '#64748b' },
  stepLabelActive: { color: '#bfdbfe' },
  stepLabelComplete: { color: '#86efac' },
  stepLine: { height: 1, background: '#334155', flex: 1, maxWidth: 52, margin: '0 10px' },
  stepLineActive: { background: '#22c55e' },
  form: { width: '100%', display: 'flex', flexDirection: 'column', gap: 12 },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 4 },
  labelRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 12, fontWeight: 600, color: '#94a3b8' },
  requiredBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#93c5fd',
    background: 'rgba(59,130,246,0.12)',
    border: '1px solid rgba(59,130,246,0.28)',
    borderRadius: 999,
    padding: '2px 7px',
  },
  verificationNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: '#bfdbfe',
    background: 'rgba(37,99,235,0.1)',
    border: '1px solid rgba(59,130,246,0.25)',
    borderRadius: 10,
    padding: '10px 12px',
  },
  noticeIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: 'rgba(59,130,246,0.16)',
    color: '#60a5fa',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  noticeText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  noticeTitle: { fontSize: 12, color: '#dbeafe' },
  noticeDescription: { fontSize: 11, lineHeight: 1.45, color: '#93c5fd' },
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
    boxSizing: 'border-box',
  },
  codeInput: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: 8,
    textAlign: 'center',
    paddingLeft: 22,
  },
  emailSummary: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 10,
    padding: '10px 12px',
  },
  emailSummaryLabel: { fontSize: 11, color: '#64748b' },
  emailSummaryValue: { fontSize: 13, color: '#cbd5e1', wordBreak: 'break-all' },
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
  infoMsg: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#93c5fd',
    background: 'rgba(59,130,246,0.08)',
    border: '1px solid rgba(59,130,246,0.2)',
    borderRadius: 7,
    padding: '7px 10px',
  },
  primaryBtn: {
    width: '100%',
    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
    border: 'none',
    borderRadius: 10,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    padding: 12,
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  secondaryBtn: {
    width: '100%',
    background: 'transparent',
    border: '1px solid #475569',
    borderRadius: 10,
    color: '#94a3b8',
    fontSize: 13,
    padding: 10,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  spinnerWrapper: { display: 'flex', alignItems: 'center', gap: 8 },
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin 0.7s linear infinite',
  },
  loginLink: { fontSize: 13, color: '#64748b', margin: 0 },
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
