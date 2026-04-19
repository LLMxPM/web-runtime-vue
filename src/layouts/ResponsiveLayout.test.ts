// @vitest-environment jsdom

/**
 * 文件用途：验证响应式布局在构建态不会把导入的配置 ref 本体传给侧边栏。
 */

import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { sidebarPropSpy } = vi.hoisted(() => ({
  sidebarPropSpy: vi.fn(),
}))

vi.mock('@/core/utils/config', async () => {
  const { computed } = await import('vue')

  return {
    appConfig: computed(() => ({
      app: {
        icon: 'slider',
        title: '测试标题',
        description: '测试描述',
        features: {
          showPdfExportButton: false,
          menuMode: 'preview',
        },
        page: {
          width: 1920,
          height: 1080,
        },
      },
    })),
    appPageConfig: computed(() => ({
      width: 1920,
      height: 1080,
    })),
  }
})

vi.mock('@/layouts/ResponsiveSidebar.vue', async () => {
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

vi.mock('@/layouts/FixedRatioContainer.vue', async () => {
  const { defineComponent, h } = await import('vue')

  return {
    default: defineComponent({
      name: 'FixedRatioContainerStub',
      setup(_, { slots }) {
        return () => h('div', { 'data-testid': 'fixed-ratio-container-stub' }, slots.default?.())
      },
    }),
  }
})

vi.mock('@/layouts/PDFExportDialog.vue', async () => {
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

vi.mock('@/components/common/ErrorBoundary.vue', async () => {
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

vi.mock('@/core/composables/useTheme', async () => {
  const { computed } = await import('vue')

  return {
    useTheme: () => ({
      themeStyles: computed(() => ({})),
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

vi.mock('lucide-vue-next', async () => {
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
  }
})

import ResponsiveLayout from './ResponsiveLayout.vue'

afterEach(() => {
  sidebarPropSpy.mockReset()
  document.body.innerHTML = ''
})

describe('ResponsiveLayout', () => {
  it('应向侧边栏传递已解包的应用配置对象', async () => {
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
        menuMode: 'preview',
      }),
    }))
    expect(host.textContent).toContain('测试标题:preview')

    app.unmount()
  })
})
