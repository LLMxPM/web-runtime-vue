/**
 * 文件用途：统一计算页面内容作用域的 Tailwind 字号与间距 CSS 变量。
 */

import type { CSSProperties } from 'vue'

import { DEFAULT_PAGE_CONFIG } from '@/core/utils/config'

const BASE_PAGE_WIDTH = 1920
const BASE_PAGE_HEIGHT = 1080

/**
 * 计算页面设计尺寸相对标准画布的排印缩放比例。
 * @param width 页面设计宽度
 * @param height 页面设计高度
 * @returns 可用于字号与间距基准的缩放比例
 */
export function resolvePageTypographyScale(width: number, height: number): number {
  const scaleX = width / BASE_PAGE_WIDTH
  const scaleY = height / BASE_PAGE_HEIGHT
  const scale = Math.min(scaleX, scaleY)

  if (!Number.isFinite(scale) || scale <= 0) {
    return 1
  }

  return Math.round(scale * 1000000) / 1000000
}

/**
 * 构造页面内容作用域的 Tailwind 缩放变量。
 * @param width 页面设计宽度
 * @param height 页面设计高度
 * @returns 可绑定到页面内容容器的 CSS 变量
 */
export function buildPageContentScaleStyles(width: number, height: number): CSSProperties {
  const typographyScale = resolvePageTypographyScale(width, height)

  return {
    '--runtime-page-typography-scale': String(typographyScale),
    '--tw-font-size-base': `calc(var(--theme-font-size-base, ${DEFAULT_PAGE_CONFIG.baseFontSize}) * ${typographyScale})`,
    ...buildPageSpacingScaleStyles(),
  } as CSSProperties
}

/**
 * 构造页面内容作用域的 Tailwind 间距变量。
 * @returns 可绑定到内容容器的间距 CSS 变量
 */
export function buildPageSpacingScaleStyles(): CSSProperties {
  return {
    '--tw-spacing-unit': 'calc(var(--tw-font-size-base) * 0.25)',
  } as CSSProperties
}
