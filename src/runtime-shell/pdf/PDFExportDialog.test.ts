// @vitest-environment jsdom

/**
 * 文件用途：验证 PDF 导出弹窗对截图导出与浏览器打印两种生成方式的分发逻辑。
 */

import { createApp, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PDFExportDialog from './PDFExportDialog.vue'

const serviceSpies = vi.hoisted(() => ({
  exportCurrentPage: vi.fn(),
  exportAllPages: vi.fn(),
  printCurrentPage: vi.fn(),
  printAllPages: vi.fn(),
  exportPptxCurrentPage: vi.fn(),
  exportPptxAllPages: vi.fn(),
  cancelExport: vi.fn(),
  cancelPrint: vi.fn(),
  cancelPptxExport: vi.fn(),
  setPdfRouter: vi.fn(),
  setPrintRouter: vi.fn(),
  setPptxRouter: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    currentRoute: {
      value: {
        fullPath: '/',
      },
    },
  }),
}))

vi.mock('@/core/services/PDFExportService', () => ({
  pdfExportService: {
    exportCurrentPage: serviceSpies.exportCurrentPage,
    exportAllPages: serviceSpies.exportAllPages,
    cancelExport: serviceSpies.cancelExport,
    setRouter: serviceSpies.setPdfRouter,
  },
}))

vi.mock('@/core/services/BrowserPrintService', () => ({
  browserPrintService: {
    printCurrentPage: serviceSpies.printCurrentPage,
    printAllPages: serviceSpies.printAllPages,
    cancelPrint: serviceSpies.cancelPrint,
    setRouter: serviceSpies.setPrintRouter,
  },
}))

vi.mock('@/core/services/PPTXExportService', () => ({
  pptxExportService: {
    exportCurrentPage: serviceSpies.exportPptxCurrentPage,
    exportAllPages: serviceSpies.exportPptxAllPages,
    cancelExport: serviceSpies.cancelPptxExport,
    setRouter: serviceSpies.setPptxRouter,
  },
}))

function mountDialog() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(PDFExportDialog, {
    visible: true,
  })
  app.mount(host)

  return {
    app,
    host,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('PDFExportDialog', () => {
  it('默认使用当前截图导出并保留文件名输入', async () => {
    serviceSpies.exportCurrentPage.mockResolvedValue({
      success: true,
      taskId: 'pdf-task',
      method: 'canvas-pdf',
      filename: 'demo.pdf',
      pageCount: 1,
      duration: 10,
    })
    const { app, host } = mountDialog()
    await nextTick()

    expect(host.querySelector('#filename')).not.toBeNull()

    const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('开始导出')) as HTMLButtonElement
    button.click()
    await nextTick()
    await nextTick()

    expect(serviceSpies.exportCurrentPage).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'current',
      method: 'canvas-pdf',
    }))
    expect(serviceSpies.printCurrentPage).not.toHaveBeenCalled()

    app.unmount()
  })

  it('选择浏览器打印后隐藏文件名输入并调用打印服务', async () => {
    serviceSpies.printCurrentPage.mockResolvedValue({
      success: true,
      taskId: 'print-task',
      method: 'browser-print',
      pageCount: 1,
      duration: 10,
      message: '已打开浏览器打印对话框，请选择“保存为 PDF”。',
    })
    const { app, host } = mountDialog()
    await nextTick()

    const printRadio = host.querySelector('input[value="browser-print"]') as HTMLInputElement
    printRadio.checked = true
    printRadio.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()

    expect(host.querySelector('#filename')).toBeNull()
    expect(host.textContent).toContain('文件名由打印对话框决定')

    const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('打开打印')) as HTMLButtonElement
    button.click()
    await nextTick()
    await nextTick()

    expect(serviceSpies.printCurrentPage).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'current',
      method: 'browser-print',
    }))
    expect(serviceSpies.exportCurrentPage).not.toHaveBeenCalled()

    app.unmount()
  })

  it('选择可编辑 PPTX 后调用 PPTX 服务并展示报告', async () => {
    serviceSpies.exportPptxCurrentPage.mockResolvedValue({
      success: true,
      taskId: 'pptx-task',
      method: 'pptx-editable',
      filename: 'demo.pptx',
      pageCount: 1,
      duration: 20,
      report: {
        summary: {
          editableText: 2,
          editableShape: 1,
          imageBlock: 1,
          svgBlock: 1,
          screenshotBlock: 1,
          skipped: 0,
        },
        pages: [
          {
            pageIndex: 1,
            pageTitle: '第一页',
            pageRoute: '/page-1',
            items: [
              {
                pageIndex: 1,
                pageTitle: '第一页',
                pageRoute: '/page-1',
                sourceType: 'complex-css',
                result: 'screenshot',
                editable: false,
                label: 'section.card',
                reason: '复杂 CSS 容器降级为局部截图',
              },
            ],
          },
        ],
      },
    })
    const { app, host } = mountDialog()
    await nextTick()

    const pptxRadio = host.querySelector('input[value="pptx-editable"]') as HTMLInputElement
    pptxRadio.checked = true
    pptxRadio.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()

    expect(host.querySelector('#filename')).not.toBeNull()

    const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('开始导出')) as HTMLButtonElement
    button.click()
    await nextTick()
    await nextTick()
    await nextTick()

    expect(serviceSpies.exportPptxCurrentPage).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'current',
    }))
    expect(serviceSpies.exportCurrentPage).not.toHaveBeenCalled()
    expect(serviceSpies.printCurrentPage).not.toHaveBeenCalled()
    expect(host.textContent).toContain('PPTX 导出报告')
    expect(host.textContent).toContain('可编辑文本')
    expect(host.textContent).toContain('复杂 CSS 容器降级为局部截图')

    app.unmount()
  })
})
