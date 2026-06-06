/**
 * 文件用途：验证 Mermaid 渲染器不会用内部默认高度覆盖外部 Tailwind class。
 *
 * @vitest-environment jsdom
 */

import { createApp, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import MermaidViewer from './MermaidViewer.vue'

describe('MermaidViewer', () => {
  it('应允许外部 class 控制容器高度和最小高度', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(MermaidViewer, {
      class: 'w-full h-96 min-h-56 rounded-lg',
    })
    app.mount(host)
    await nextTick()

    const viewer = host.querySelector<HTMLElement>('.mermaid-viewer')
    expect(viewer).toBeTruthy()
    expect(viewer?.classList.contains('h-96')).toBe(true)
    expect(viewer?.classList.contains('min-h-56')).toBe(true)
    expect(viewer?.style.height).toBe('')
    expect(window.getComputedStyle(viewer!).minHeight).not.toBe('200px')

    app.unmount()
    host.remove()
  })

  it('放大预览尺寸应与 DrawioViewer 保持一致', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(MermaidViewer, {
      previewEnabled: true,
    })
    app.mount(host)
    await nextTick()

    host.querySelector<HTMLElement>('.mermaid-viewer')?.click()
    await nextTick()
    await nextTick()

    const previewPanel = document.body.querySelector<HTMLElement>('.cursor-zoom-out')
    expect(previewPanel?.style.width).toBe('calc(100vw - 24px)')
    expect(previewPanel?.style.height).toBe('calc(100vh - 24px)')

    app.unmount()
    host.remove()
    document.body.querySelector('.fixed.inset-0')?.remove()
  })
})
