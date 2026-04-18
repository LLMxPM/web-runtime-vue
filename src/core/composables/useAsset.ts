/**
 * 文件用途：封装 Backend 托管资源的 Vue 3 响应式辅助函数。
 *
 * 工作原理：
 *   SaaS 预览启动时，Backend 把工作空间内所有资源按逻辑名注册到 manifest.assets：
 *     { "background": "a3f8b2c1...", "logo-mark": "b5c8d3e2..." }
 *   同时 assetBaseUrl 已包含 workspaceId：
 *     "http://backend/api/v1/public/assets/{workspaceId}"
 *
 *   resolveResourcePath(asset.name) 会自动完成：
 *     asset.name → manifest 查 file_hash → assetBaseUrl + file_hash → 完整 URL
 *
 *   因此 Vue 页面只需传入资源逻辑名 `asset.name`，无需关心任何 ID、hash 或地址。
 */

import { computed, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue'
import { resolveResourcePath } from '@/core/utils/path'

/**
 * 将资源逻辑名解析为响应式完整 URL。
 *
 * @param name 资源的逻辑名 `asset.name`（如 "background"）
 * @param fallback name 未命中时的兜底 URL，默认空串
 * @returns 响应式 URL ComputedRef
 *
 * @example
 * const src = useAssetSrc('background')
 * <img :src="src" />
 */
export function useAssetSrc(
  name: MaybeRefOrGetter<string | null | undefined>,
  fallback: string = '',
): ComputedRef<string> {
  return computed(() => {
    const n = toValue(name)
    if (!n) return fallback
    const resolved = resolveResourcePath(n)
    return resolved || fallback
  })
}

/**
 * 将资源逻辑名解析为响应式 CSS background-image 样式对象。
 *
 * @param name 资源的逻辑名 `asset.name`（如 "background"）
 * @param fallback name 未命中时的兜底 URL
 * @returns 响应式 { backgroundImage: string } CSSProperties
 *
 * @example
 * const bgStyle = useAssetBackground('background')
 * <div :style="bgStyle" />
 */
export function useAssetBackground(
  name: MaybeRefOrGetter<string | null | undefined>,
  fallback: string = '',
): ComputedRef<{ backgroundImage: string }> {
  return computed(() => {
    const n = toValue(name)
    if (!n) return { backgroundImage: fallback ? `url(${fallback})` : '' }
    const resolved = resolveResourcePath(n)
    const url = resolved || fallback
    return { backgroundImage: url ? `url(${url})` : '' }
  })
}
