import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import pool from '../config/db'
import {
  issueBillingKey,
  saveBillingKey,
  chargeBillingKey,
} from '../services/subscription.service'
import { PLUS_PRICE, PRO_PRICE } from '../config/toss'
import { makeApiUrl } from '../config/app'
import { JWT_ACCESS_SECRET, TOSS_CLIENT_KEY } from '../config/env'

const router = Router()
const TOKEN_SECRET = JWT_ACCESS_SECRET

// ── 빌링 토큰 (15분 수명) ────────────────────────────
export function generateBillingToken(userId: string, plan: 'plus' | 'pro'): string {
  return jwt.sign({ userId, plan, type: 'billing' }, TOKEN_SECRET, { expiresIn: '15m' })
}

function verifyBillingToken(token: string): { userId: string; plan: 'plus' | 'pro' } {
  const p = jwt.verify(token, TOKEN_SECRET) as { userId: string; plan?: string; type: string }
  if (p.type !== 'billing') throw new Error('잘못된 토큰 타입')
  const plan: 'plus' | 'pro' = p.plan === 'plus' ? 'plus' : 'pro'
  return { userId: p.userId, plan }
}

// GET /api/billing/page - TossPayments 카드 등록 HTML 페이지
router.get('/page', (req: Request, res: Response) => {
  const { token } = req.query as { token?: string }

  if (!token) {
    res.status(400).send(errorHtml('잘못된 접근입니다.'))
    return
  }

  try {
    const { userId, plan } = verifyBillingToken(token)
    const clientKey = TOSS_CLIENT_KEY
    const successUrl = makeApiUrl(`/api/billing/success?token=${encodeURIComponent(token)}`)
    const failUrl = makeApiUrl('/api/billing/fail')

    const planLabel = plan === 'plus' ? 'Plus' : 'Pro'
    const price = plan === 'plus' ? PLUS_PRICE : PRO_PRICE
    const priceFormatted = price.toLocaleString('ko-KR')

    res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PC 관리 어시스턴트 - ${planLabel} 구독 결제</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#0f172a;color:#f1f5f9;display:flex;align-items:center;
      justify-content:center;min-height:100vh;flex-direction:column;gap:16px}
    .logo{width:56px;height:56px;border-radius:50%;background:rgba(59,130,246,.1);
      border:1px solid rgba(59,130,246,.3);display:flex;align-items:center;justify-content:center}
    h2{font-size:18px;font-weight:700;color:#f1f5f9}
    p{font-size:13px;color:#64748b}
    .spinner{width:36px;height:36px;border:3px solid #334155;
      border-top-color:#3b82f6;border-radius:50%;animation:spin .7s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .price{font-size:24px;font-weight:700;color:#3b82f6}
    .price span{font-size:14px;color:#64748b;font-weight:400}
  </style>
</head>
<body>
  <div class="logo">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.8">
      <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
    </svg>
  </div>
  <h2>${planLabel} 구독 결제</h2>
  <div class="price">₩${priceFormatted} <span>/ 월</span></div>
  <p>카드를 등록하면 매월 자동 결제됩니다.</p>
  <div class="spinner" id="spinner"></div>
  <p id="msg">결제창 불러오는 중...</p>

  <script src="https://js.tosspayments.com/v1/payment"></script>
  <script>
    (async () => {
      try {
        const tossPayments = TossPayments('${clientKey}')
        await tossPayments.requestBillingAuth('카드', {
          customerKey: '${userId}',
          successUrl: '${successUrl}',
          failUrl: '${failUrl}',
        })
      } catch (err) {
        document.getElementById('spinner').style.display = 'none'
        if (err.code === 'USER_CANCEL') {
          document.getElementById('msg').textContent = '결제를 취소했습니다. 창을 닫아주세요.'
        } else {
          document.getElementById('msg').textContent = '오류: ' + (err.message || err.code)
        }
      }
    })()
  </script>
</body>
</html>`)
  } catch {
    res.status(400).send(errorHtml('만료되었거나 유효하지 않은 링크입니다. 앱에서 다시 시도해주세요.'))
  }
})

// GET /api/billing/success - 카드 등록 성공 콜백
router.get('/success', async (req: Request, res: Response) => {
  const { authKey, customerKey, token } = req.query as {
    authKey?: string
    customerKey?: string
    token?: string
  }

  if (!authKey || !customerKey || !token) {
    res.send(errorHtml('필수 파라미터가 누락되었습니다.'))
    return
  }

  try {
    const { userId, plan } = verifyBillingToken(token)

    if (customerKey !== userId) throw new Error('customerKey 불일치')

    // 빌링키 발급
    const billingKey = await issueBillingKey(authKey, customerKey)
    await saveBillingKey(userId, billingKey)

    // 첫 달 결제
    const userResult = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [userId]
    )
    const email = userResult.rows[0]?.email ?? ''
    await chargeBillingKey(billingKey, userId, email, plan)

    const planLabel = plan === 'plus' ? 'Plus' : 'Pro'
    res.send(successHtml(`${planLabel} 구독이 시작되었습니다!`, '앱으로 돌아가면 기능을 바로 이용할 수 있습니다.'))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    res.send(errorHtml(msg))
  }
})

// GET /api/billing/fail - 결제 실패 콜백
router.get('/fail', (req: Request, res: Response) => {
  const { message, code } = req.query as { message?: string; code?: string }
  res.send(errorHtml(message ?? `결제 실패 (코드: ${code ?? 'UNKNOWN'})`))
})

// ── HTML 헬퍼 ─────────────────────────────────────────
function successHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>결제 완료</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;
  display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:14px}
.icon{font-size:52px}h2{font-size:20px;color:#4ade80}
p{font-size:13px;color:#64748b;max-width:280px;text-align:center;line-height:1.6}
button{margin-top:8px;background:#3b82f6;border:none;border-radius:8px;
  color:#fff;font-size:14px;padding:10px 28px;cursor:pointer;font-family:inherit}</style>
</head><body>
<div class="icon">✅</div><h2>${title}</h2><p>${body}</p>
<button onclick="window.close()">창 닫기</button>
<script>setTimeout(()=>window.close(),5000)</script>
</body></html>`
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>결제 오류</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;
  display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:14px}
.icon{font-size:52px}h2{font-size:20px;color:#f87171}
p{font-size:13px;color:#64748b;max-width:280px;text-align:center}
button{margin-top:8px;background:#334155;border:none;border-radius:8px;
  color:#fff;font-size:14px;padding:10px 28px;cursor:pointer;font-family:inherit}</style>
</head><body>
<div class="icon">❌</div><h2>결제 실패</h2><p>${message}</p>
<button onclick="window.close()">창 닫기</button>
</body></html>`
}

export default router
