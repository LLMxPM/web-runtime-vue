// @vitest-environment jsdom

/**
 * 文件用途：验证单页预览组件向截图探针暴露 loading、ready 与 error 状态。
 */

import { createApp, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ViewPreview from './ViewPreview.vue'

const mockImportViewModule = vi.hoisted(() => vi.fn())

vi.mock('@/core/utils/config', () => ({
  DEFAULT_PAGE_CONFIG: {
    width: 1920,
    height: 1080,
    baseFontSize: '20px',
    iconDefaultStrokeWidth: 2,
  },
  appPageConfig: {
    value: {
      width: 1920,
      height: 1080,
    },
  },
}))

vi.mock('@/core/utils/view-module', () => ({
  importViewModule: mockImportViewModule,
}))

class MockResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  mockImportViewModule.mockReset()
  vi.unstubAllGlobals()
})

describe('ViewPreview screenshot state marker', () => {
  it('页面模块加载成功后应标记为 ready', async () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    mockImportViewModule.mockResolvedValue({
      default: {
        name: 'MockPreviewPage',
        setup: () => () => null,
      },
    })

    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(ViewPreview, { filePath: 'src/views/demo.vue' })
    app.mount(host)

    const marker = await waitForState(host, 'ready')

    expect(marker?.dataset.runtimeViewPreviewState).toBe('ready')
    expect(marker?.dataset.runtimeViewPreviewMessage).toBe('')
    const previewSource = host.querySelector<HTMLElement>('.runtime-view-preview-source')
    expect(previewSource?.style.getPropertyValue('--runtime-page-typography-scale')).toBe('')
    expect(previewSource?.style.getPropertyValue('--tw-font-size-base')).toBe('var(--theme-font-size-base, 20px)')
    expect(previewSource?.style.getPropertyValue('--tw-spacing-unit')).toBe('calc(var(--tw-font-size-base) * 0.25)')
    app.unmount()
  })

  it('页面模块加载失败后应标记为 error', async () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockImportViewModule.mockRejectedValue(new Error('模块加载失败'))

    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(ViewPreview, { filePath: 'src/views/missing.vue' })
    app.mount(host)

    const marker = await waitForState(host, 'error')

    expect(marker?.dataset.runtimeViewPreviewState).toBe('error')
    expect(marker?.dataset.runtimeViewPreviewMessage).toContain('模块加载失败')
    app.unmount()
  })
})

/**
 * 等待组件状态属性变为目标值。
 * @param host 宿主节点
 * @param state 目标状态
 * @returns 状态标记元素
 */
async function waitForState(host: HTMLElement, state: string): Promise<HTMLElement | null> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
    await nextTick()
    const marker = host.querySelector<HTMLElement>('[data-runtime-view-preview-state]')
    if (marker?.dataset.runtimeViewPreviewState === state) {
      return marker
    }
  }
  return host.querySelector<HTMLElement>('[data-runtime-view-preview-state]')
}
