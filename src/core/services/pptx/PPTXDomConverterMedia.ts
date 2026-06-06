/**
 * 文件用途：封装 PPTX DOM 转换里的媒体、背景图、截图与 SVG/canvas 导出逻辑。
 */

import type {
  PptxExportReportItem,
  PptxReportItemResult,
  PptxReportSourceType,
} from '@/core/types/pptx-export'
import type { PPTXSvgSerializer } from '@/core/services/pptx/PPTXSvgSerializer'
import type {
  ElementBox,
  ImageSizingOptions,
  PptxPageConvertOptions,
  VisitContext,
} from '@/core/services/pptx/PPTXDomConverter.types'
import { MEDIA_SELECTORS } from '@/core/services/pptx/PPTXDomConverter.types'
import type { PPTXDomConverterLayout } from '@/core/services/pptx/PPTXDomConverterLayout'

export interface PptxDomMediaExportHost {
  options: PptxPageConvertOptions
  buildPptObjectMeta: (
    context: VisitContext,
    role: string,
    label: string,
    includeAltText?: boolean,
  ) => Record<string, unknown>
  addReportItem: (
    sourceType: PptxReportSourceType,
    result: PptxReportItemResult,
    editable: boolean,
    label: string,
    reason?: string,
    context?: VisitContext,
  ) => PptxExportReportItem
  addSkippedItem: (
    sourceType: PptxReportSourceType,
    label: string,
    reason: string,
    context?: VisitContext,
  ) => void
}

/**
 * PPTX 媒体导出 helper。
 */
export class PPTXDomConverterMedia {
  constructor(
    private readonly layout: PPTXDomConverterLayout,
    private readonly svgSerializer: PPTXSvgSerializer,
  ) {}

  /**
   * 判断元素是否属于媒体或复杂渲染组件。
   * @param element 候选元素
   */
  isMediaElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase()
    return element.matches(MEDIA_SELECTORS) ||
      tagName === 'img' ||
      tagName === 'svg' ||
      tagName === 'canvas' ||
      tagName === 'video'
  }

  /**
   * 添加媒体、SVG、canvas、视频封面或局部截图。
   * @param host 导出宿主能力
   * @param element 媒体元素
   * @param context 当前组合上下文
   */
  async addMediaElement(host: PptxDomMediaExportHost, element: Element, context: VisitContext): Promise<void> {
    const sourceType = this.resolveMediaSourceType(element)
    const label = this.layout.buildElementLabel(element)

    if (this.isSvgBasedSource(sourceType, element)) {
      const svg = this.findRenderableSvg(element)
      if (svg) {
        this.addSvgBlock(host, svg, element, sourceType, label, context)
        return
      }
      await this.addScreenshotBlock(host, element, sourceType, '未找到可序列化 SVG，降级为局部截图', context)
      return
    }

    if (sourceType === 'chart') {
      const svg = this.findRenderableSvg(element)
      if (svg) {
        this.addSvgBlock(host, svg, element, sourceType, label, context)
        return
      }

      const canvas = element.querySelector?.('canvas') ?? (element instanceof HTMLCanvasElement ? element : null)
      if (canvas instanceof HTMLCanvasElement && this.addCanvasBlock(host, canvas, element, sourceType, label, context)) {
        return
      }

      await this.addScreenshotBlock(host, element, sourceType, 'ECharts 未提供 SVG 或 canvas，降级为局部截图', context)
      return
    }

    if (sourceType === 'canvas' && element instanceof HTMLCanvasElement) {
      if (!this.addCanvasBlock(host, element, element, sourceType, label, context)) {
        host.addSkippedItem(sourceType, label, 'canvas 像素为空或无法读取', context)
      }
      return
    }

    if (sourceType === 'video') {
      await this.addVideoBlock(host, element, label, context)
      return
    }

    const image = element instanceof HTMLImageElement ? element : element.querySelector?.('img')
    if (image instanceof HTMLImageElement && await this.addImagePathBlock(host, image.currentSrc || image.src, element, sourceType, label, context)) {
      return
    }

    await this.addScreenshotBlock(host, element, sourceType, '未找到可直接导出的图片资源，降级为局部截图', context)
  }

  /**
   * 将简单 CSS background-image: url(...) 导出为 PPT 图片块。
   * @param host 导出宿主能力
   * @param element 背景图元素
   * @param context 当前组合上下文
   */
  async addBackgroundImageElement(
    host: PptxDomMediaExportHost,
    element: HTMLElement,
    context: VisitContext,
  ): Promise<boolean> {
    const style = window.getComputedStyle(element)
    const backgroundUrl = this.extractSingleBackgroundImageUrl(style.backgroundImage)
    if (!backgroundUrl) {
      return false
    }

    const label = this.layout.buildElementLabel(element)
    if (backgroundUrl.startsWith('data:image/')) {
      this.addImageDataBlock(host, backgroundUrl, element, 'image', label, 'CSS 背景图导出为图片块', context)
      return true
    }

    return this.addImagePathBlock(host, backgroundUrl, element, 'image', label, context, 'CSS 背景图导出为图片块')
  }

  /**
   * 添加视频封面图；没有封面时尝试当前帧，最后降级为截图。
   * @param host 导出宿主能力
   * @param element 视频或视频容器
   * @param label 对象摘要
   * @param context 当前组合上下文
   */
  private async addVideoBlock(
    host: PptxDomMediaExportHost,
    element: Element,
    label: string,
    context: VisitContext,
  ): Promise<void> {
    const video = element instanceof HTMLVideoElement ? element : element.querySelector?.('video')
    if (!(video instanceof HTMLVideoElement)) {
      await this.addScreenshotBlock(host, element, 'video', '未找到 video 元素，降级为局部截图', context)
      return
    }

    const poster = video.getAttribute('poster') || video.poster
    if (poster && await this.addImagePathBlock(host, poster, element, 'video', label, context, '视频封面图导出为图片块')) {
      return
    }

    try {
      const canvas = document.createElement('canvas')
      const rect = this.layout.measureElementPixels(video)
      canvas.width = Math.max(1, Math.round(rect.width))
      canvas.height = Math.max(1, Math.round(rect.height))
      const canvasContext = canvas.getContext('2d')
      if (!canvasContext) {
        throw new Error('无法创建视频帧 canvas')
      }
      canvasContext.drawImage(video, 0, 0, canvas.width, canvas.height)
      this.addImageDataBlock(host, canvas.toDataURL('image/png'), element, 'video', label, '视频当前帧导出为图片块', context)
    } catch {
      await this.addScreenshotBlock(host, element, 'video', '视频无封面且当前帧不可读取，降级为局部截图', context)
    }
  }

  /**
   * 判断当前媒体类型是否应优先导出为 SVG。
   * @param sourceType 源类型
   * @param element 源元素
   */
  private isSvgBasedSource(sourceType: PptxReportSourceType, element: Element): boolean {
    return sourceType === 'svg' ||
      sourceType === 'mermaid' ||
      sourceType === 'drawio' ||
      sourceType === 'formula' ||
      element.tagName.toLowerCase() === 'svg'
  }

  /**
   * 将 SVG 添加为 PPT 图片块。
   * @param host 导出宿主能力
   * @param svg SVG 元素
   * @param element 源元素
   * @param sourceType 源类型
   * @param label 对象摘要
   * @param context 当前组合上下文
   */
  private addSvgBlock(
    host: PptxDomMediaExportHost,
    svg: SVGSVGElement,
    element: Element,
    sourceType: PptxReportSourceType,
    label: string,
    context: VisitContext,
  ): void {
    const data = this.svgSerializer.svgToDataUrl(svg)
    this.addImageDataBlock(host, data, element, sourceType, label, 'SVG 作为可移动缩放图片块', context)
  }

  /**
   * 将 canvas 添加为 PNG 图片块。
   * @param host 导出宿主能力
   * @param canvas canvas 元素
   * @param element 源元素
   * @param sourceType 源类型
   * @param label 对象摘要
   * @param context 当前组合上下文
   */
  private addCanvasBlock(
    host: PptxDomMediaExportHost,
    canvas: HTMLCanvasElement,
    element: Element,
    sourceType: PptxReportSourceType,
    label: string,
    context: VisitContext,
  ): boolean {
    if (canvas.width <= 0 || canvas.height <= 0) {
      return false
    }

    try {
      this.addImageDataBlock(host, canvas.toDataURL('image/png'), element, sourceType, label, 'canvas 导出为 PNG 图片块', context)
      return true
    } catch {
      return false
    }
  }

  /**
   * 按 URL 添加图片块。
   * @param host 导出宿主能力
   * @param path 图片 URL
   * @param element 源元素
   * @param sourceType 源类型
   * @param label 对象摘要
   * @param context 当前组合上下文
   * @param reason 报告原因
   */
  private async addImagePathBlock(
    host: PptxDomMediaExportHost,
    path: string,
    element: Element,
    sourceType: PptxReportSourceType,
    label: string,
    context: VisitContext,
    reason = '图片作为可移动缩放图片块',
  ): Promise<boolean> {
    if (!path) {
      return false
    }

    const svgSource = await this.svgSerializer.resolveSvgSource(path)
    if (svgSource) {
      this.addImageDataBlock(
        host,
        this.svgSerializer.svgSourceToDataUrl(svgSource),
        element,
        sourceType === 'image' ? 'svg' : sourceType,
        label,
        'SVG 源文件原样嵌入为可移动缩放图片块',
        context,
      )
      return true
    }

    const box = this.layout.getPptxBox(element)
    if (!box) {
      host.addSkippedItem(sourceType, label, '图片元素尺寸无效', context)
      return true
    }

    host.options.slide.addImage({
      path,
      ...box,
      ...this.buildImageSizing(element, box),
      ...host.buildPptObjectMeta(context, 'image', label, true),
    })
    host.addReportItem(sourceType, 'image', false, label, reason, context)
    return true
  }

  /**
   * 按 data URL 添加图片块。
   * @param host 导出宿主能力
   * @param data 图片 data URL
   * @param element 源元素
   * @param sourceType 源类型
   * @param label 对象摘要
   * @param reason 报告原因
   * @param context 当前组合上下文
   */
  private addImageDataBlock(
    host: PptxDomMediaExportHost,
    data: string,
    element: Element,
    sourceType: PptxReportSourceType,
    label: string,
    reason: string,
    context: VisitContext,
  ): void {
    const box = this.layout.getPptxBox(element)
    if (!box) {
      host.addSkippedItem(sourceType, label, '图片块尺寸无效', context)
      return
    }

    host.options.slide.addImage({
      data,
      ...box,
      ...this.buildImageSizing(element, box),
      ...host.buildPptObjectMeta(context, data.startsWith('data:image/svg') ? 'svg' : 'image', label, true),
    })
    host.addReportItem(sourceType, data.startsWith('data:image/svg') ? 'svg' : 'image', false, label, reason, context)
  }

  /**
   * 添加局部截图块。
   * @param host 导出宿主能力
   * @param element 目标元素
   * @param sourceType 源类型
   * @param reason 降级原因
   * @param context 当前组合上下文
   */
  async addScreenshotBlock(
    host: PptxDomMediaExportHost,
    element: Element,
    sourceType: PptxReportSourceType,
    reason: string,
    context: VisitContext,
  ): Promise<void> {
    if (!(element instanceof HTMLElement)) {
      host.addSkippedItem(sourceType, this.layout.buildElementLabel(element), '非 HTML 元素无法局部截图', context)
      return
    }

    const box = this.layout.getPptxBox(element)
    const label = this.layout.buildElementLabel(element)
    if (!box) {
      host.addSkippedItem(sourceType, label, '截图元素尺寸无效', context)
      return
    }

    try {
      const data = await host.options.captureElementAsPng(element)
      host.options.slide.addImage({
        data,
        ...box,
        ...this.buildImageSizing(element, box),
        ...host.buildPptObjectMeta(context, 'screenshot', label, true),
      })
      host.addReportItem(sourceType, 'screenshot', false, label, reason, context)
    } catch (error) {
      host.addSkippedItem(
        sourceType,
        label,
        `局部截图失败：${error instanceof Error ? error.message : '未知错误'}`,
        context,
      )
    }
  }

  /**
   * 根据图片元素样式构造 PPTX 图片缩放策略。
   * @param element 图片或图片容器
   * @param box PPTX 位置尺寸
   */
  private buildImageSizing(element: Element, box: ElementBox): { sizing?: ImageSizingOptions } {
    const image = element instanceof HTMLImageElement ? element : element.querySelector?.('img')
    if (!(image instanceof HTMLElement)) {
      if (element instanceof HTMLElement) {
        const style = window.getComputedStyle(element)
        if (style.backgroundSize === 'contain' || style.backgroundSize === 'cover') {
          return {
            sizing: {
              type: style.backgroundSize,
              w: box.w,
              h: box.h,
            },
          }
        }
      }
      return {}
    }

    const style = window.getComputedStyle(image)
    if (style.objectFit !== 'contain' && style.objectFit !== 'cover') {
      return {}
    }

    return {
      sizing: {
        type: style.objectFit,
        w: box.w,
        h: box.h,
      },
    }
  }

  /**
   * 从 CSS background-image 中提取单个 url。
   * @param value background-image 值
   */
  private extractSingleBackgroundImageUrl(value: string): string {
    const normalized = String(value || '').trim()
    if (!normalized || normalized === 'none' || normalized.includes('gradient(')) {
      return ''
    }

    const match = /^url\(\s*(?:"([^"]+)"|'([^']+)'|([^'")]+))\s*\)$/i.exec(normalized)
    if (!match) {
      return ''
    }

    return (match[1] || match[2] || match[3] || '').trim()
  }

  /**
   * 查找元素内可序列化的 SVG。
   * @param element 源元素
   */
  private findRenderableSvg(element: Element): SVGSVGElement | null {
    if (element instanceof SVGSVGElement) {
      return element
    }
    return element.querySelector?.('svg') as SVGSVGElement | null
  }

  /**
   * 解析媒体源类型。
   * @param element 源元素
   */
  private resolveMediaSourceType(element: Element): PptxReportSourceType {
    if (element.matches('.mermaid-viewer')) return 'mermaid'
    if (element.matches('.drawio-viewer')) return 'drawio'
    if (element.matches('.latex-viewer')) return 'formula'
    if (element.matches('.echarts-viewer')) return 'chart'
    if (element.matches('.video-viewer') || element.tagName.toLowerCase() === 'video') return 'video'
    if (element.tagName.toLowerCase() === 'canvas') return 'canvas'
    if (element.tagName.toLowerCase() === 'svg') return 'svg'
    if (element.matches('.image-viewer') || element.tagName.toLowerCase() === 'img') return 'image'
    return 'unknown'
  }
}
