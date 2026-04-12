/**
 * 文件用途：封装 Backend 托管资源的 Vue 3 响应式辅助函数。
 *
 * 工作原理：
 *   SaaS 预览启动时，Backend 把工作空间内所有资源在 manifest.assets 中注册：
 *     { "background.png": "a3f8b2c1...", "logo.svg": "b5c8d3e2..." }
 *   同时 assetBaseUrl 已包含 workspaceId：
 *     "http://backend/api/v1/public/assets/{workspaceId}"
 *
 *   resolveResourcePath(original_name) 会自动完成：
 *     original_name → manifest 查 file_hash → assetBaseUrl + file_hash → 完整 URL
 *
 *   因此 Vue 页面只需传入 original_name（上传时的文件名），无需关心任何 ID、hash 或地址。
 */

import { computed, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue'
import { resolveResourcePath } from '@/core/utils/path'

/**
 * 将资源 original_name 解析为响应式完整 URL。
 *
 * @param name 资源的 original_name（上传时的文件名，如 "background.png"）
 * @param fallback name 未命中时的兜底 URL，默认空串
 * @returns 响应式 URL ComputedRef
 *
 * @example
 * const src = useAssetSrc('background.png')
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
 * 将资源 original_name 解析为响应式 CSS background-image 样式对象。
 *
 * @param name 资源的 original_name（如 "background.png"）
 * @param fallback name 未命中时的兜底 URL
 * @returns 响应式 { backgroundImage: string } CSSProperties
 *
 * @example
 * const bgStyle = useAssetBackground('background.png')
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
