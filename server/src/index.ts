import cors from 'cors'
import express from 'express'
import helmet from 'helmet'

import pool, { closePool } from './config/db'
import { ALLOWED_ORIGINS, IS_PRODUCTION, NODE_ENV } from './config/env'
import { HOST, PORT, PUBLIC_BASE_URL } from './config/app'
import authRouter from './routes/auth'
import billingRouter from './routes/billing'
import chatRouter from './routes/chat'
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
app.use('/api/polar/webhook', express.raw({ type: 'application/json', limit: '256kb' }), webhookRouter)
// Authenticate chat requests before accepting their larger image-capable JSON bodies.
app.use('/api/chat', chatRouter)
app.use(express.json({ limit: '1mb' }))

app.use('/api/auth', authRouter)
app.use('/api/subscription', subscriptionRouter)
app.use('/api/billing', billingRouter)
app.use('/api/windows-update', windowsUpdateRouter)

async function handleHealthCheck(_req: express.Request, res: express.Response): Promise<void> {
  const timestamp = new Date().toISOString()

  try {
    await pool.query('SELECT 1')
    res.json({
      status: 'ok',
      api: { reachable: true },
      db: { reachable: true },
      timestamp,
    })
  } catch (error) {
    console.error('[health] Database health check failed:', error)
    res.status(503).json({
      status: 'degraded',
      api: { reachable: true },
      db: { reachable: false },
      timestamp,
    })
  }
}

app.get('/api/health', handleHealthCheck)
app.get('/health', handleHealthCheck)

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
