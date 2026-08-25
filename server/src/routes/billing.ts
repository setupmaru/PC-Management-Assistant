import { Router } from 'express'

const router = Router()

router.get('/success', (_req, res) => {
  res.send(resultHtml(
    true,
    '결제가 완료되었습니다!',
    '구독 정보를 반영하고 있습니다. 잠시 후 창을 닫고 앱에서 확인해주세요.'
  ))
})

router.get('/cancelled', (_req, res) => {
  res.send(resultHtml(false, '결제가 취소되었습니다.', '결제되지 않았습니다. 앱에서 다시 시도할 수 있습니다.'))
})

router.get('/portal-return', (_req, res) => {
  res.send(resultHtml(true, '구독 관리가 완료되었습니다.', '앱으로 돌아가 최신 구독 상태를 확인해주세요.'))
})

function resultHtml(success: boolean, title: string, message: string): string {
  const color = success ? '#4ade80' : '#fbbf24'
  const icon = success ? '✓' : '–'
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh}
    main{width:min(420px,calc(100% - 32px));padding:32px 24px;text-align:center;background:#1e293b;border:1px solid #334155;border-radius:14px}
    .icon{width:52px;height:52px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;font-size:30px;color:${color};border:1px solid ${color}}
    h1{font-size:20px;margin-bottom:10px;color:${color}}
    p{font-size:13px;line-height:1.7;color:#94a3b8}
    button{margin-top:22px;padding:10px 26px;border:0;border-radius:8px;background:#3b82f6;color:#fff;cursor:pointer}
  </style>
</head>
<body><main><div class="icon">${icon}</div><h1>${title}</h1><p>${message}</p><button onclick="window.close()">창 닫기</button></main></body>
</html>`
}

export default router
