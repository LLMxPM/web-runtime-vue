/**
 * 文件用途：根据 Backend 下发的预加载字体配置动态注册 @font-face，并提供主题字体引用解析。
 */

import type { RuntimeFontBundleItem } from '@/core/shared/runtime-preview'

import { getRuntimePreloadedConfig, resolveResourcePath } from './path'

const RUNTIME_FONT_STYLE_ID = 'runtime-dynamic-fonts'

/**
 * 读取运行时预加载字体配置。
 * @returns 字体配置表；没有预加载配置时返回空对象
 */
function getRuntimeFontItems(): Record<string, RuntimeFontBundleItem> {
  return getRuntimePreloadedConfig()?.fonts?.items ?? {}
}

/**
 * 将主题中的字体引用解析为真实 font-family。
 * 优先按 asset_name 命中，其次兼容历史 font_family 直接匹配。
 * @param rawReference 主题中的原始字体引用
 * @returns 可直接写入 CSS 的 font-family
 */
export function resolveThemeFontFamily(rawReference: string): string {
  const normalizedReference = String(rawReference || '').trim()
  if (!normalizedReference) {
    return normalizedReference
  }

  const fontItems = getRuntimeFontItems()
  const byAssetName = fontItems[normalizedReference]
  if (byAssetName) {
    return byAssetName.font_family
  }

  const matchedByFamily = Object.values(fontItems).find(item => item.font_family === normalizedReference)
  return matchedByFamily?.font_family ?? normalizedReference
}

/**
 * 启动时根据预加载字体配置注册动态 @font-face。
 * @returns 已写入的 CSS 文本
 */
export function initializeRuntimeFontRegistry(): string {
  if (typeof document === 'undefined') {
    return ''
  }

  const fontItems = Object.values(getRuntimeFontItems())
  let styleElement = document.getElementById(RUNTIME_FONT_STYLE_ID) as HTMLStyleElement | null

  if (!fontItems.length) {
    styleElement?.remove()
    return ''
  }

  if (!styleElement) {
    styleElement = document.createElement('style')
    styleElement.id = RUNTIME_FONT_STYLE_ID
    document.head.appendChild(styleElement)
  }

  const cssText = fontItems
    .map(item => buildFontFaceRule(item))
    .filter(Boolean)
    .join('\n')

  styleElement.textContent = cssText
  return cssText
}

/**
 * 生成单条 @font-face 规则。
 * @param item 字体配置项
 * @returns CSS 规则文本
 */
function buildFontFaceRule(item: RuntimeFontBundleItem): string {
  const fontUrl = resolveResourcePath(item.asset_name)
  if (!fontUrl) {
    return ''
  }

  const escapedFamily = escapeCssString(item.font_family)
  const escapedUrl = fontUrl.replace(/'/g, "\\'")
  return [
    '@font-face {',
    `  font-family: '${escapedFamily}';`,
    `  src: url('${escapedUrl}') format('${item.font_format}');`,
    `  font-weight: ${item.font_weight};`,
    `  font-style: ${item.font_style};`,
    `  font-display: ${item.font_display};`,
    '}',
  ].join('\n')
}

/**
 * 转义 CSS 字符串中的单引号。
 * @param value 原始文本
 * @returns 转义后的文本
 */
function escapeCssString(value: string): string {
  return String(value || '').replace(/'/g, "\\'")
}
