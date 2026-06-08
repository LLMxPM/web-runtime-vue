// @vitest-environment jsdom

/**
 * 文件用途：验证编辑器截图视觉资源就绪探针的图片、背景图、字体与单页状态等待行为。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  extractCssUrls,
  registerEditorVisualAssetProbe,
  waitForEditorVisualAssets,
} from './visual-assets'

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>'
  Object.defineProperty(Document.prototype, 'fonts', {
    value: undefined,
    configurable: true,
  })
})

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  Reflect.deleteProperty(document, 'fonts')
  Reflect.deleteProperty(Document.prototype, 'fonts')
  vi.unstubAllGlobals()
})

describe('visual asset readiness probe', () => {
  it('应解析 CSS background-image 中的 URL', () => {
    expect(extractCssUrls('url("https://assets.example/bg.png"), linear-gradient(red, blue)')).toEqual([
      'https://assets.example/bg.png',
    ])
    expect(extractCssUrls("url('./cover.png')")).toEqual(['./cover.png'])
  })

  it('应等待 img 加载后解码', async () => {
    document.body.innerHTML = '<img id="hero" src="https://assets.example/hero.png" />'
    const image = document.querySelector<HTMLImageElement>('#hero')!
    let loaded = false
    Object.defineProperty(image, 'complete', { get: () => loaded, configurable: true })
    Object.defineProperty(image, 'naturalWidth', { get: () => (loaded ? 120 : 0), configurable: true })
    Object.defineProperty(image, 'naturalHeight', { get: () => (loaded ? 80 : 0), configurable: true })
    image.decode = vi.fn().mockResolvedValue(undefined)
    window.setTimeout(() => {
      loaded = true
      image.dispatchEvent(new Event('load'))
    }, 0)

    const result = await waitForEditorVisualAssets({ timeoutMs: 1000 })

    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(result.total).toBe(1)
    expect(result.loaded).toBe(1)
    expect(image.decode).toHaveBeenCalled()
  })

  it('应等待字体 ready promise 完成', async () => {
    Object.defineProperty(Document.prototype, 'fonts', {
      value: {
        ready: new Promise(resolve => window.setTimeout(resolve, 0)),
      },
      configurable: true,
    })

    const result = await waitForEditorVisualAssets({ timeoutMs: 100 })

    expect(result.ok).toBe(true)
    expect(result.pending).toHaveLength(0)
  })

  it('应把未完成的 img 标记为超时 pending', async () => {
    document.body.innerHTML = '<img id="slow" src="https://assets.example/slow.png" />'
    const image = document.querySelector<HTMLImageElement>('#slow')!
    Object.defineProperty(image, 'complete', { value: false, configurable: true })
    Object.defineProperty(image, 'naturalWidth', { value: 0, configurable: true })
    Object.defineProperty(image, 'naturalHeight', { value: 0, configurable: true })

    const result = await waitForEditorVisualAssets({ timeoutMs: 20 })

    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.pending[0]).toMatchObject({
      type: 'image',
      url: 'https://assets.example/slow.png',
    })
  })

  it('应把 img error 标记为 failed', async () => {
    document.body.innerHTML = '<img id="broken" src="https://assets.example/broken.png" />'
    const image = document.querySelector<HTMLImageElement>('#broken')!
    Object.defineProperty(image, 'complete', { value: false, configurable: true })
    Object.defineProperty(image, 'naturalWidth', { value: 0, configurable: true })
    Object.defineProperty(image, 'naturalHeight', { value: 0, configurable: true })
    window.setTimeout(() => image.dispatchEvent(new Event('error')), 0)

    const result = await waitForEditorVisualAssets({ timeoutMs: 100 })

    expect(result.ok).toBe(false)
    expect(result.failed[0]).toMatchObject({
      type: 'image',
      url: 'https://assets.example/broken.png',
    })
  })

  it('应等待 CSS 背景图 URL 加载完成', async () => {
    document.body.innerHTML = '<div id="card" style="background-image: url(https://assets.example/bg.png)"></div>'
    vi.stubGlobal('Image', createMockImageClass('load'))

    const result = await waitForEditorVisualAssets({ timeoutMs: 100 })

    expect(result.ok).toBe(true)
    expect(result.total).toBe(1)
    expect(result.loaded).toBe(1)
  })

  it('应等待 ViewPreview 状态从 loading 变为 ready', async () => {
    document.body.innerHTML = '<div id="preview" data-runtime-view-preview-state="loading"></div>'
    const preview = document.querySelector<HTMLElement>('#preview')!
    window.setTimeout(() => {
      preview.dataset.runtimeViewPreviewState = 'ready'
    }, 0)

    const result = await waitForEditorVisualAssets({ timeoutMs: 100 })

    expect(result.ok).toBe(true)
    expect(result.pending).toHaveLength(0)
  })

  it('应等待 Draw.io 图表状态从 loading 变为 ready', async () => {
    document.body.innerHTML = '<div id="drawio" data-runtime-drawio-state="loading"></div>'
    const drawio = document.querySelector<HTMLElement>('#drawio')!
    window.setTimeout(() => {
      drawio.dataset.runtimeDrawioState = 'ready'
    }, 0)

    const result = await waitForEditorVisualAssets({ timeoutMs: 100 })

    expect(result.ok).toBe(true)
    expect(result.total).toBe(1)
    expect(result.loaded).toBe(1)
  })

  it('应把未完成的 Draw.io 图表标记为超时 pending', async () => {
    document.body.innerHTML = '<div data-runtime-drawio-state="loading" data-runtime-drawio-message="渲染中"></div>'

    const result = await waitForEditorVisualAssets({ timeoutMs: 20 })

    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.pending[0]).toMatchObject({
      type: 'drawio',
      message: '渲染中',
    })
  })

  it('应把 Draw.io 渲染错误标记为 failed', async () => {
    document.body.innerHTML = '<div data-runtime-drawio-state="error" data-runtime-drawio-message="SVG 生成失败"></div>'

    const result = await waitForEditorVisualAssets({ timeoutMs: 100 })

    expect(result.ok).toBe(false)
    expect(result.failed[0]).toMatchObject({
      type: 'drawio',
      message: 'SVG 生成失败',
    })
  })

  it('应注册全局视觉资源等待函数', () => {
    registerEditorVisualAssetProbe()

    expect(window.__EDITOR_RUNTIME_WAIT_FOR_VISUAL_ASSETS__).toBe(waitForEditorVisualAssets)
  })
})

/**
 * 构造可控的 Image 类，用于模拟背景图加载结果。
 * @param eventName 触发的图片事件
 * @returns Image 构造函数替身
 */
function createMockImageClass(eventName: 'load' | 'error') {
  return class MockImage extends EventTarget {
    private value = ''

    get src(): string {
      return this.value
    }

    set src(nextValue: string) {
      this.value = nextValue
      window.setTimeout(() => this.dispatchEvent(new Event(eventName)), 0)
    }
  }
}
