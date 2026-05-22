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
  cancelExport: vi.fn(),
  cancelPrint: vi.fn(),
  setPdfRouter: vi.fn(),
  setPrintRouter: vi.fn(),
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
})
