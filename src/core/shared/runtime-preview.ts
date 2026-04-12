/**
 * 文件用途：定义 SaaS 预览运行时共享契约、远程模块标识与资源路径解析辅助函数。
 */

export interface RuntimePreviewContext {
  sessionId: string
  tenantId: string
  projectId: string
  releaseId: string
  entryRoute: string
  assetBaseUrl: string
  traceId: string
}

export interface RuntimeReleaseManifestModule {
  path?: string
  hash?: string
}

export interface RuntimeReleaseManifest {
  release_id: string
  tenant_id: string
  project_id: string
  entry_route: string
  modules: Record<string, string | RuntimeReleaseManifestModule>
  assets: Record<string, string>
  version?: string
  published_at?: string
}

export interface RuntimeFontBundleItem {
  asset_name: string
  font_family: string
  font_format: string
  font_weight: string
  font_style: string
  font_display: string
}

export interface RuntimeFontBundle {
  items: Record<string, RuntimeFontBundleItem>
}

export interface RuntimePreloadedConfigBundle {
  app?: unknown
  routes?: unknown
  icons?: unknown
  themes?: unknown
  fonts?: RuntimeFontBundle
  manifest?: RuntimeReleaseManifest
}

export const RUNTIME_REMOTE_MODULE_PREFIX = '/@runtime-release'

const BUILTIN_LOCAL_VIEW_PREFIXES = [
  'src/views/defaultpage/',
]

/**
 * 规范化视图模块逻辑路径，统一转为 `src/views/...` 形式。
 * @param rawPath 原始组件路径
 * @returns 规范化后的逻辑路径
 */
export function normalizeViewModulePath(rawPath: string): string {
  const normalized = String(rawPath || '').trim().replace(/\\/g, '/')
  if (!normalized) {
    return ''
  }
  if (normalized.startsWith('@/')) {
    return normalized.replace('@/', 'src/')
  }
  if (normalized.startsWith('/src/')) {
    return normalized.slice(1)
  }
  if (normalized.startsWith('src/')) {
    return normalized
  }
  if (normalized.startsWith('views/')) {
    return `src/${normalized}`
  }
  if (normalized.startsWith('/views/')) {
    return `src${normalized}`
  }
  return normalized.replace(/^\/+/, '')
}

/**
 * 判断视图模块是否属于 Runtime 本地内建页面。
 * @param normalizedPath 已规范化的视图逻辑路径
 * @returns 是否为本地内建视图
 */
export function isBuiltinLocalViewPath(normalizedPath: string): boolean {
  return BUILTIN_LOCAL_VIEW_PREFIXES.some(prefix => normalizedPath.startsWith(prefix))
}

/**
 * 将 `src/views/...` 路径转为 `@/views/...` 别名形式。
 * @param normalizedPath 规范化后的逻辑路径
 * @returns 别名路径
 */
export function toAliasViewPath(normalizedPath: string): string {
  if (!normalizedPath) {
    return normalizedPath
  }
  if (normalizedPath.startsWith('@/')) {
    return normalizedPath
  }
  if (normalizedPath.startsWith('src/')) {
    return normalizedPath.replace(/^src\//, '@/')
  }
  return `@/${normalizedPath.replace(/^\/+/, '')}`
}

/**
 * 构建浏览器侧可直接动态导入的远程模块标识。
 * @param sessionId 预览会话 ID
 * @param releaseId 发布版本 ID
 * @param modulePath 视图逻辑路径
 * @returns 远程模块 ID
 */
export function buildRemoteModuleId(sessionId: string, releaseId: string, modulePath: string): string {
  const normalizedPath = normalizeViewModulePath(modulePath)
  const fileName = normalizedPath.split('/').filter(Boolean).pop() || 'remote-module.vue'
  const safeFileName = fileName.endsWith('.vue') ? fileName : `${fileName}.vue`
  return `${RUNTIME_REMOTE_MODULE_PREFIX}/${encodeURIComponent(sessionId)}/${encodeURIComponent(releaseId)}/${safeFileName}?path=${encodeURIComponent(normalizedPath)}`
}

/**
 * 解析远程模块 ID。
 * @param id 模块 ID
 * @returns 解析结果，非远程模块时返回 null
 */
export function parseRemoteModuleId(id: string): { sessionId: string; releaseId: string; modulePath: string } | null {
  if (!id.startsWith(RUNTIME_REMOTE_MODULE_PREFIX)) {
    return null
  }

  const [pathPart, queryPart = ''] = id.split('?', 2)
  const segments = pathPart.split('/').filter(Boolean)
  if (segments.length < 4) {
    return null
  }

  const sessionId = decodeURIComponent(segments[1] || '')
  const releaseId = decodeURIComponent(segments[2] || '')
  const searchParams = new URLSearchParams(queryPart)
  const modulePath = normalizeViewModulePath(searchParams.get('path') || '')
  if (!sessionId || !releaseId || !modulePath) {
    return null
  }

  return { sessionId, releaseId, modulePath }
}

/**
 * 将资源路径规范化为发布产物索引 key。
 * @param rawPath 原始资源路径
 * @returns 规范化 key
 */
export function normalizeAssetKey(rawPath: string): string {
  return String(rawPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\/*/, '')
}
