// @vitest-environment jsdom

/**
 * 文件用途：验证响应式布局在不同菜单模式下的配置透传与底部缩略图切换行为。
 */

import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { sidebarPropSpy, sidePreviewPropSpy, bottomStripPropSpy, mockMenuMode, mockPageConfig } = vi.hoisted(() => ({
  sidebarPropSpy: vi.fn(),
  sidePreviewPropSpy: vi.fn(),
  bottomStripPropSpy: vi.fn(),
  mockMenuMode: {
    value: 'preview' as 'text' | 'preview' | 'bottom-preview',
  },
  mockPageConfig: {
    value: {
      width: 1920,
      height: 1080,
      baseFontSize: '20px',
      iconDefaultStrokeWidth: 2,
    },
  },
}))

vi.mock('@/core/utils/config', async () => {
  const appConfigRef = {}
  const appPageConfigRef = {}

  Object.defineProperty(appConfigRef, 'value', {
    get() {
      return {
        app: {
          icon: 'slider',
          title: '测试标题',
          description: '测试描述',
          features: {
            showPdfExportButton: false,
            menuMode: mockMenuMode.value,
          },
          page: {
            width: mockPageConfig.value.width,
            height: mockPageConfig.value.height,
            baseFontSize: mockPageConfig.value.baseFontSize,
            iconDefaultStrokeWidth: mockPageConfig.value.iconDefaultStrokeWidth,
          },
        },
      }
    },
  })

  Object.defineProperty(appPageConfigRef, 'value', {
    get() {
      return {
        width: mockPageConfig.value.width,
        height: mockPageConfig.value.height,
        baseFontSize: mockPageConfig.value.baseFontSize,
        iconDefaultStrokeWidth: mockPageConfig.value.iconDefaultStrokeWidth,
      }
    },
  })

  return {
    DEFAULT_PAGE_CONFIG: {
      width: 1920,
      height: 1080,
      baseFontSize: '20px',
      iconDefaultStrokeWidth: 2,
    },
    appConfig: appConfigRef,
    appPageConfig: appPageConfigRef,
    loadIconConfig: vi.fn().mockResolvedValue({ icons: [] }),
  }
})

vi.mock('@/runtime-shell/layouts/BottomPreviewStrip.vue', async () => {
  const { defineComponent, h } = await import('vue')

  return {
    default: defineComponent({
      name: 'BottomPreviewStripStub',
      props: {
        navigationItems: {
          type: Array,
          default: () => [],
        },
        pageConfig: {
          type: Object,
          default: () => ({}),
        },
        appConfig: {
          type: Object,
          default: () => ({}),
        },
      },
      setup(props) {
        bottomStripPropSpy(props.pageConfig)

        return () => h(
          'div',
          { 'data-testid': 'bottom-preview-strip-stub' },
          `bottom:${(props.pageConfig as any)?.width ?? 'unknown'}`,
        )
      },
    }),
  }
})

vi.mock('@/runtime-shell/layouts/ResponsiveSidebar.vue', async () => {
  const { defineComponent, h } = await import('vue')

  return {
    default: defineComponent({
      name: 'ResponsiveSidebarStub',
      props: {
        navigationItems: {
          type: Array,
          default: () => [],
        },
        appConfig: {
          type: Object,
          required: true,
        },
      },
      setup(props) {
        sidebarPropSpy(props.appConfig)

        return () => h(
          'div',
          { 'data-testid': 'responsive-sidebar-stub' },
          `${(props.appConfig as any).title}:${(props.appConfig as any).features?.menuMode}`,
        )
      },
    }),
  }
})

vi.mock('@/runtime-shell/layouts/SidePreviewStrip.vue', async () => {
  const { defineComponent, h } = await import('vue')

  return {
    default: defineComponent({
      name: 'SidePreviewStripStub',
      props: {
        navigationItems: {
          type: Array,
          default: () => [],
        },
        appConfig: {
          type: Object,
          required: true,
        },
      },
      setup(props) {
        sidePreviewPropSpy(props.appConfig)

        return () => h(
          'div',
          { 'data-testid': 'side-preview-strip-stub' },
          `${(props.appConfig as any).title}:${(props.appConfig as any).features?.menuMode}`,
        )
      },
    }),
  }
})

vi.mock('@runtime-kit/internal/components/viewport/ScaledCanvasViewport.vue', async () => {
  const { defineComponent, h } = await import('vue')

  return {
    default: defineComponent({
      name: 'ScaledCanvasViewportStub',
      setup(_, { slots }) {
        return () => h('div', { 'data-testid': 'fixed-ratio-container-stub' }, slots.default?.())
      },
    }),
  }
})

vi.mock('@/runtime-shell/pdf/PDFExportDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')

  return {
    default: defineComponent({
      name: 'PDFExportDialogStub',
      props: {
        visible: {
          type: Boolean,
          default: false,
        },
      },
      setup() {
        return () => h('div', { 'data-testid': 'pdf-export-dialog-stub' })
      },
    }),
  }
})

vi.mock('@/runtime-shell/feedback/ErrorBoundary.vue', async () => {
  const { defineComponent, h } = await import('vue')

  return {
    default: defineComponent({
      name: 'ErrorBoundaryStub',
      setup(_, { slots }) {
        return () => h('div', { 'data-testid': 'error-boundary-stub' }, slots.default?.())
      },
    }),
  }
})

vi.mock('@/core/composables/useMenu', async () => {
  const { computed } = await import('vue')

  return {
    useMenu: () => ({
      menuConfig: computed(() => ({
        items: [],
      })),
    }),
  }
})

vi.mock('@/core/composables/usePageNavigation', async () => {
  const { computed } = await import('vue')

  return {
    usePageNavigation: () => ({
      previousPage: computed(() => null),
      nextPage: computed(() => null),
      canGoPrevious: computed(() => false),
      canGoNext: computed(() => false),
      goToPreviousPage: vi.fn(),
      goToNextPage: vi.fn(),
      getPageTitle: vi.fn(() => '测试页面'),
    }),
  }
})

vi.mock('@runtime-kit/public/composables/theme/useTheme.v1', async () => {
  const { computed } = await import('vue')

  return {
    useTheme: () => ({
      themeStyles: computed(() => ({
        '--theme-font-size-base': mockPageConfig.value.baseFontSize,
      })),
    }),
  }
})

vi.mock('@/core/services/PDFExportService', () => ({
  PDFExportService: {
    getInstance() {
      return {
        setRouter: vi.fn(),
      }
    },
  },
}))

vi.mock('@lucide/vue', async () => {
  const { defineComponent, h } = await import('vue')

  const createIconStub = (name: string) => defineComponent({
    name,
    setup() {
      return () => h('span', { 'data-testid': name })
    },
  })

  return {
    Maximize2: createIconStub('Maximize2Stub'),
    Minimize2: createIconStub('Minimize2Stub'),
    ChevronLeft: createIconStub('ChevronLeftStub'),
    ChevronRight: createIconStub('ChevronRightStub'),
    FileDown: createIconStub('FileDownStub'),
    PanelLeft: createIconStub('PanelLeftStub'),
    PanelBottom: createIconStub('PanelBottomStub'),
  }
})

import ResponsiveLayout from './ResponsiveLayout.vue'

afterEach(() => {
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: null,
  })
  mockMenuMode.value = 'preview'
  mockPageConfig.value = {
    width: 1920,
    height: 1080,
    baseFontSize: '20px',
    iconDefaultStrokeWidth: 2,
  }
  sidebarPropSpy.mockReset()
  sidePreviewPropSpy.mockReset()
  bottomStripPropSpy.mockReset()
  document.body.innerHTML = ''
})

describe('ResponsiveLayout', () => {
  it('应向侧边栏传递已解包的应用配置对象', async () => {
    mockMenuMode.value = 'text'

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/',
          component: {
            template: '<div>route content</div>',
          },
        },
      ],
    })

    await router.push('/')
    await router.isReady()

    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(ResponsiveLayout)
    app.use(router)
    app.config.errorHandler = (error) => {
      throw error
    }

    expect(() => app.mount(host)).not.toThrow()
    await nextTick()

    expect(sidebarPropSpy).toHaveBeenCalled()
    expect(sidebarPropSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: '测试标题',
      features: expect.objectContaining({
        menuMode: 'text',
      }),
    }))
    expect(host.textContent).toContain('测试标题:text')

    app.unmount()
  })

  it('应支持以底部缩略图模式启动并切回侧边预览', async () => {
    mockMenuMode.value = 'bottom-preview'

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/',
          component: {
            template: '<div>route content</div>',
          },
        },
      ],
    })

    await router.push('/')
    await router.isReady()

    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(ResponsiveLayout)
    app.use(router)
    app.config.errorHandler = (error) => {
      throw error
    }

    app.mount(host)
    await nextTick()

    expect(host.querySelector('[data-testid="bottom-preview-strip-stub"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="responsive-sidebar-stub"]')).toBeNull()
    expect(bottomStripPropSpy).toHaveBeenCalledWith(expect.objectContaining({
      width: 1920,
      height: 1080,
    }))

    const toggleButton = host.querySelector('button[title="切换到侧边预览模式"]') as HTMLButtonElement | null
    expect(toggleButton).not.toBeNull()

    toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(host.querySelector('[data-testid="bottom-preview-strip-stub"]')).toBeNull()
    expect(host.querySelector('[data-testid="side-preview-strip-stub"]')).not.toBeNull()
    expect(sidePreviewPropSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: '测试标题',
      features: expect.objectContaining({
        menuMode: 'preview',
      }),
    }))
    expect(host.textContent).toContain('测试标题:preview')

    app.unmount()
  })

  it('底部缩略图模式进入全屏后应按侧边预览模式渲染', async () => {
    mockMenuMode.value = 'bottom-preview'

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/',
          component: {
            template: '<div>route content</div>',
          },
        },
      ],
    })

    await router.push('/')
    await router.isReady()

    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(ResponsiveLayout)
    app.use(router)
    app.config.errorHandler = (error) => {
      throw error
    }

    app.mount(host)
    await nextTick()

    expect(host.querySelector('[data-testid="bottom-preview-strip-stub"]')).not.toBeNull()
    expect(host.querySelector('.canvas-navigation-buttons')).not.toBeNull()

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    await nextTick()

    expect(host.querySelector('[data-testid="bottom-preview-strip-stub"]')).toBeNull()
    expect(host.querySelector('.canvas-navigation-buttons')).toBeNull()
    expect(host.querySelector('[data-testid="side-preview-strip-stub"]')).not.toBeNull()
    expect(host.querySelector('.nav-button--previous')).not.toBeNull()
    expect(host.querySelector('.nav-button--next')).not.toBeNull()
    expect(sidePreviewPropSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: '测试标题',
      features: expect.objectContaining({
        menuMode: 'preview',
      }),
    }))

    app.unmount()
  })

  it('翻页到首页或末页边界时应展示提示', async () => {
    mockMenuMode.value = 'preview'

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/',
          component: {
            template: '<div>route content</div>',
          },
        },
      ],
    })

    await router.push('/')
    await router.isReady()

    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(ResponsiveLayout)
    app.use(router)
    app.config.errorHandler = (error) => {
      throw error
    }

    app.mount(host)
    await nextTick()

    const previousButton = host.querySelector('.nav-button--previous') as HTMLButtonElement | null
    const nextButton = host.querySelector('.nav-button--next') as HTMLButtonElement | null

    expect(previousButton).not.toBeNull()
    expect(nextButton).not.toBeNull()
    expect(previousButton?.hasAttribute('disabled')).toBe(false)
    expect(nextButton?.hasAttribute('disabled')).toBe(false)
    expect(previousButton?.getAttribute('aria-disabled')).toBe('true')
    expect(nextButton?.getAttribute('aria-disabled')).toBe('true')

    previousButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(host.querySelector('.page-boundary-hint')?.textContent).toContain('当前已经是首页')

    nextButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(host.querySelector('.page-boundary-hint')?.textContent).toContain('当前已经是末页')

    app.unmount()
  })

  it('应在页面内容作用域注入页面设计字号缩放变量', async () => {
    mockPageConfig.value = {
      width: 1280,
      height: 720,
      baseFontSize: '20px',
      iconDefaultStrokeWidth: 2,
    }

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/',
          component: {
            template: '<div>route content</div>',
          },
        },
      ],
    })

    await router.push('/')
    await router.isReady()

    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(ResponsiveLayout)
    app.use(router)
    app.config.errorHandler = (error) => {
      throw error
    }

    app.mount(host)
    await nextTick()

    const pageSource = host.querySelector('.runtime-page-print-source') as HTMLElement | null
    expect(pageSource).not.toBeNull()
    expect(pageSource?.style.getPropertyValue('--runtime-page-typography-scale')).toBe('0.666667')
    expect(pageSource?.style.getPropertyValue('--tw-font-size-base')).toBe(
      'calc(var(--theme-font-size-base, 20px) * 0.666667)',
    )
    expect(pageSource?.style.getPropertyValue('--tw-spacing-unit')).toBe('calc(var(--tw-font-size-base) * 0.25)')

    app.unmount()
  })

  it('页面基础字号变化时不应把页面字号缩放变量注入 Runtime shell 容器', async () => {
    mockPageConfig.value = {
      width: 1280,
      height: 720,
      baseFontSize: '30px',
      iconDefaultStrokeWidth: 2,
    }

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/',
          component: {
            template: '<div>route content</div>',
          },
        },
      ],
    })

    await router.push('/')
    await router.isReady()

    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(ResponsiveLayout)
    app.use(router)
    app.config.errorHandler = (error) => {
      throw error
    }

    app.mount(host)
    await nextTick()

    const shellRoot = host.querySelector('.responsive-layout') as HTMLElement | null
    const pageSource = host.querySelector('.runtime-page-print-source') as HTMLElement | null
    expect(shellRoot).not.toBeNull()
    expect(pageSource).not.toBeNull()
    expect(shellRoot?.style.getPropertyValue('--theme-font-size-base')).toBe('30px')
    expect(shellRoot?.style.getPropertyValue('--runtime-page-typography-scale')).toBe('')
    expect(shellRoot?.style.getPropertyValue('--tw-font-size-base')).toBe('')
    expect(shellRoot?.style.getPropertyValue('--tw-spacing-unit')).toBe('')
    expect(pageSource?.style.getPropertyValue('--runtime-page-typography-scale')).toBe('0.666667')
    expect(pageSource?.style.getPropertyValue('--tw-font-size-base')).toBe(
      'calc(var(--theme-font-size-base, 20px) * 0.666667)',
    )

    app.unmount()
  })
})
