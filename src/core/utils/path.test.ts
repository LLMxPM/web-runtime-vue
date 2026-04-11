/**
 * 文件用途：验证运行时配置注入、预加载配置优先级与资源路径解析逻辑。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildConfigUrl,
  getRuntimeConfigContext,
  resolveResourcePath,
  setRuntimeConfigContext,
  setRuntimePreloadedConfig,
  setRuntimePreviewContext,
} from './path'

beforeEach(() => {
  vi.stubGlobal('window', {})
})

afterEach(() => {
  setRuntimeConfigContext(undefined)
  setRuntimePreviewContext(undefined)
  setRuntimePreloadedConfig(undefined)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('runtime path helpers', () => {
  it('应优先使用 window 注入的项目配置根地址', () => {
    setRuntimeConfigContext({
      projectId: 18,
      projectConfigBaseUrl: 'https://window.example/projects/18/configs/'
    })

    expect(getRuntimeConfigContext()?.projectId).toBe(18)
    expect(buildConfigUrl('app')).toBe('https://window.example/projects/18/configs/app.config.yaml')
  })

  it('未注入配置根地址时应回退到本地相对路径', () => {
    expect(buildConfigUrl('themes')).toBe('./config/themes.config.yaml')
  })

  it('应优先使用 manifest 资源映射解析资源路径', () => {
    setRuntimePreviewContext({
      sessionId: 'sess_1',
      tenantId: 'tenant_1',
      projectId: 'project_1',
      releaseId: 'release_1',
      entryRoute: '/home',
      assetBaseUrl: 'https://assets.example/releases/release_1',
      traceId: 'trace_1'
    })
    setRuntimePreloadedConfig({
      manifest: {
        release_id: 'release_1',
        tenant_id: 'tenant_1',
        project_id: 'project_1',
        entry_route: '/home',
        modules: {},
        assets: {
          'img/logo/ppt-e.png': 'hashed/logo-a1b2c3.png'
        }
      }
    })

    expect(resolveResourcePath('img/logo/ppt-e.png')).toBe('https://assets.example/releases/release_1/hashed/logo-a1b2c3.png')
  })

  it('manifest 未命中时应拼接 asset base url', () => {
    setRuntimePreviewContext({
      sessionId: 'sess_2',
      tenantId: 'tenant_2',
      projectId: 'project_2',
      releaseId: 'release_2',
      entryRoute: '/overview',
      assetBaseUrl: 'https://assets.example/releases/release_2/',
      traceId: 'trace_2'
    })

    expect(resolveResourcePath('./fonts/demo.woff2')).toBe('https://assets.example/releases/release_2/fonts/demo.woff2')
  })
})
