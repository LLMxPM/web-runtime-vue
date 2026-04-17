/**
 * 文件用途：提供组件预览画布配置的归一化、查询参数兼容与缩放计算辅助函数。
 */

import type { RuntimeComponentPreviewCanvasConfig } from '@/core/shared/runtime-preview'

export const DEFAULT_CANVAS_WIDTH = 1920
export const DEFAULT_CANVAS_HEIGHT = 1080
export const DEFAULT_CANVAS_PADDING = 0
export const DEFAULT_CANVAS_BACKGROUND = '#f8fafc'

export interface ComponentPreviewCanvasOverrides {
  width: number | null
  height: number | null
  padding: number | null
  background: string | null
}

/**
 * 将画布配置与查询参数覆盖合并为最终可用值。
 * @param rawCanvas 后端下发的画布配置
 * @param queryOverrides URL 查询参数覆盖
 * @returns 完整可用的画布配置
 */
export function normalizeComponentPreviewCanvasConfig(
  rawCanvas?: RuntimeComponentPreviewCanvasConfig | null,
  queryOverrides: ComponentPreviewCanvasOverrides = {
    width: null,
    height: null,
    padding: null,
    background: null,
  },
): Required<RuntimeComponentPreviewCanvasConfig> {
  return {
    width: queryOverrides.width ?? normalizePositiveNumber(rawCanvas?.width, DEFAULT_CANVAS_WIDTH),
    height: queryOverrides.height ?? normalizePositiveNumber(rawCanvas?.height, DEFAULT_CANVAS_HEIGHT),
    padding: queryOverrides.padding ?? normalizeNonNegativeNumber(rawCanvas?.padding, DEFAULT_CANVAS_PADDING),
    background: queryOverrides.background || String(rawCanvas?.background || '').trim() || DEFAULT_CANVAS_BACKGROUND,
  }
}

/**
 * 解析 URL 查询参数中的画布覆盖值。
 * @param searchQuery URL 查询串
 * @returns 画布覆盖值
 */
export function resolveComponentPreviewCanvasOverrides(searchQuery: string): ComponentPreviewCanvasOverrides {
  const searchParams = new URLSearchParams(searchQuery)
  const background = searchParams.get('component_preview_background')
  return {
    width: parsePositiveNumber(searchParams.get('component_preview_width')),
    height: parsePositiveNumber(searchParams.get('component_preview_height')),
    padding: parseNonNegativeNumber(searchParams.get('component_preview_padding')),
    background: background ? background.trim() : null,
  }
}

/**
 * 根据容器尺寸与画布尺寸计算缩放倍率。
 * @param availableWidth 可用宽度
 * @param availableHeight 可用高度
 * @param canvasWidth 画布宽度
 * @param canvasHeight 画布高度
 * @returns 0 到 1 之间的缩放倍率
 */
export function computeComponentPreviewScale(
  availableWidth: number,
  availableHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): number {
  const safeAvailableWidth = Math.max(availableWidth, 320)
  const safeAvailableHeight = Math.max(availableHeight, 220)
  const scaleX = safeAvailableWidth / Math.max(canvasWidth, 1)
  const scaleY = safeAvailableHeight / Math.max(canvasHeight, 1)
  return Math.min(scaleX, scaleY, 1)
}

/**
 * 将输入归一化为正整数。
 * @param rawValue 原始输入
 * @param fallbackValue 回退值
 * @returns 正整数
 */
function normalizePositiveNumber(rawValue: unknown, fallbackValue: number): number {
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallbackValue
}

/**
 * 将输入归一化为非负整数。
 * @param rawValue 原始输入
 * @param fallbackValue 回退值
 * @returns 非负整数
 */
function normalizeNonNegativeNumber(rawValue: unknown, fallbackValue: number): number {
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallbackValue
}

/**
 * 将查询参数解析为正整数；非法值返回 null，仅供 URL 覆盖兼容链路使用。
 * @param rawValue 原始字符串
 * @returns 正整数或 null
 */
function parsePositiveNumber(rawValue: string | null): number | null {
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

/**
 * 将查询参数解析为非负整数；非法值返回 null，仅供 URL 覆盖兼容链路使用。
 * @param rawValue 原始字符串
 * @returns 非负整数或 null
 */
function parseNonNegativeNumber(rawValue: string | null): number | null {
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}
