/**
 * 文件用途：验证 LaTeX 渲染组件的默认布局行为，避免公式预览偏离原有居中策略。
 *
 * @vitest-environment jsdom
 */

import { createApp, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import LatexViewer from './LatexViewer.vue'

describe('LatexViewer', () => {
  it('默认应按内容宽度收缩，由外层自动边距完成整体居中', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const app = createApp(LatexViewer, { content: '' })
    app.mount(host)
    await nextTick()

    const viewer = host.querySelector<HTMLElement>('.latex-viewer')
    expect(viewer?.style.width).toBe('fit-content')

    app.unmount()
    host.remove()
  })
})
