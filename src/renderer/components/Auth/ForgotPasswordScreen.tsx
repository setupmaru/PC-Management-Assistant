import { KeyboardEvent, useEffect, useRef, useState } from 'react'

interface Props {
  initialEmail?: string
  onGoLogin: () => void
}

type Phase = 'request' | 'reset' | 'success'

export default function ForgotPasswordScreen({ initialEmail = '', onGoLogin }: Props) {
  const [phase, setPhase] = useState<Phase>('request')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const emailRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (phase === 'request') emailRef.current?.focus()
    if (phase === 'reset') codeRef.current?.focus()
  }, [phase])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  const requestCode = async (resend = false) => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('유효한 이메일 주소를 입력해주세요.')
      return
    }

    if (resend) setResending(true)
    else setLoading(true)
    setError('')
    setInfo('')
    const res = await window.api.auth.requestPasswordReset(normalizedEmail)
    setLoading(false)
    setResending(false)

    if (!res.success) {
      setError(res.error ?? '인증번호 전송에 실패했습니다.')
      return
    }

    setEmail(normalizedEmail)
    setPhase('reset')
    setResendCooldown(60)
    setInfo(res.message ?? '계정이 존재하면 인증번호를 전송했습니다.')
  }

  const handleReset = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('6자리 인증번호를 입력해주세요.')
      return
    }
    if (password.length < 8) {
      setError('새 비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }

    setLoading(true)
    setError('')
    setInfo('')
    const res = await window.api.auth.resetPassword(email, code, password)
    setLoading(false)

    if (!res.success) {
      setError(res.error ?? '비밀번호 재설정에 실패했습니다.')
      setCode('')
      codeRef.current?.focus()
      return
    }

    setPassword('')
    setConfirmPassword('')
    setPhase('success')
    setInfo(res.message ?? '비밀번호가 변경되었습니다.')
  }

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    if (phase === 'request') requestCode()
    if (phase === 'reset') handleReset()
  }

  const canRequest = Boolean(email.trim()) && !loading
  const canReset = /^\d{6}$/.test(code) && password.length >= 8 && Boolean(confirmPassword) && !loading

  return (
    <div style={styles.card}>
      <div style={styles.logoArea}>
        <div style={styles.logoCircle}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4M12 15v2" />
          </svg>
        </div>
        <h1 style={styles.appName}>비밀번호 찾기</h1>
        <p style={styles.subtitle}>
          {phase === 'request' && '가입한 이메일로 인증번호를 보내드립니다.'}
          {phase === 'reset' && '인증번호와 새 비밀번호를 입력해주세요.'}
          {phase === 'success' && '비밀번호 재설정이 완료되었습니다.'}
        </p>
      </div>

      {phase === 'request' && (
        <div style={styles.form}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>이메일</label>
            <input
              ref={emailRef}
              type="email"
              style={{ ...styles.input, borderColor: error ? '#ef4444' : '#334155' }}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => { setEmail(event.target.value); setError('') }}
              onKeyDown={handleKey}
              disabled={loading}
              autoComplete="email"
            />
          </div>
          {error && <StatusMessage kind="error" message={error} />}
          <button
            style={{ ...styles.primaryBtn, opacity: canRequest ? 1 : 0.5 }}
            onClick={() => requestCode()}
            disabled={!canRequest}
          >
            {loading ? <LoadingLabel label="전송 중..." /> : '인증번호 보내기'}
          </button>
        </div>
      )}

      {phase === 'reset' && (
        <div style={styles.form}>
          <div style={styles.emailSummary}>
            <span style={styles.emailLabel}>재설정 이메일</span>
            <strong style={styles.emailValue}>{email}</strong>
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>6자리 인증번호</label>
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              style={{ ...styles.input, ...styles.codeInput, borderColor: error ? '#ef4444' : '#334155' }}
              placeholder="000000"
              value={code}
              onChange={(event) => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
              onKeyDown={handleKey}
              disabled={loading}
              autoComplete="one-time-code"
            />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>새 비밀번호 (8자 이상)</label>
            <input
              type="password"
              style={{ ...styles.input, borderColor: error ? '#ef4444' : '#334155' }}
              placeholder="새 비밀번호"
              value={password}
              onChange={(event) => { setPassword(event.target.value); setError('') }}
              onKeyDown={handleKey}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>새 비밀번호 확인</label>
            <input
              type="password"
              style={{ ...styles.input, borderColor: error ? '#ef4444' : '#334155' }}
              placeholder="새 비밀번호 재입력"
              value={confirmPassword}
              onChange={(event) => { setConfirmPassword(event.target.value); setError('') }}
              onKeyDown={handleKey}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>
          {info && <StatusMessage kind="info" message={info} />}
          {error && <StatusMessage kind="error" message={error} />}
          <button
            style={{ ...styles.primaryBtn, opacity: canReset ? 1 : 0.5 }}
            onClick={handleReset}
            disabled={!canReset}
          >
            {loading ? <LoadingLabel label="변경 중..." /> : '비밀번호 변경하기'}
          </button>
          <div style={styles.secondaryActions}>
            <button
              style={styles.secondaryBtn}
              onClick={() => requestCode(true)}
              disabled={resending || resendCooldown > 0}
            >
              {resending ? '전송 중...' : resendCooldown > 0 ? `${resendCooldown}초 후 재전송` : '인증번호 다시 보내기'}
            </button>
            <button
              style={styles.secondaryBtn}
              onClick={() => { setPhase('request'); setCode(''); setError(''); setInfo('') }}
              disabled={loading || resending}
            >
              이메일 변경
            </button>
          </div>
        </div>
      )}

      {phase === 'success' && (
        <div style={styles.successArea}>
          <div style={styles.successIcon}>✓</div>
          {info && <StatusMessage kind="info" message={info} />}
          <button style={styles.primaryBtn} onClick={onGoLogin}>로그인 화면으로</button>
        </div>
      )}

      {phase !== 'success' && (
        <p style={styles.loginLink}>
          비밀번호가 기억나셨나요?{' '}
          <button style={styles.linkBtn} onClick={onGoLogin}>로그인</button>
        </p>
      )}
    </div>
  )
}

function StatusMessage({ kind, message }: { kind: 'error' | 'info'; message: string }) {
  return <div style={kind === 'error' ? styles.errorMsg : styles.infoMsg}>{message}</div>
}

function LoadingLabel({ label }: { label: string }) {
  return <span style={styles.loadingLabel}><span style={styles.spinner} />{label}</span>
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: '#1e293b', border: '1px solid #334155', borderTop: '2px solid #334155', borderRadius: 12, padding: '24px 16px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, boxSizing: 'border-box' },
  logoArea: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' },
  logoCircle: { width: 54, height: 54, borderRadius: '50%', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  appName: { fontSize: 17, fontWeight: 700, color: '#f1f5f9', margin: 0 },
  subtitle: { fontSize: 12, color: '#94a3b8', margin: 0, lineHeight: 1.5 },
  form: { width: '100%', display: 'flex', flexDirection: 'column', gap: 11 },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: '#94a3b8' },
  input: { width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9', fontSize: 14, padding: '10px 13px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
  codeInput: { textAlign: 'center', letterSpacing: '0.35em', fontSize: 18, fontWeight: 700 },
  primaryBtn: { width: '100%', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 600, padding: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  secondaryActions: { display: 'flex', justifyContent: 'space-between', gap: 12 },
  secondaryBtn: { background: 'none', border: 'none', color: '#60a5fa', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: 0 },
  errorMsg: { fontSize: 12, color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, padding: '8px 10px', lineHeight: 1.4 },
  infoMsg: { fontSize: 12, color: '#93c5fd', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 7, padding: '8px 10px', lineHeight: 1.4 },
  emailSummary: { display: 'flex', flexDirection: 'column', gap: 3, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 11px' },
  emailLabel: { fontSize: 10, color: '#64748b' },
  emailValue: { fontSize: 12, color: '#cbd5e1', wordBreak: 'break-all' },
  successArea: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 },
  successIcon: { width: 48, height: 48, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(74,222,128,0.35)', color: '#86efac', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700 },
  loginLink: { fontSize: 12, color: '#64748b', margin: 0 },
  linkBtn: { background: 'none', border: 'none', color: '#3b82f6', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0, textDecoration: 'underline' },
  loadingLabel: { display: 'flex', alignItems: 'center', gap: 8 },
  spinner: { width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' },
}
