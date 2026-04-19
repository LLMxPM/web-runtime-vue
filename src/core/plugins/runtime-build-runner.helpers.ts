/**
 * 文件用途：提供 Runtime 整包构建插件复用的 baseUrl 与静态资源路径辅助函数。
 */

import { extname } from 'path'

const ROOT_ABSOLUTE_ASSET_PATTERNS = [
  /url\((['"]?)\/(?:img|fonts|favicon)/i,
  /(?:src|href)=['"]\/(?:img|fonts|favicon)/i,
  /\b(?:src|href)\s*:\s*['"]\/(?:img|fonts|favicon)/i,
  /[:=]\s*['"]\/(?:img|fonts|favicon)/i,
]

/**
 * 规范化整项目构建使用的部署基路径。
 * @param rawBaseUrl 用户输入或请求体中的原始 baseUrl
 * @returns 规范化后的 baseUrl
 */
export function normalizeBuildBaseUrl(rawBaseUrl: string | undefined | null): string {
  const normalized = String(rawBaseUrl || '').trim()
  if (!normalized || normalized === '.' || normalized === './') {
    return './'
  }

  if (/^https?:\/\//i.test(normalized) || normalized.startsWith('//')) {
    throw new Error('base_url 不能是完整 URL 或双斜杠路径。')
  }

  if (!normalized.startsWith('/')) {
    throw new Error('base_url 仅支持 ./ 或以 / 开头。')
  }

  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

/**
 * 根据资源哈希与原始文件名生成静态构建产物中的资源路径。
 * @param fileHash Backend 下发的资源 hash
 * @param originalName 原始文件名
 * @param logicalName 逻辑资源名
 * @returns 静态资源相对路径
 */
export function buildStaticAssetPath(fileHash: string, originalName?: string, logicalName?: string): string {
  const normalizedHash = String(fileHash || '').trim()
  if (!normalizedHash) {
    throw new Error('缺少资源 hash，无法生成静态资源路径。')
  }

  const extension = extname(String(originalName || '').trim() || String(logicalName || '').trim())
  return `__build_assets/${normalizedHash}${extension || ''}`
}

/**
 * 判断源码文本中是否存在根绝对静态资源引用。
 * 关键约束：
 * 1. 仅检查真实源码，不把注释中的示例路径视为违规；
 * 2. 仅拦截 `/img`、`/fonts`、`/favicon` 这类站点根路径资源；
 * 3. 远程 URL 与相对路径不在此校验范围内。
 * @param content 待检查源码文本
 * @returns 是否命中非法根绝对静态资源引用
 */
export function hasForbiddenRootAbsoluteAssetPath(content: string): boolean {
  const sanitizedContent = stripInspectableComments(content)
  return ROOT_ABSOLUTE_ASSET_PATTERNS.some(pattern => pattern.test(sanitizedContent))
}

/**
 * 移除源码中的常见注释，避免示例代码触发根绝对路径误报。
 * @param content 原始源码文本
 * @returns 去除注释后的源码文本
 */
export function stripInspectableComments(content: string): string {
  return String(content || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}
