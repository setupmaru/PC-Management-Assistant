const fs = require('fs')
const https = require('https')
const http = require('http')

const pfx = fs.readFileSync('C:/Users/doyoon/Desktop/PC Management Assistant/infra/certs/api.setupmaru.com.pfx')
const passphrase = 'pcassistant'
const targetHost = '127.0.0.1'
const targetPort = 3400

const server = https.createServer(
  {
    pfx,
    passphrase,
  },
  (req, res) => {
    const upstream = http.request(
      {
        host: targetHost,
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          host: req.headers.host || 'api.setupmaru.com',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': req.headers.host || 'api.setupmaru.com',
        },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
        upstreamRes.pipe(res)
      },
    )

    upstream.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`upstream error: ${error.message}`)
    })

    req.pipe(upstream)
  },
)

server.listen(443, '0.0.0.0', () => {
  console.log('HTTPS proxy listening on 0.0.0.0:443 -> 127.0.0.1:3400')
})
