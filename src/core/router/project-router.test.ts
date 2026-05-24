/**
 * 文件用途：验证项目路由使用项目名称作为固定浏览器标签页标题。
 */

import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDefaultRouteConfigAsyncMock,
  getRouteConfigsAsyncMock,
  loadAppConfigMock,
} = vi.hoisted(() => ({
  getDefaultRouteConfigAsyncMock: vi.fn(),
  getRouteConfigsAsyncMock: vi.fn(),
  loadAppConfigMock: vi.fn(),
}))

vi.mock('@/core/utils/config', () => ({
  getDefaultRouteConfigAsync: getDefaultRouteConfigAsyncMock,
  getRouteConfigsAsync: getRouteConfigsAsyncMock,
  loadAppConfig: loadAppConfigMock,
}))

vi.mock('@/core/utils/route-generator', () => ({
  generateRoutes: vi.fn(() => []),
}))

import { createProjectRouter } from './project-router'

const PageStub = defineComponent({
  name: 'ProjectRouterPageStub',
  template: '<div />',
})

describe('createProjectRouter', () => {
  beforeEach(() => {
    document.title = '初始标题'
    window.history.replaceState(null, '', '/')
    getDefaultRouteConfigAsyncMock.mockResolvedValue([])
    getRouteConfigsAsyncMock.mockResolvedValue([])
    loadAppConfigMock.mockResolvedValue({
      app: {
        icon: 'slider',
        title: ' 测试项目 ',
        description: '',
      },
    })
  })

  it('页面切换后仍保持浏览器标题为项目名称', async () => {
    const router = await createProjectRouter({
      extraRoutes: [
        {
          path: '/first',
          component: PageStub,
          meta: { title: '第一页' },
        },
        {
          path: '/second',
          component: PageStub,
          meta: { title: '第二页' },
        },
      ],
    })

    expect(document.title).toBe('测试项目')

    await router.push('/first')
    await router.isReady()
    expect(document.title).toBe('测试项目')

    document.title = '第一页'
    await router.push('/second')
    expect(document.title).toBe('测试项目')
  })
})
