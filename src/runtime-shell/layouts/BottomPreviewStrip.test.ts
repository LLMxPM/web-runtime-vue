// @vitest-environment jsdom

/**
 * 文件用途：验证底部缩略图导航条的项目标题、项目图标与基础交互渲染。
 */

import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BottomPreviewStrip from './BottomPreviewStrip.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({
    path: '/home',
  }),
}))

vi.mock('@/runtime-shell/layouts/AppBrandIcon.vue', () => ({
  default: defineComponent({
    name: 'AppBrandIconStub',
    props: {
      name: {
        type: String,
        default: '',
      },
      size: {
        type: [Number, String],
        default: 14,
      },
      alt: {
        type: String,
        default: '',
      },
    },
    setup(props) {
      return () => h('span', {
        'data-testid': 'app-title-icon',
        'data-icon-name': props.name,
        'data-icon-size': props.size,
        'data-icon-alt': props.alt,
      })
    },
  }),
}))

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('BottomPreviewStrip', () => {
  it('应在底栏项目标题旁展示项目图标', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(BottomPreviewStrip, {
      navigationItems: [],
      appConfig: {
        icon: 'theme-project-icon',
        title: '主题图标项目',
      },
      pageConfig: {
        width: 1920,
        height: 1080,
      },
    })

    app.mount(host)
    await nextTick()

    const icon = host.querySelector('[data-testid="app-title-icon"]')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('data-icon-name')).toBe('theme-project-icon')
    expect(icon?.getAttribute('data-icon-alt')).toBe('主题图标项目')
    expect(host.textContent).toContain('主题图标项目')

    app.unmount()
  })
})
