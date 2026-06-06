/* eslint-disable vue/one-component-per-file */
/**
 * 文件用途：验证 Draw.io 渲染器在外层高度不完整时的自适应兜底能力。
 *
 * @vitest-environment jsdom
 */

import { createApp, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DrawioViewer from './DrawioViewer.vue'

const DRAWIO_XML = '<mxfile><diagram name="demo"><mxGraphModel /></diagram></mxfile>'

/**
 * 等待组件内部异步加载、GraphViewer 处理和缩放重试完成。
 */
async function waitForDrawioRender(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 25))
    await nextTick()
  }
}

afterEach(() => {
  delete window.GraphViewer
  Reflect.deleteProperty(SVGElement.prototype, 'getBBox')
})

describe('DrawioViewer', () => {
  it('传入 content 时应直接渲染 XML 而不请求 src', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    window.GraphViewer = {
      processElements: vi.fn(() => {
        document.querySelectorAll('.mxgraph').forEach(element => {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
          svg.appendChild(group)
          element.appendChild(svg)
        })
      }),
    }
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      value: vi.fn(() => ({
        x: 0,
        y: 0,
        width: 400,
        height: 200,
      }) as DOMRect),
      configurable: true,
    })

    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(DrawioViewer, {
      src: '/should-not-fetch.drawio',
      content: DRAWIO_XML,
      height: 240,
    })
    app.mount(host)

    await waitForDrawioRender()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(host.querySelector<SVGSVGElement>('.drawio-viewer svg')).not.toBeNull()

    app.unmount()
    host.remove()
    fetchSpy.mockRestore()
  })

  it('父级没有明确高度且使用百分比高度时，应按图表比例补充可渲染高度', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(DRAWIO_XML, { status: 200 }),
    )

    const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function getClientWidth() {
      if ((this as HTMLElement).classList?.contains('drawio-viewer')) return 400
      if ((this as HTMLElement).classList?.contains('drawio-viewer__container')) return 400
      return 400
    })
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function getClientHeight() {
      const element = this as HTMLElement
      if (element.classList?.contains('drawio-viewer')) {
        if (element.style.height.endsWith('%')) return 0
        return parseInt(element.style.height || '0', 10) || 0
      }
      if (element.classList?.contains('drawio-viewer__container')) {
        const root = element.closest<HTMLElement>('.drawio-viewer')
        if (root?.style.height.endsWith('%')) return 0
        return parseInt(root?.style.height || '0', 10) || 0
      }
      return 0
    })
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      value: vi.fn(() => ({
        x: 0,
        y: 0,
        width: 400,
        height: 200,
      }) as DOMRect),
      configurable: true,
    })

    window.GraphViewer = {
      processElements: vi.fn(() => {
        document.querySelectorAll('.mxgraph').forEach(element => {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
          svg.appendChild(group)
          element.appendChild(svg)
        })
      }),
    }

    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(DrawioViewer, {
      src: '/demo.drawio',
      height: '100%',
      minHeight: 0,
    })
    app.mount(host)

    await waitForDrawioRender()

    const viewer = host.querySelector<HTMLElement>('.drawio-viewer')
    const svg = host.querySelector<SVGSVGElement>('.drawio-viewer svg')
    const group = host.querySelector<SVGGElement>('.drawio-viewer svg g')

    expect(fetchSpy).toHaveBeenCalledWith('./demo.drawio')
    expect(viewer?.style.height).toBe('200px')
    expect(svg).not.toBeNull()
    expect(group?.getAttribute('transform')).toBe('translate(0, 0) scale(1)')

    app.unmount()
    host.remove()
    widthSpy.mockRestore()
    heightSpy.mockRestore()
  })
})
