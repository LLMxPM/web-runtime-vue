/**
 * 文件用途：验证 SaaS 预览共享契约中的路径规范化、远程模块 ID 构造与资源 key 处理逻辑。
 */

import { describe, expect, it } from 'vitest'

import {
  buildRemoteModuleId,
  isBuiltinLocalViewPath,
  normalizeAssetKey,
  normalizeViewModulePath,
  parseRemoteModuleId,
  toAliasViewPath,
} from './runtime-preview'

describe('runtime preview shared helpers', () => {
  it('应将多种视图路径规范化为 src/views 形式', () => {
    expect(normalizeViewModulePath('@/views/demo/Page.vue')).toBe('src/views/demo/Page.vue')
    expect(normalizeViewModulePath('/src/views/demo/Page.vue')).toBe('src/views/demo/Page.vue')
    expect(normalizeViewModulePath('views/demo/Page.vue')).toBe('src/views/demo/Page.vue')
  })

  it('应识别本地内建默认页面路径', () => {
    expect(isBuiltinLocalViewPath('src/views/defaultpage/NotFoundPage.vue')).toBe(true)
    expect(isBuiltinLocalViewPath('src/views/demo/Page.vue')).toBe(false)
  })

  it('应构造并解析稳定的远程模块 ID', () => {
    const remoteId = buildRemoteModuleId('sess_1', 'release_1', '@/views/demo/Page.vue')
    const parsed = parseRemoteModuleId(remoteId)

    expect(remoteId).toContain('/@runtime-release/')
    expect(parsed).toEqual({
      sessionId: 'sess_1',
      releaseId: 'release_1',
      modulePath: 'src/views/demo/Page.vue'
    })
    expect(toAliasViewPath(parsed?.modulePath || '')).toBe('@/views/demo/Page.vue')
  })

  it('应将资源路径规范化为 manifest key', () => {
    expect(normalizeAssetKey('./img/logo/demo.png')).toBe('img/logo/demo.png')
    expect(normalizeAssetKey('\\fonts\\demo.woff2')).toBe('fonts/demo.woff2')
  })
})
