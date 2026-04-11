/**
 * 文件用途：统一处理运行时配置来源、预览上下文、资源路径和站内导航路径。
 */

import type {
  RuntimePreloadedConfigBundle,
  RuntimePreviewContext,
} from '@/core/shared/runtime-preview'
import { normalizeAssetKey } from '@/core/shared/runtime-preview'

export type ConfigFileName = 'app' | 'routes' | 'themes' | 'icons'

export interface RuntimeConfigContext {
  projectId?: number
  projectConfigBaseUrl?: string
}

/**
 * 判断是否为远程绝对地址。
 * @param value 待判断的路径
 * @returns 是否为 http/https 地址
 */
export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/**
 * 规范化相对资源路径。
 * @param value 原始路径
 * @returns 以 ./ 开头的相对路径
 */
function normalizeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.?\/*/, '')
  if (!normalized) {
    return './'
  }

  return `./${normalized}`
}

/**
 * 读取浏览器侧注入的运行时配置上下文。
 * @returns 运行时配置上下文；非浏览器环境返回 undefined
 */
export function getRuntimeConfigContext(): RuntimeConfigContext | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return window.__RUNTIME_CONFIG_CONTEXT__
}

/**
 * 在浏览器侧写入运行时配置上下文，供本地只读 fixture 或测试场景覆盖配置来源。
 * @param context 运行时配置上下文；传空则清理
 */
export function setRuntimeConfigContext(context?: RuntimeConfigContext): void {
  if (typeof window === 'undefined') {
    return
  }

  if (!context) {
    delete window.__RUNTIME_CONFIG_CONTEXT__
    return
  }

  window.__RUNTIME_CONFIG_CONTEXT__ = context
}

/**
 * 读取浏览器侧注入的公开预览上下文。
 * @returns 公开预览上下文；非预览模式返回 undefined
 */
export function getRuntimePreviewContext(): RuntimePreviewContext | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return window.__RUNTIME_PREVIEW_CONTEXT__
}

/**
 * 写入公开预览上下文，仅供测试或受控入口注入。
 * @param context 公开预览上下文；传空则清理
 */
export function setRuntimePreviewContext(context?: RuntimePreviewContext): void {
  if (typeof window === 'undefined') {
    return
  }
  if (!context) {
    delete window.__RUNTIME_PREVIEW_CONTEXT__
    return
  }
  window.__RUNTIME_PREVIEW_CONTEXT__ = context
}

/**
 * 读取浏览器侧注入的预加载配置包。
 * @returns 预加载配置；非预览模式返回 undefined
 */
export function getRuntimePreloadedConfig(): RuntimePreloadedConfigBundle | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return window.__RUNTIME_PRELOADED_CONFIG__
}

/**
 * 写入预加载配置包，仅供测试或受控入口注入。
 * @param config 预加载配置包；传空则清理
 */
export function setRuntimePreloadedConfig(config?: RuntimePreloadedConfigBundle): void {
  if (typeof window === 'undefined') {
    return
  }
  if (!config) {
    delete window.__RUNTIME_PRELOADED_CONFIG__
    return
  }
  window.__RUNTIME_PRELOADED_CONFIG__ = config
}

/**
 * 解析当前有效的外部配置根地址。
 * v1 仅保留 window 注入的受控地址，用于只读 fixture 或测试覆盖。
 * @returns 外部配置根地址；未配置时返回空串
 */
export function resolveExternalConfigBaseUrl(): string {
  const runtimeBaseUrl = getRuntimeConfigContext()?.projectConfigBaseUrl?.trim()
  if (runtimeBaseUrl) {
    return runtimeBaseUrl.replace(/\/+$/, '')
  }
  return ''
}

/**
 * 判断当前是否使用外部配置源。
 * @returns 是否存在远程或注入的配置根地址
 */
export function hasExternalConfigSource(): boolean {
  return resolveExternalConfigBaseUrl().length > 0
}

/**
 * 构建配置文件 URL。
 * @param configName 配置名称
 * @returns 配置文件的最终加载地址
 */
export function buildConfigUrl(configName: ConfigFileName): string {
  const configBaseUrl = resolveExternalConfigBaseUrl()
  const fileName = `${configName}.config.yaml`

  if (configBaseUrl) {
    return `${configBaseUrl}/${fileName}`
  }

  return `./config/${fileName}`
}

/**
 * 构建完整路径 - 用于菜单和导航
 * @param path 路由路径（相对或绝对）
 * @returns 完整路径（绝对）
 */
export function buildFullPath(path: string): string {
  if (!path || path === '') return '/'
  
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return cleanPath
}

/**
 * 解析资源路径
 * @param resourcePath 资源路径
 * @returns 解析后的完整路径
 */
export function resolveResourcePath(resourcePath: string): string {
  if (!resourcePath) {
    return './'
  }

  // 如果是绝对HTTP路径，直接返回
  if (isRemoteUrl(resourcePath)) {
    return resourcePath
  }

  const normalizedAssetKey = normalizeAssetKey(resourcePath)
  const preloadedConfig = getRuntimePreloadedConfig()
  const previewContext = getRuntimePreviewContext()
  const assetMapping = preloadedConfig?.manifest?.assets || {}
  const mappedAssetPath = assetMapping[normalizedAssetKey]
  if (mappedAssetPath) {
    return isRemoteUrl(mappedAssetPath)
      ? mappedAssetPath
      : joinUrlPath(previewContext?.assetBaseUrl || '', mappedAssetPath)
  }

  if (previewContext?.assetBaseUrl) {
    return joinUrlPath(previewContext.assetBaseUrl, normalizedAssetKey)
  }

  return normalizeRelativePath(resourcePath)
}

/**
 * 获取预览模式的初始路由。
 * @returns 入口路由；无预览上下文时返回空串
 */
export function getPreviewEntryRoute(): string {
  return String(getRuntimePreviewContext()?.entryRoute || '').trim()
}

/**
 * 规范化路径
 * @param path 路径
 * @returns 规范化后的路径
 */
export function normalizePath(path: string): string {
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

/**
 * 连接路径片段
 * @param paths 路径片段
 * @returns 连接后的路径
 */
export function joinPaths(...paths: string[]): string {
  return normalizePath(paths.filter(Boolean).join('/'))
}

/**
 * 拼接 URL 基地址与资源路径，避免出现重复斜杠。
 * @param baseUrl 基地址
 * @param resourcePath 资源路径
 * @returns 拼接后的 URL
 */
function joinUrlPath(baseUrl: string, resourcePath: string): string {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '')
  const normalizedResource = normalizeAssetKey(resourcePath)
  if (!normalizedBase) {
    return `./${normalizedResource}`
  }
  if (!normalizedResource) {
    return normalizedBase
  }
  return `${normalizedBase}/${normalizedResource}`
}
