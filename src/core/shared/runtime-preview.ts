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

export interface RuntimeModuleResolverConfig {
  remote_component_prefix?: string
  public_local_prefixes?: string[]
}

export interface RuntimePreloadedConfigBundle {
  app?: unknown
  routes?: unknown
  icons?: unknown
  themes?: unknown
  fonts?: RuntimeFontBundle
  manifest?: RuntimeReleaseManifest
  module_resolver?: RuntimeModuleResolverConfig
}

export const RUNTIME_REMOTE_MODULE_PREFIX = '/@runtime-release'

const BUILTIN_LOCAL_VIEW_PREFIXES = [
  'src/views/defaultpage/',
]

const DEFAULT_RUNTIME_PUBLIC_LOCAL_PREFIXES = [
  'src/components/',
  'src/layouts/',
  'src/core/',
  'src/styles/',
]

/**
 * 规范化视图模块逻辑路径，统一转为 `src/views/...` 形式。
 * @param rawPath 原始组件路径
 * @returns 规范化后的逻辑路径
 */
export function normalizeViewModulePath(rawPath: string): string {
  return normalizeRuntimeModulePath(rawPath)
}

/**
 * 规范化运行时模块逻辑路径，统一转为 `src/...` 形式。
 * @param rawPath 原始模块路径
 * @returns 规范化后的逻辑路径
 */
export function normalizeRuntimeModulePath(rawPath: string): string {
  const normalized = String(rawPath || '').trim().replace(/\\/g, '/')
  if (!normalized) {
    return ''
  }
  const remoteComponentPath = parseWorkspaceComponentImportPath(normalized)
  if (remoteComponentPath) {
    return remoteComponentPath
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
  if (normalized.startsWith('workspace-components/')) {
    return normalizeWorkspaceComponentPath(`src/${normalized}`)
  }
  if (normalized.startsWith('/workspace-components/')) {
    return normalizeWorkspaceComponentPath(`src${normalized}`)
  }
  return normalized.replace(/^\/+/, '')
}

/**
 * 解析单页面预览入口对应的页面模块路径。
 * @param entryRoute 预览入口声明，可能是路由路径或页面模块路径
 * @returns 页面模块逻辑路径；非直接页面模块预览时返回空串
 */
export function resolvePreviewEntryModulePath(entryRoute: string): string {
  const normalizedPath = normalizeRuntimeModulePath(entryRoute)
  if (!normalizedPath.startsWith('src/views/') || !normalizedPath.endsWith('.vue')) {
    return ''
  }
  return normalizedPath
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
 * 判断模块是否属于 Runtime 对远程模块开放的本地公共模块。
 * @param normalizedPath 已规范化的模块路径
 * @returns 是否为 Runtime 本地公共模块
 */
export function isRuntimeLocalPublicModulePath(normalizedPath: string): boolean {
  return DEFAULT_RUNTIME_PUBLIC_LOCAL_PREFIXES.some(prefix => normalizedPath.startsWith(prefix))
}

/**
 * 将 `src/views/...` 路径转为 `@/views/...` 别名形式。
 * @param normalizedPath 规范化后的逻辑路径
 * @returns 别名路径
 */
export function toAliasViewPath(normalizedPath: string): string {
  return toAliasModulePath(normalizedPath)
}

/**
 * 将 `src/...` 路径转为运行时可理解的别名形式。
 * @param normalizedPath 规范化后的逻辑路径
 * @returns 别名路径
 */
export function toAliasModulePath(normalizedPath: string): string {
  if (!normalizedPath) {
    return normalizedPath
  }
  if (normalizedPath.startsWith('src/workspace-components/')) {
    return toWorkspaceComponentAliasPath(normalizedPath)
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
  const normalizedPath = normalizeRuntimeModulePath(modulePath)
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
  const modulePath = normalizeRuntimeModulePath(searchParams.get('path') || '')
  if (!sessionId || !releaseId || !modulePath) {
    return null
  }

  return { sessionId, releaseId, modulePath }
}

/**
 * 判断当前远程模块请求是否命中了单页面预览入口页。
 * @param modulePath 本次请求的远程模块逻辑路径
 * @param previewEntryRoute 预览上下文中的入口声明
 * @returns 是否为入口页模块请求
 */
export function isPreviewEntryModuleRequest(modulePath: string, previewEntryRoute: string): boolean {
  const normalizedModulePath = normalizeRuntimeModulePath(modulePath)
  const previewEntryModulePath = resolvePreviewEntryModulePath(previewEntryRoute)
  return Boolean(normalizedModulePath && previewEntryModulePath && normalizedModulePath === previewEntryModulePath)
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

/**
 * 解析工作空间组件导入别名。
 * @param rawPath 原始导入路径
 * @returns 对应的逻辑模块路径；未命中时返回 null
 */
function parseWorkspaceComponentImportPath(rawPath: string): string | null {
  const normalized = String(rawPath || '').trim().replace(/\\/g, '/')
  const match = normalized.match(/^@workspace-components\/([^/]+)\/v\/(\d+)(?:\.vue)?$/)
  if (!match) {
    return null
  }
  return `src/workspace-components/${match[1]}/v/${match[2]}.vue`
}

/**
 * 规范化工作空间组件逻辑路径，补齐 `.vue` 后缀。
 * @param normalizedPath 逻辑路径
 * @returns 标准化后的路径
 */
function normalizeWorkspaceComponentPath(normalizedPath: string): string {
  const trimmedPath = normalizedPath.replace(/^\/+/, '')
  return trimmedPath.endsWith('.vue') ? trimmedPath : `${trimmedPath}.vue`
}

/**
 * 将工作空间组件逻辑路径转回约定别名。
 * @param normalizedPath 标准化后的组件路径
 * @returns 组件别名路径
 */
function toWorkspaceComponentAliasPath(normalizedPath: string): string {
  const match = normalizedPath.match(/^src\/workspace-components\/([^/]+)\/v\/(\d+)(?:\.vue)?$/)
  if (!match) {
    return `@/${normalizedPath.replace(/^src\//, '')}`
  }
  return `@workspace-components/${match[1]}/v/${match[2]}`
}
