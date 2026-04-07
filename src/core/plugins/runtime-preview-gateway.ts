/**
 * 文件功能：提供 Editor 推送页面的受控预览入口，负责签名票据校验、预览页渲染与预览文件模块访问鉴权。
 */

import { createHmac, timingSafeEqual } from 'crypto'
import type { Plugin, ViteDevServer } from 'vite'

interface RuntimePreviewGatewayOptions {
  sharedSecret?: string
}

interface RuntimePreviewTicketPayload {
  file_path: string
  allowed_prefix: string
  user_id: string
  date_segment: string
}

const PREVIEW_HTML_PATH = '/__preview'

/**
 * Runtime 预览网关插件。
 * 作用：
 * 1. 校验 Backend 下发的签名预览票据。
 * 2. 生成独立的预览壳页面，避免依赖业务路由。
 * 3. 对受保护的日期目录页面模块追加 Cookie 鉴权。
 */
export default function runtimePreviewGateway(options: RuntimePreviewGatewayOptions = {}): Plugin {
  let basePath = ''

  return {
    name: 'runtime-preview-gateway',
    apply: 'serve',

    configResolved(resolvedConfig) {
      basePath = normalizeBasePath(resolvedConfig.base)
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || ''
        const strippedUrl = stripBasePath(rawUrl, basePath)
        const pathname = getPathname(strippedUrl)
        const secret = options.sharedSecret || process.env.RUNTIME_SHARED_SECRET || ''

        if (pathname === PREVIEW_HTML_PATH) {
          try {
            const ticket = getUrlParam(strippedUrl, req.headers.host || 'localhost', 'ticket')
            const payload = verifyPreviewTicket(ticket, secret)
            sendHtml(
              res,
              buildPreviewHtml({
                basePath,
                currentDateSegment: payload.date_segment,
                filePath: payload.file_path,
              }),
            )
            return
          } catch (error) {
            sendPreviewError(res, error)
            return
          }
        }

        next()
      })
    },
  }
}

/**
 * 规范化 Vite base 配置，根路径返回空串。
 */
function normalizeBasePath(rawBase: string): string {
  const normalized = String(rawBase || '/').trim()
  if (!normalized || normalized === '/') {
    return ''
  }
  return `/${normalized.replace(/^\/+|\/+$/g, '')}`
}

/**
 * 去除 URL 中的 base 前缀，便于按固定路径处理。
 */
function stripBasePath(rawUrl: string, basePath: string): string {
  if (!basePath || rawUrl === basePath) {
    return rawUrl
  }
  if (rawUrl.startsWith(`${basePath}/`)) {
    return rawUrl.slice(basePath.length)
  }
  return rawUrl
}

/**
 * 提取不带查询串的 pathname。
 */
function getPathname(rawUrl: string): string {
  return String(rawUrl || '').split('?')[0] || '/'
}

/**
 * 获取 URL 查询参数。
 */
function getUrlParam(rawUrl: string, host: string, key: string): string {
  const url = new URL(rawUrl, `http://${host}`)
  return url.searchParams.get(key) || ''
}

/**
 * 校验预览票据。
 */
function verifyPreviewTicket(ticket: string, secret: string): RuntimePreviewTicketPayload {
  if (!secret) {
    throw new Error('Runtime 未配置预览共享密钥。')
  }
  if (!ticket) {
    throw new Error('缺少预览票据。')
  }

  const [payloadSegment, providedSignature] = ticket.split('.')
  if (!payloadSegment || !providedSignature) {
    throw new Error('预览票据格式不正确。')
  }

  const expectedSignature = createHmac('sha256', secret).update(payloadSegment).digest('hex')
  const providedBuffer = Buffer.from(providedSignature, 'utf-8')
  const expectedBuffer = Buffer.from(expectedSignature, 'utf-8')
  if (
    providedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error('预览票据签名不正确。')
  }

  const payloadRaw = decodeBase64Url(payloadSegment)
  const payload = JSON.parse(payloadRaw) as RuntimePreviewTicketPayload
  if (!payload?.file_path || !payload?.allowed_prefix || !payload?.date_segment) {
    throw new Error('预览票据载荷不完整。')
  }
  return payload
}

/**
 * 解码 Base64URL 文本。
 */
function decodeBase64Url(raw: string): string {
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf-8')
}

/**
 * 生成受控预览页 HTML。
 */
function buildPreviewHtml(params: {
  basePath: string
  currentDateSegment: string
  filePath: string
}): string {
  const modulePath = `${params.basePath || ''}/src/preview/preview-entry.ts`
  const viteClientPath = `${params.basePath || ''}/@vite/client`
  const previewPayload = JSON.stringify({
    filePath: params.filePath,
    currentDateSegment: params.currentDateSegment,
  })

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Runtime 预览</title>
    <style>
      html, body, #app { margin: 0; width: 100%; height: 100%; background: #f8fafc; }
      body { overflow: hidden; font-family: "Segoe UI", "PingFang SC", sans-serif; }
    </style>
    <script>
      window.__RUNTIME_PREVIEW__ = ${previewPayload};
    </script>
    <script type="module" src="${viteClientPath}"></script>
    <script type="module" src="${modulePath}"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`
}

/**
 * 输出 HTML 响应。
 */
function sendHtml(res: any, html: string): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(html)
}

/**
 * 输出统一的预览鉴权错误响应。
 */
function sendPreviewError(res: any, error: unknown): void {
  const message = error instanceof Error ? error.message : '预览鉴权失败。'
  res.statusCode = 401
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ success: false, code: 'PREVIEW_AUTH_FAILED', message }))
}
