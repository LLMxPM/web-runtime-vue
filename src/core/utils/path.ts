/**
 * 文件用途：统一处理运行时配置地址、资源路径和站内导航路径。
 */

export type ConfigFileName = 'app' | 'routes' | 'themes' | 'icons'

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
 * 构建配置文件 URL。
 * @param configName 配置名称
 * @returns 配置文件的最终加载地址
 */
export function buildConfigUrl(configName: ConfigFileName): string {
  const configBaseUrl = import.meta.env.VITE_CONFIG_BASE_URL?.trim()
  const fileName = `${configName}.config.yaml`

  if (configBaseUrl) {
    return `${configBaseUrl.replace(/\/+$/, '')}/${fileName}`
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

  return normalizeRelativePath(resourcePath)
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
