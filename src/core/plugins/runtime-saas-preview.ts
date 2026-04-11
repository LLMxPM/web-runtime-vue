/**
 * 文件用途：提供 SaaS 化整项目预览入口、JWS 验签、发布产物预加载与远程虚拟模块解析能力。
 */

import { posix } from 'path'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { Plugin, ViteDevServer } from 'vite'

import {
  buildRemoteModuleId,
  isBuiltinLocalViewPath,
  normalizeViewModulePath,
  parseRemoteModuleId,
  type RuntimePreloadedConfigBundle,
  type RuntimePreviewContext,
  type RuntimeReleaseManifest,
} from '../shared/runtime-preview'

interface RuntimeSaaSPreviewOptions {
  previewPath?: string
  previewHeaderName?: string
  jwksUrl?: string
  previewAudience?: string
  backendApiBaseUrl?: string
  serviceJwt?: string
  serviceTokenAudience?: string
}

interface PreviewTokenClaims extends JWTPayload {
  sub: string
  tenant_id: string
  project_id: string
  release_id: string
  entry_route: string
  asset_base_url: string
  trace_id: string
  jti: string
}

interface RuntimePreviewSessionPayload {
  session_id: string
  tenant_id: string
  project_id: string
  release_id: string
  entry_route: string
  asset_base_url: string
  trace_id: string
  expires_at?: string | number
}

interface RuntimeResolvedPreviewSession {
  publicContext: RuntimePreviewContext
}

const DEFAULT_PREVIEW_PATH = '/__preview'
const DEFAULT_PREVIEW_HEADER = 'x-runtime-preview-context'
const DEFAULT_PREVIEW_AUDIENCE = 'runtime-preview'

/**
 * SaaS 预览插件：
 * 1. 仅在 Vite serve 下生效；
 * 2. 对 HTML 入口执行 JWS 验签与配置预加载；
 * 3. 为项目页面提供基于发布产物白名单的远程模块加载；
 * 4. 不依赖进程内预览会话缓存，模块请求通过 Backend 预览会话接口恢复上下文。
 */
export default function runtimeSaaSPreview(options: RuntimeSaaSPreviewOptions = {}): Plugin {
  const previewPath = options.previewPath || DEFAULT_PREVIEW_PATH
  const previewHeaderName = (options.previewHeaderName || DEFAULT_PREVIEW_HEADER).toLowerCase()
  const manifestCache = new Map<string, RuntimeReleaseManifest>()
  let basePath = ''

  return {
    name: 'runtime-saas-preview',
    apply: 'serve',

    configResolved(resolvedConfig) {
      basePath = normalizeBasePath(resolvedConfig.base)
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || ''
        const strippedUrl = stripBasePath(rawUrl, basePath)
        if (getPathname(strippedUrl) !== previewPath) {
          return next()
        }

        try {
          const previewToken = String(req.headers[previewHeaderName] || '')
          if (!previewToken) {
            throw new PreviewGatewayError(401, 'PREVIEW_CONTEXT_REQUIRED', '缺少预览上下文令牌。')
          }

          const verified = await verifyPreviewToken(previewToken, {
            jwksUrl: options.jwksUrl || process.env.RUNTIME_PREVIEW_JWKS_URL || '',
            audience: options.previewAudience || process.env.RUNTIME_PREVIEW_TOKEN_AUDIENCE || DEFAULT_PREVIEW_AUDIENCE,
          })

          const backendClient = createBackendClient({
            backendApiBaseUrl: options.backendApiBaseUrl || process.env.RUNTIME_BACKEND_API_BASE_URL || '',
            serviceJwt: options.serviceJwt || process.env.RUNTIME_SERVICE_JWT || '',
            serviceTokenAudience: options.serviceTokenAudience || process.env.RUNTIME_SERVICE_TOKEN_AUDIENCE || '',
            previewSessionId: verified.publicContext.sessionId,
            previewToken,
          })

          const [manifest, configBundle] = await Promise.all([
            fetchReleaseManifest(verified.releaseId, backendClient, manifestCache),
            backendClient.fetchConfigBundle(verified.releaseId),
          ])

          assertManifestMatchesContext(manifest, verified.publicContext)

          sendHtml(res, buildPreviewHtml({
            basePath,
            publicContext: verified.publicContext,
            configBundle: {
              ...configBundle,
              manifest,
            },
          }))
        } catch (error) {
          sendPreviewError(res, error)
        }
      })
    },

    async resolveId(source, importer) {
      if (parseRemoteModuleId(source)) {
        return source
      }

      const importerInfo = importer ? parseRemoteModuleId(importer) : null
      if (!importerInfo) {
        return null
      }

      const resolvedViewPath = resolveRemoteViewImport(source, importerInfo.modulePath)
      if (!resolvedViewPath || isBuiltinLocalViewPath(resolvedViewPath)) {
        return null
      }

      return buildRemoteModuleId(importerInfo.sessionId, importerInfo.releaseId, resolvedViewPath)
    },

    async load(id) {
      const parsed = parseRemoteModuleId(id)
      if (!parsed) {
        return null
      }

      const backendClient = createBackendClient({
        backendApiBaseUrl: options.backendApiBaseUrl || process.env.RUNTIME_BACKEND_API_BASE_URL || '',
        serviceJwt: options.serviceJwt || process.env.RUNTIME_SERVICE_JWT || '',
        serviceTokenAudience: options.serviceTokenAudience || process.env.RUNTIME_SERVICE_TOKEN_AUDIENCE || '',
        previewSessionId: parsed.sessionId,
      })

      const session = await backendClient.fetchPreviewSession(parsed.sessionId)
      if (session.publicContext.releaseId !== parsed.releaseId) {
        throw new PreviewGatewayError(403, 'RELEASE_MISMATCH', '预览版本与会话上下文不一致。')
      }

      const manifest = await fetchReleaseManifest(parsed.releaseId, backendClient, manifestCache)
      assertManifestMatchesContext(manifest, session.publicContext)

      const manifestEntry = manifest.modules[parsed.modulePath]
      if (!manifestEntry) {
        throw new PreviewGatewayError(404, 'MODULE_NOT_ALLOWED', `模块未包含在发布白名单中：${parsed.modulePath}`)
      }

      return backendClient.fetchModuleSource(parsed.releaseId, parsed.modulePath)
    },
  }
}

/**
 * 预览网关错误类型，便于统一映射状态码与错误码。
 */
class PreviewGatewayError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

/**
 * 根据 `@/views`、`/src/views` 或相对路径计算远程视图导入目标。
 * @param source import 源
 * @param importerPath 导入方逻辑路径
 * @returns 目标逻辑路径；非远程视图导入时返回 null
 */
function resolveRemoteViewImport(source: string, importerPath: string): string | null {
  const normalizedSource = String(source || '').trim().replace(/\\/g, '/')
  if (!normalizedSource) {
    return null
  }

  if (normalizedSource.startsWith('@/views/') || normalizedSource.startsWith('/src/views/') || normalizedSource.startsWith('src/views/') || normalizedSource.startsWith('views/')) {
    return normalizeViewModulePath(normalizedSource)
  }

  if (normalizedSource.startsWith('./') || normalizedSource.startsWith('../')) {
    const importerDir = posix.dirname(importerPath)
    return normalizeViewModulePath(posix.normalize(posix.join(importerDir, normalizedSource)))
  }

  return null
}

/**
 * 规范化 Vite base，根路径返回空串。
 * @param rawBase 原始 base 配置
 * @returns 规范化前缀
 */
function normalizeBasePath(rawBase: string): string {
  const normalized = String(rawBase || '/').trim()
  if (!normalized || normalized === '/' || normalized === '.' || normalized === './') {
    return ''
  }

  const stripped = normalized
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')

  return stripped ? `/${stripped}` : ''
}

/**
 * 去掉 URL 中的 base 前缀。
 * @param rawUrl 原始 URL
 * @param basePath 规范化前缀
 * @returns 去前缀后的 URL
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
 * 提取 URL pathname。
 * @param rawUrl 原始 URL
 * @returns pathname
 */
function getPathname(rawUrl: string): string {
  return String(rawUrl || '').split('?')[0] || '/'
}

/**
 * 校验预览上下文 JWS，并构造可公开注入浏览器的上下文。
 * @param token JWS 令牌
 * @param options 校验选项
 * @returns 校验后的结果
 */
async function verifyPreviewToken(token: string, options: { jwksUrl: string; audience: string }): Promise<{
  publicContext: RuntimePreviewContext
  releaseId: string
}> {
  if (!options.jwksUrl) {
    throw new PreviewGatewayError(503, 'JWKS_URL_MISSING', 'Runtime 未配置预览 JWKS 地址。')
  }

  const jwks = createRemoteJWKSet(new URL(options.jwksUrl))
  const { payload } = await jwtVerify(token, jwks, {
    audience: options.audience,
  })

  const claims = payload as PreviewTokenClaims
  if (!claims.jti || !claims.tenant_id || !claims.project_id || !claims.release_id || !claims.entry_route || !claims.asset_base_url || !claims.trace_id) {
    throw new PreviewGatewayError(401, 'PREVIEW_CONTEXT_INVALID', '预览上下文缺少必填声明。')
  }

  return {
    publicContext: {
      sessionId: claims.jti,
      tenantId: String(claims.tenant_id),
      projectId: String(claims.project_id),
      releaseId: String(claims.release_id),
      entryRoute: String(claims.entry_route),
      assetBaseUrl: String(claims.asset_base_url),
      traceId: String(claims.trace_id),
    },
    releaseId: String(claims.release_id),
  }
}

/**
 * 构造 Backend 内部 API 客户端。
 * @param options 客户端参数
 * @returns 内部 API 客户端
 */
function createBackendClient(options: {
  backendApiBaseUrl: string
  serviceJwt: string
  serviceTokenAudience: string
  previewSessionId?: string
  previewToken?: string
}) {
  if (!options.backendApiBaseUrl) {
    throw new PreviewGatewayError(503, 'BACKEND_API_BASE_URL_MISSING', 'Runtime 未配置 Backend API 根地址。')
  }
  if (!options.serviceJwt) {
    throw new PreviewGatewayError(503, 'SERVICE_JWT_MISSING', 'Runtime 未配置服务级 JWT。')
  }

  const apiBaseUrl = options.backendApiBaseUrl.replace(/\/+$/, '')
  const defaultHeaders: Record<string, string> = {
    Authorization: `Bearer ${options.serviceJwt}`,
  }
  if (options.previewToken) {
    defaultHeaders['x-runtime-preview-context'] = options.previewToken
  }
  if (options.previewSessionId) {
    defaultHeaders['x-runtime-preview-session-id'] = options.previewSessionId
  }
  if (options.serviceTokenAudience) {
    defaultHeaders['x-runtime-service-audience'] = options.serviceTokenAudience
  }

  return {
    async fetchPreviewSession(sessionId: string): Promise<RuntimeResolvedPreviewSession> {
      const sessionPayload = await requestJson<RuntimePreviewSessionPayload>(
        `${apiBaseUrl}/internal/runtime/preview-sessions/${encodeURIComponent(sessionId)}`,
        defaultHeaders
      )
      return normalizePreviewSession(sessionId, sessionPayload)
    },

    async fetchManifest(releaseId: string): Promise<RuntimeReleaseManifest> {
      return requestJson<RuntimeReleaseManifest>(`${apiBaseUrl}/internal/runtime/releases/${encodeURIComponent(releaseId)}/manifest`, defaultHeaders)
    },

    async fetchConfigBundle(releaseId: string): Promise<RuntimePreloadedConfigBundle> {
      return requestJson<RuntimePreloadedConfigBundle>(`${apiBaseUrl}/internal/runtime/releases/${encodeURIComponent(releaseId)}/config-bundle`, defaultHeaders)
    },

    async fetchModuleSource(releaseId: string, modulePath: string): Promise<string> {
      const url = `${apiBaseUrl}/internal/runtime/releases/${encodeURIComponent(releaseId)}/modules?path=${encodeURIComponent(modulePath)}`
      const response = await fetch(url, {
        headers: {
          ...defaultHeaders,
          Accept: 'text/plain, application/json;q=0.9',
        },
      })
      if (!response.ok) {
        throw await toPreviewError(response, 'MODULE_FETCH_FAILED')
      }
      return response.text()
    },
  }
}

/**
 * 请求 JSON 接口并统一处理错误。
 * @param url 请求地址
 * @param headers 请求头
 * @returns 解析后的 JSON
 */
async function requestJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    headers: {
      ...headers,
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw await toPreviewError(response, 'BACKEND_REQUEST_FAILED')
  }
  return response.json() as Promise<T>
}

/**
 * 将 Backend 响应转换为预览网关错误。
 * @param response 原始响应
 * @param fallbackCode 兜底错误码
 * @returns 统一错误对象
 */
async function toPreviewError(response: Response, fallbackCode: string): Promise<PreviewGatewayError> {
  let message = response.statusText || 'Backend 请求失败。'
  let code = fallbackCode
  try {
    const payload = await response.json()
    code = String(payload?.code || code)
    message = String(payload?.message || message)
  } catch {
    // 忽略 JSON 解析异常，保留默认错误信息
  }
  return new PreviewGatewayError(response.status, code, message)
}

/**
 * 校验 manifest 与预览上下文声明是否一致。
 * @param manifest 发布清单
 * @param verifiedToken 已校验的令牌信息
 */
function assertManifestMatchesContext(
  manifest: RuntimeReleaseManifest,
  previewContext: RuntimePreviewContext,
): void {
  if (
    manifest.release_id !== previewContext.releaseId
    || manifest.tenant_id !== previewContext.tenantId
    || manifest.project_id !== previewContext.projectId
  ) {
    throw new PreviewGatewayError(403, 'MANIFEST_CONTEXT_MISMATCH', '发布清单与预览上下文不一致。')
  }
}

/**
 * 按发布版本读取清单，允许缓存不可变 manifest 以减少重复请求。
 * @param releaseId 发布版本 ID
 * @param backendClient Backend 客户端
 * @param manifestCache manifest 缓存
 * @returns 发布清单
 */
async function fetchReleaseManifest(
  releaseId: string,
  backendClient: ReturnType<typeof createBackendClient>,
  manifestCache: Map<string, RuntimeReleaseManifest>,
): Promise<RuntimeReleaseManifest> {
  const cachedManifest = manifestCache.get(releaseId)
  if (cachedManifest) {
    return cachedManifest
  }

  const manifest = await backendClient.fetchManifest(releaseId)
  manifestCache.set(releaseId, manifest)
  return manifest
}

/**
 * 将 Backend 返回的预览会话结构转换为 Runtime 使用的公开上下文。
 * @param expectedSessionId 期望的会话 ID
 * @param payload Backend 返回的会话数据
 * @returns 已规范化的预览会话
 */
function normalizePreviewSession(
  expectedSessionId: string,
  payload: RuntimePreviewSessionPayload,
): RuntimeResolvedPreviewSession {
  if (
    !payload?.session_id
    || !payload.tenant_id
    || !payload.project_id
    || !payload.release_id
    || !payload.entry_route
    || !payload.asset_base_url
    || !payload.trace_id
  ) {
    throw new PreviewGatewayError(401, 'PREVIEW_SESSION_INVALID', '预览会话上下文缺少必填字段。')
  }

  if (payload.session_id !== expectedSessionId) {
    throw new PreviewGatewayError(403, 'PREVIEW_SESSION_MISMATCH', '预览会话标识与请求不一致。')
  }

  return {
    publicContext: {
      sessionId: payload.session_id,
      tenantId: String(payload.tenant_id),
      projectId: String(payload.project_id),
      releaseId: String(payload.release_id),
      entryRoute: String(payload.entry_route),
      assetBaseUrl: String(payload.asset_base_url),
      traceId: String(payload.trace_id),
    }
  }
}

/**
 * 生成预览页 HTML，并注入公开上下文与预加载配置。
 * @param params HTML 参数
 * @returns HTML 文本
 */
function buildPreviewHtml(params: {
  basePath: string
  publicContext: RuntimePreviewContext
  configBundle: RuntimePreloadedConfigBundle
}): string {
  const viteClientPath = `${params.basePath || ''}/@vite/client`
  const mainEntryPath = `${params.basePath || ''}/src/main.ts`
  const serializedContext = JSON.stringify(params.publicContext)
  const serializedConfig = JSON.stringify(params.configBundle)

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Runtime Preview</title>
    <style>
      html, body, #app { margin: 0; width: 100%; height: 100%; background: #f8fafc; }
      body { overflow: hidden; font-family: "Segoe UI", "PingFang SC", sans-serif; }
    </style>
    <script>
      window.__RUNTIME_PREVIEW_CONTEXT__ = ${serializedContext};
      window.__RUNTIME_PRELOADED_CONFIG__ = ${serializedConfig};
    </script>
    <script type="module" src="${viteClientPath}"></script>
    <script type="module" src="${mainEntryPath}"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`
}

/**
 * 输出 HTML 响应。
 * @param res Node 响应对象
 * @param html HTML 内容
 */
function sendHtml(res: any, html: string): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(html)
}

/**
 * 输出统一预览错误响应。
 * @param res Node 响应对象
 * @param error 错误对象
 */
function sendPreviewError(res: any, error: unknown): void {
  const previewError = error instanceof PreviewGatewayError
    ? error
    : new PreviewGatewayError(500, 'PREVIEW_GATEWAY_ERROR', error instanceof Error ? error.message : '预览网关异常。')

  res.statusCode = previewError.statusCode
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Runtime Preview Error</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: #f8fafc; font-family: "Segoe UI", "PingFang SC", sans-serif; }
      body { display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; }
      .card { max-width: 760px; width: 100%; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08); }
      .title { margin: 0 0 12px; font-size: 28px; color: #0f172a; }
      .desc { margin: 0 0 20px; color: #475569; line-height: 1.7; }
      .meta { display: grid; gap: 10px; padding: 16px; background: #f8fafc; border-radius: 12px; color: #334155; }
      .code { color: #b91c1c; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 class="title">整项目预览启动失败</h1>
      <p class="desc">请联系 Backend 或平台团队检查预览上下文 JWS、发布产物清单以及 Runtime 到 Backend 的内部接口连通性。</p>
      <div class="meta">
        <div><span class="code">HTTP ${previewError.statusCode}</span></div>
        <div>错误码：${escapeHtml(previewError.code)}</div>
        <div>错误信息：${escapeHtml(previewError.message)}</div>
      </div>
    </div>
  </body>
</html>`)
}

/**
 * 转义 HTML 文本，避免错误详情破坏页面结构。
 * @param value 原始文本
 * @returns 转义后的文本
 */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
