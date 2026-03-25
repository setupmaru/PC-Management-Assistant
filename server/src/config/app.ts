import { HOST, PORT, PUBLIC_BASE_URL } from './env'

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function makeApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizeBaseUrl(PUBLIC_BASE_URL)}${normalizedPath}`
}

export { PORT, HOST, PUBLIC_BASE_URL, makeApiUrl }
