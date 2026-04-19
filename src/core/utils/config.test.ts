// @vitest-environment jsdom

/**
 * 文件用途：验证运行时配置模块在预加载路由下的默认重定向与空路由兜底行为。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setRuntimePreloadedConfig } from './path'

function buildPreloadedConfig(routes: Array<{
  route: string
  component?: string
  meta: {
    title: string
    order: number
    hidden?: boolean
  }
}>) {
  return {
    app: {
      app: {
        icon: 'slider',
        title: '测试项目',
        description: '测试描述',
        page: {
          width: 1920,
          height: 1080,
        },
        features: {
          showPdfExportButton: true,
          menuMode: 'text' as const,
        },
      },
    },
    routes: {
      routes,
    },
    icons: {
      static_icons: [],
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('window', window)
})

afterEach(() => {
  setRuntimePreloadedConfig(undefined)
  vi.unstubAllGlobals()
})

describe('runtime config default routes', () => {
  it('应使用预加载路由中的首个可见页面作为默认重定向', async () => {
    setRuntimePreloadedConfig(buildPreloadedConfig([
      {
        route: 'page-7',
        component: '@/views/PG20260412001.vue',
        meta: {
          title: '封面页',
          order: 10,
          hidden: false,
        },
      },
      {
        route: 'page-8',
        component: '@/views/PG20260412002.vue',
        meta: {
          title: '隐藏页',
          order: 20,
          hidden: true,
        },
      },
    ]))

    const { getDefaultRouteConfigAsync, reloadAllConfigs } = await import('./config')
    await reloadAllConfigs()
    const defaultRoutes = await getDefaultRouteConfigAsync()

    expect(defaultRoutes[0]).toMatchObject({
      path: '',
      redirect: 'page-7',
    })
  })

  it('无可见业务路由时不应兜底跳转到 home', async () => {
    setRuntimePreloadedConfig(buildPreloadedConfig([]))

    const { getDefaultRouteConfigAsync, reloadAllConfigs } = await import('./config')
    await reloadAllConfigs()
    const defaultRoutes = await getDefaultRouteConfigAsync()

    expect(defaultRoutes.find(route => route.path === '')).toBeUndefined()
    expect(defaultRoutes).toHaveLength(1)
    expect(defaultRoutes[0]).toMatchObject({
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
    })
  })
})
