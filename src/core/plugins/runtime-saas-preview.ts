/**
 * 文件用途：提供无状态预览入口、PreviewContextToken 验签、artifact 预加载与远程虚拟模块解析能力。
 */

import { posix } from 'path'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { Plugin, ViteDevServer } from 'vite'

import {
  buildRemoteModuleId,
  isPreviewEntryModuleRequest,
  isBuiltinLocalViewPath,
  isRuntimeLocalPublicModulePath,
  normalizeRuntimeModulePath,
  parseRemoteModuleId,
  type ComponentPreviewMode,
  type PreviewKind,
  type PreviewScopeType,
  type RuntimePreloadedConfigBundle,
  type RuntimePreviewArtifactManifest,
  type RuntimePreviewContext,
  type RuntimePreviewEntryDescriptor,
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
  artifact_id: string
  preview_kind: PreviewKind
  scope_type: PreviewScopeType
  workspace_id: string
  project_id?: string
  entry_descriptor: RuntimePreviewEntryDescriptor
  asset_base_url: string
  trace_id: string
  component_preview_mode?: ComponentPreviewMode
  component_code?: string
  component_version_no?: number
  jti: string
}

const DEFAULT_PREVIEW_PATH = '/__preview'
const DEFAULT_PREVIEW_HEADER = 'x-runtime-preview-context'
const DEFAULT_PREVIEW_AUDIENCE = 'runtime-preview'
const DISALLOWED_REMOTE_IMPORT_PREFIX = '\0runtime-preview-disallowed:'

/**
 * 无状态 SaaS 预览插件：
 * 1. 仅在 Vite serve 下生效；
 * 2. 对 HTML 入口执行 PreviewContextToken 验签与 artifact 预加载；
 * 3. 远程模块加载只依赖 `artifactId + ctx token`；
 * 4. 不再通过 Backend 恢复 preview session。
 */
export default function runtimeSaaSPreview(options: RuntimeSaaSPreviewOptions = {}): Plugin {
  const previewPath = options.previewPath || DEFAULT_PREVIEW_PATH
  const previewHeaderName = (options.previewHeaderName || DEFAULT_PREVIEW_HEADER).toLowerCase()
  const manifestCache = new Map<string, RuntimePreviewArtifactManifest>()
  const previewTokenCache = new Map<string, string>()
  let basePath = ''
  let assetBase = ''

  return {
    name: 'runtime-saas-preview',
    apply: 'serve',

    configResolved(resolvedConfig) {
      basePath = normalizeBasePath(resolvedConfig.base)
      assetBase = resolvedConfig.server?.origin ? resolvedConfig.server.origin + basePath : basePath
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
          previewTokenCache.set(verified.publicContext.artifactId, previewToken)

          const backendClient = createBackendClient({
            backendApiBaseUrl: options.backendApiBaseUrl || process.env.RUNTIME_BACKEND_API_BASE_URL || '',
            serviceJwt: options.serviceJwt || process.env.RUNTIME_SERVICE_JWT || '',
            serviceTokenAudience: options.serviceTokenAudience || process.env.RUNTIME_SERVICE_TOKEN_AUDIENCE || '',
            previewToken,
          })

          const [manifest, configBundle] = await Promise.all([
            fetchArtifactManifest(verified.publicContext.artifactId, backendClient, manifestCache),
            backendClient.fetchConfigBundle(verified.publicContext.artifactId),
          ])

          assertManifestMatchesContext(manifest, verified.publicContext)

          sendHtml(res, buildPreviewHtml({
            assetBase,
            publicContext: verified.publicContext,
            previewToken,
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
      if (source.startsWith(DISALLOWED_REMOTE_IMPORT_PREFIX)) {
        return source
      }
      if (parseRemoteModuleId(source)) {
        return source
      }

      const importerInfo = importer ? parseRemoteModuleId(importer) : null
      if (!importerInfo) {
        return null
      }

      const resolveResult = resolveRemoteModuleImport(source, importerInfo.modulePath)
      if (resolveResult.type === 'ignore') {
        return null
      }
      if (resolveResult.type === 'disallowed') {
        return `${DISALLOWED_REMOTE_IMPORT_PREFIX}${encodeURIComponent(resolveResult.source)}`
      }
      const resolvedModulePath = resolveResult.modulePath
      if (!resolvedModulePath || isBuiltinLocalViewPath(resolvedModulePath) || isRuntimeLocalPublicModulePath(resolvedModulePath)) {
        return null
      }

      return buildRemoteModuleId(importerInfo.artifactId, resolvedModulePath, importerInfo.previewToken)
    },

    async load(id) {
      if (id.startsWith(DISALLOWED_REMOTE_IMPORT_PREFIX)) {
        const rawSource = decodeURIComponent(id.slice(DISALLOWED_REMOTE_IMPORT_PREFIX.length))
        throw new PreviewGatewayError(
          403,
          'RUNTIME_LOCAL_IMPORT_FORBIDDEN',
          `远程模块引用了未开放的 Runtime 本地模块：${rawSource}`,
        )
      }

      const parsed = parseRemoteModuleId(id)
      if (!parsed) {
        return null
      }
      const effectivePreviewToken = parsed.previewToken || previewTokenCache.get(parsed.artifactId) || ''
      if (!effectivePreviewToken) {
        throw new PreviewGatewayError(401, 'PREVIEW_CONTEXT_REQUIRED', '远程模块请求缺少预览上下文令牌。')
      }

      const verified = await verifyPreviewToken(effectivePreviewToken, {
        jwksUrl: options.jwksUrl || process.env.RUNTIME_PREVIEW_JWKS_URL || '',
        audience: options.previewAudience || process.env.RUNTIME_PREVIEW_TOKEN_AUDIENCE || DEFAULT_PREVIEW_AUDIENCE,
      })
      if (verified.publicContext.artifactId !== parsed.artifactId) {
        throw new PreviewGatewayError(403, 'ARTIFACT_MISMATCH', '预览 artifact 与远程模块请求不一致。')
      }
      previewTokenCache.set(parsed.artifactId, effectivePreviewToken)

      const backendClient = createBackendClient({
        backendApiBaseUrl: options.backendApiBaseUrl || process.env.RUNTIME_BACKEND_API_BASE_URL || '',
        serviceJwt: options.serviceJwt || process.env.RUNTIME_SERVICE_JWT || '',
        serviceTokenAudience: options.serviceTokenAudience || process.env.RUNTIME_SERVICE_TOKEN_AUDIENCE || '',
        previewToken: effectivePreviewToken,
      })

      const manifest = await fetchArtifactManifest(parsed.artifactId, backendClient, manifestCache)
      assertManifestMatchesContext(manifest, verified.publicContext)

      const manifestEntry = manifest.modules[parsed.modulePath]
      if (!manifestEntry && !isPreviewEntryModuleRequest(parsed.modulePath, verified.publicContext.entryDescriptor)) {
        throw new PreviewGatewayError(404, 'MODULE_NOT_ALLOWED', `模块未包含在发布白名单中：${parsed.modulePath}`)
      }

      return backendClient.fetchModuleSource(parsed.artifactId, parsed.modulePath)
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
function resolveRemoteModuleImport(
  source: string,
  importerPath: string,
): { type: 'remote'; modulePath: string } | { type: 'ignore' } | { type: 'disallowed'; source: string } {
  const normalizedSource = String(source || '').trim().replace(/\\/g, '/')
  if (!normalizedSource) {
    return { type: 'ignore' }
  }

  if (normalizedSource.startsWith('@workspace-components/')) {
    return { type: 'remote', modulePath: normalizeRuntimeModulePath(normalizedSource) }
  }

  if (
    normalizedSource.startsWith('@/views/')
    || normalizedSource.startsWith('/src/views/')
    || normalizedSource.startsWith('src/views/')
    || normalizedSource.startsWith('views/')
  ) {
    return { type: 'remote', modulePath: normalizeRuntimeModulePath(normalizedSource) }
  }

  if (normalizedSource.startsWith('@/')) {
    const normalizedModulePath = normalizeRuntimeModulePath(normalizedSource)
    if (isRuntimeLocalPublicModulePath(normalizedModulePath) || isBuiltinLocalViewPath(normalizedModulePath)) {
      return { type: 'ignore' }
    }
    return { type: 'disallowed', source: normalizedSource }
  }

  if (normalizedSource.startsWith('./') || normalizedSource.startsWith('../')) {
    const importerDir = posix.dirname(importerPath)
    const normalizedModulePath = normalizeRuntimeModulePath(posix.normalize(posix.join(importerDir, normalizedSource)))
    if (!normalizedModulePath) {
      return { type: 'ignore' }
    }
    if (isRuntimeLocalPublicModulePath(normalizedModulePath) || isBuiltinLocalViewPath(normalizedModulePath)) {
      return { type: 'ignore' }
    }
    if (normalizedModulePath.startsWith('src/views/') || normalizedModulePath.startsWith('src/workspace-components/')) {
      return { type: 'remote', modulePath: normalizedModulePath }
    }
    return { type: 'ignore' }
  }

  return { type: 'ignore' }
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
 * 校验 PreviewContextToken，并构造可公开注入浏览器的上下文。
 * @param token JWS 令牌
 * @param options 校验选项
 * @returns 校验后的结果
 */
async function verifyPreviewToken(token: string, options: { jwksUrl: string; audience: string }): Promise<{
  publicContext: RuntimePreviewContext
}> {
  if (!options.jwksUrl) {
    throw new PreviewGatewayError(503, 'JWKS_URL_MISSING', 'Runtime 未配置预览 JWKS 地址。')
  }

  const jwks = createRemoteJWKSet(new URL(options.jwksUrl))
  const { payload } = await jwtVerify(token, jwks, {
    audience: options.audience,
  })

  const claims = payload as PreviewTokenClaims
  if (
    !claims.jti
    || !claims.tenant_id
    || !claims.artifact_id
    || !claims.preview_kind
    || !claims.scope_type
    || !claims.workspace_id
    || !claims.entry_descriptor
    || !claims.asset_base_url
    || !claims.trace_id
  ) {
    throw new PreviewGatewayError(401, 'PREVIEW_CONTEXT_INVALID', '预览上下文缺少必填声明。')
  }

  const entryDescriptor = normalizeEntryDescriptor(claims.entry_descriptor)
  if (claims.scope_type === 'project' && !claims.project_id) {
    throw new PreviewGatewayError(401, 'PREVIEW_CONTEXT_INVALID', '项目级预览缺少 project_id。')
  }

  return {
    publicContext: {
      artifactId: String(claims.artifact_id),
      tenantId: String(claims.tenant_id),
      previewKind: claims.preview_kind,
      scopeType: claims.scope_type,
      workspaceId: String(claims.workspace_id),
      projectId: claims.project_id ? String(claims.project_id) : undefined,
      entryDescriptor,
      assetBaseUrl: String(claims.asset_base_url),
      traceId: String(claims.trace_id),
      componentPreviewMode: claims.component_preview_mode,
      componentCode: claims.component_code ? String(claims.component_code) : undefined,
      componentVersionNo: claims.component_version_no !== undefined ? Number(claims.component_version_no) : undefined,
    },
  }
}

/**
 * 规范化入口描述，避免非法 token 结构直接进入运行时。
 * @param value token 中的入口描述
 * @returns 规范化后的入口描述
 */
function normalizeEntryDescriptor(value: unknown): RuntimePreviewEntryDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PreviewGatewayError(401, 'PREVIEW_CONTEXT_INVALID', '预览入口描述格式非法。')
  }

  const source = value as Record<string, unknown>
  const entryType = String(source.entry_type || '')
  if (entryType === 'route') {
    const route = String(source.route || '').trim()
    if (!route) {
      throw new PreviewGatewayError(401, 'PREVIEW_CONTEXT_INVALID', 'route 预览缺少 route。')
    }
    return { entry_type: 'route', route }
  }
  if (entryType === 'module') {
    const modulePath = normalizeRuntimeModulePath(String(source.module_path || ''))
    if (!modulePath) {
      throw new PreviewGatewayError(401, 'PREVIEW_CONTEXT_INVALID', 'module 预览缺少 module_path。')
    }
    return { entry_type: 'module', module_path: modulePath }
  }
  if (entryType === 'component_host') {
    return { entry_type: 'component_host' }
  }
  throw new PreviewGatewayError(401, 'PREVIEW_CONTEXT_INVALID', '未知的预览入口类型。')
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
  if (options.serviceTokenAudience) {
    defaultHeaders['x-runtime-service-audience'] = options.serviceTokenAudience
  }

  return {
    async fetchManifest(artifactId: string): Promise<RuntimePreviewArtifactManifest> {
      return requestJson<RuntimePreviewArtifactManifest>(
        `${apiBaseUrl}/internal/runtime/preview-artifacts/${encodeURIComponent(artifactId)}/manifest`,
        defaultHeaders,
      )
    },

    async fetchConfigBundle(artifactId: string): Promise<RuntimePreloadedConfigBundle> {
      return requestJson<RuntimePreloadedConfigBundle>(
        `${apiBaseUrl}/internal/runtime/preview-artifacts/${encodeURIComponent(artifactId)}/config-bundle`,
        defaultHeaders,
      )
    },

    async fetchModuleSource(artifactId: string, modulePath: string): Promise<string> {
      const url = `${apiBaseUrl}/internal/runtime/preview-artifacts/${encodeURIComponent(artifactId)}/modules?path=${encodeURIComponent(modulePath)}`
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
 * @param manifest preview artifact manifest
 * @param previewContext 已校验的公开上下文
 */
function assertManifestMatchesContext(
  manifest: RuntimePreviewArtifactManifest,
  previewContext: RuntimePreviewContext,
): void {
  if (
    manifest.artifact_id !== previewContext.artifactId
    || manifest.tenant_id !== previewContext.tenantId
    || manifest.preview_kind !== previewContext.previewKind
    || manifest.owner_scope?.scope_type !== previewContext.scopeType
    || String(manifest.owner_scope?.workspace_id || '') !== previewContext.workspaceId
  ) {
    throw new PreviewGatewayError(403, 'MANIFEST_CONTEXT_MISMATCH', '预览清单与预览上下文不一致。')
  }

  if (previewContext.scopeType === 'project' && String(manifest.owner_scope?.project_id || '') !== String(previewContext.projectId || '')) {
    throw new PreviewGatewayError(403, 'MANIFEST_CONTEXT_MISMATCH', '项目级预览 project_id 不一致。')
  }

  if (!isEntryDescriptorEqual(manifest.entry_descriptor, previewContext.entryDescriptor)) {
    throw new PreviewGatewayError(403, 'MANIFEST_CONTEXT_MISMATCH', '预览入口描述与 artifact 清单不一致。')
  }
}

/**
 * 比较两个入口描述是否语义一致。
 * @param left 左侧入口描述
 * @param right 右侧入口描述
 * @returns 是否一致
 */
function isEntryDescriptorEqual(left: RuntimePreviewEntryDescriptor, right: RuntimePreviewEntryDescriptor): boolean {
  return (
    left.entry_type === right.entry_type
    && String(left.route || '') === String(right.route || '')
    && String(left.module_path || '') === String(right.module_path || '')
  )
}

/**
 * 按 artifact 读取清单，允许缓存不可变 manifest 以减少重复请求。
 * @param artifactId preview artifact ID
 * @param backendClient Backend 客户端
 * @param manifestCache manifest 缓存
 * @returns 预览清单
 */
async function fetchArtifactManifest(
  artifactId: string,
  backendClient: ReturnType<typeof createBackendClient>,
  manifestCache: Map<string, RuntimePreviewArtifactManifest>,
): Promise<RuntimePreviewArtifactManifest> {
  const cachedManifest = manifestCache.get(artifactId)
  if (cachedManifest) {
    return cachedManifest
  }

  const manifest = await backendClient.fetchManifest(artifactId)
  manifestCache.set(artifactId, manifest)
  return manifest
}

/**
 * 生成预览页 HTML，并注入公开上下文、预加载配置与 PreviewContextToken。
 * @param params HTML 参数
 * @returns HTML 文本
 */
function buildPreviewHtml(params: {
  assetBase: string
  publicContext: RuntimePreviewContext
  previewToken: string
  configBundle: RuntimePreloadedConfigBundle
}): string {
  const viteClientPath = `${params.assetBase || ''}/@vite/client`
  const mainEntryPath = `${params.assetBase || ''}/src/main.ts`
  const serializedContext = JSON.stringify(params.publicContext)
  const serializedToken = JSON.stringify(params.previewToken)
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
      window.__RUNTIME_PREVIEW_TOKEN__ = ${serializedToken};
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
      <h1 class="title">预览启动失败</h1>
      <p class="desc">请检查 PreviewContextToken、preview artifact 清单以及 Runtime 到 Backend 的内部接口连通性。</p>
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
