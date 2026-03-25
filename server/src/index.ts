import cors from 'cors'
import express from 'express'
import helmet from 'helmet'

import { closePool } from './config/db'
import { ALLOWED_ORIGINS, IS_PRODUCTION, NODE_ENV } from './config/env'
import { HOST, PORT, PUBLIC_BASE_URL } from './config/app'
import authRouter from './routes/auth'
import billingRouter from './routes/billing'
import subscriptionRouter from './routes/subscription'
import webhookRouter from './routes/webhook'
import windowsUpdateRouter from './routes/windowsUpdate'

const app = express()
const allowedOriginSet = new Set(ALLOWED_ORIGINS)

app.use(helmet({ contentSecurityPolicy: false }))
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || !IS_PRODUCTION) {
        callback(null, true)
        return
      }

      callback(null, allowedOriginSet.has(origin))
    },
    optionsSuccessStatus: 204,
  })
)
app.use(express.json({ limit: '1mb' }))

app.use('/api/auth', authRouter)
app.use('/api/subscription', subscriptionRouter)
app.use('/api/billing', billingRouter)
app.use('/api/toss/webhook', webhookRouter)
app.use('/api/windows-update', windowsUpdateRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] PC Assistant API server listening on ${HOST}:${PORT}`)
  console.log(`[server] NODE_ENV=${NODE_ENV}`)
  console.log(`[server] Public base URL: ${PUBLIC_BASE_URL}`)
  console.log(`[server] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
})

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`[server] Received ${signal}. Shutting down...`)

  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err)
        return
      }

      resolve()
    })
  })

  await closePool()
  console.log('[server] Shutdown complete')
}

process.on('SIGINT', () => {
  shutdown('SIGINT').finally(() => process.exit(0))
})

process.on('SIGTERM', () => {
  shutdown('SIGTERM').finally(() => process.exit(0))
})

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('[server] Uncaught exception:', error)
  shutdown('uncaughtException').finally(() => process.exit(1))
})

export default app
