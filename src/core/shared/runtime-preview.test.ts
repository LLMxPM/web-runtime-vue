/**
 * 文件用途：验证 SaaS 预览共享契约中的路径规范化、远程模块 ID 构造与资源 key 处理逻辑。
 */

import { describe, expect, it } from 'vitest'

import {
  buildRemoteModuleId,
  isPreviewEntryModuleRequest,
  isBuiltinLocalViewPath,
  isRuntimeLocalPublicModulePath,
  normalizeAssetKey,
  normalizeRuntimeModulePath,
  normalizeViewModulePath,
  parseRemoteModuleId,
  resolvePreviewEntryModulePath,
  toAliasModulePath,
  toAliasViewPath,
} from './runtime-preview'

describe('runtime preview shared helpers', () => {
  it('应将多种视图路径规范化为 src/views 形式', () => {
    expect(normalizeViewModulePath('@/views/demo/Page.vue')).toBe('src/views/demo/Page.vue')
    expect(normalizeViewModulePath('/src/views/demo/Page.vue')).toBe('src/views/demo/Page.vue')
    expect(normalizeViewModulePath('views/demo/Page.vue')).toBe('src/views/demo/Page.vue')
  })

  it('应将工作空间组件别名规范化为远程模块路径', () => {
    expect(normalizeRuntimeModulePath('@workspace-components/CMP_DEMO/v/3')).toBe('src/workspace-components/CMP_DEMO/v/3.vue')
    expect(toAliasModulePath('src/workspace-components/CMP_DEMO/v/3.vue')).toBe('@workspace-components/CMP_DEMO/v/3')
  })

  it('应识别本地内建默认页面路径', () => {
    expect(isBuiltinLocalViewPath('src/views/defaultpage/NotFoundPage.vue')).toBe(true)
    expect(isBuiltinLocalViewPath('src/views/demo/Page.vue')).toBe(false)
  })

  it('应识别 Runtime 对远程模块开放的本地公共模块路径', () => {
    expect(isRuntimeLocalPublicModulePath('src/components/common/AppIcon.vue')).toBe(true)
    expect(isRuntimeLocalPublicModulePath('src/core/utils/path.ts')).toBe(true)
    expect(isRuntimeLocalPublicModulePath('src/views/demo/Page.vue')).toBe(false)
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

  it('应仅将单页面预览的页面模块识别为入口模块请求', () => {
    expect(resolvePreviewEntryModulePath('src/views/demo/Page.vue')).toBe('src/views/demo/Page.vue')
    expect(resolvePreviewEntryModulePath('/home')).toBe('')
    expect(isPreviewEntryModuleRequest('src/views/demo/Page.vue', 'src/views/demo/Page.vue')).toBe(true)
    expect(isPreviewEntryModuleRequest('src/views/demo/Page.vue', '/home')).toBe(false)
  })

  it('应将资源路径规范化为 manifest key', () => {
    expect(normalizeAssetKey('./img/logo/demo.png')).toBe('img/logo/demo.png')
    expect(normalizeAssetKey('\\fonts\\demo.woff2')).toBe('fonts/demo.woff2')
  })
})
