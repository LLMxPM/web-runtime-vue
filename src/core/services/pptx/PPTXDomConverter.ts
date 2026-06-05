/**
 * 文件用途：将运行时页面 DOM 启发式转换为 PPTX 文本、形状、图片与截图块。
 */

import type {
  PptxExportReportItem,
  PptxExportReportPage,
  PptxReportItemResult,
  PptxReportSourceType,
} from '@/core/types/pptx-export'
import { PPTXCssParser, type ParsedColor, type PptxBorderSide } from '@/core/services/pptx/PPTXCssParser'
import { PPTXSvgSerializer } from '@/core/services/pptx/PPTXSvgSerializer'

type PptxSlideLike = {
  addText: (text: string, options?: Record<string, unknown>) => unknown
  addShape: (shapeType: string, options?: Record<string, unknown>) => unknown
  addImage: (options: Record<string, unknown>) => unknown
  background?: unknown
}

export interface PptxShapeTypes {
  rect: string
  roundRect: string
  line: string
}

export interface PptxPageConvertOptions {
  /** PPTX slide 对象 */
  slide: PptxSlideLike
  /** 页面源节点 */
  pageElement: HTMLElement
  /** 页面序号，从 1 开始 */
  pageIndex: number
  /** 页面标题 */
  pageTitle: string
  /** 页面路由 */
  pageRoute: string
  /** 设计画布宽度，单位 px */
  pageWidthPx: number
  /** 设计画布高度，单位 px */
  pageHeightPx: number
  /** slide 宽度，单位 inch */
  slideWidthIn: number
  /** slide 高度，单位 inch */
  slideHeightIn: number
  /** PPTX 形状枚举值 */
  shapeTypes: PptxShapeTypes
  /** 局部截图函数，返回 PNG data URL */
  captureElementAsPng: (element: HTMLElement) => Promise<string>
  /** 收集需要写入 PPTX XML 的原生渐变填充指令 */
  gradientFillCollector?: (instruction: PptxGradientFillInstruction) => void
}

interface ElementBox {
  x: number
  y: number
  w: number
  h: number
}

interface MeasuredElementBox {
  left: number
  top: number
  width: number
  height: number
}

interface BorderInfo {
  color: ParsedColor
  side: PptxBorderSide
  style: string
  widthPx: number
  widthPt: number
  dashType: string
}

interface ElementPadding {
  top: number
  right: number
  bottom: number
  left: number
}

interface ImageSizingOptions {
  type: 'contain' | 'cover'
  w: number
  h: number
}

type LinearGradientDirection = 'right' | 'left' | 'bottom' | 'top'

interface LinearGradientStop {
  color: ParsedColor
  position: number
}

interface LinearGradientInfo {
  direction: LinearGradientDirection
  stops: LinearGradientStop[]
}

export interface PptxGradientFillInstruction extends LinearGradientInfo {
  /** 目标页码，从 1 开始，对应 ppt/slides/slideN.xml */
  pageIndex: number
  /** PPT 形状对象名，用于写文件前定位 XML 节点 */
  objectName: string
}

interface VisitContext {
  groupId?: string
  parentGroupId?: string
  groupDepth: number
  groupLabel?: string
  inheritedTextAlign?: string
  inheritedVerticalAlign?: string
}

const MEDIA_SELECTORS = [
  '.mermaid-viewer',
  '.drawio-viewer',
  '.latex-viewer',
  '.echarts-viewer',
  '.video-viewer',
  '.image-viewer',
].join(',')

const INLINE_TEXT_TAGS = new Set([
  'a',
  'b',
  'code',
  'em',
  'i',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
])

/**
 * DOM 到 PPTX 的启发式转换器。
 */
export class PPTXDomConverter {
  private readonly cssParser = new PPTXCssParser()
  private readonly svgSerializer = new PPTXSvgSerializer(this.cssParser, element => this.measureElementPixels(element))
  private options!: PptxPageConvertOptions
  private reportPage!: PptxExportReportPage
  private rootBox!: { left: number; top: number; width: number; height: number }
  private groupSequence = 0
  private gradientSequence = 0

  /**
   * 转换单个页面。
   * @param options 页面转换上下文
   * @returns 当前页导出报告
   */
  async convertPage(options: PptxPageConvertOptions): Promise<PptxExportReportPage> {
    this.options = options
    this.reportPage = {
      pageIndex: options.pageIndex,
      pageTitle: options.pageTitle,
      pageRoute: options.pageRoute,
      items: [],
    }
    this.rootBox = this.measureRootBox(options.pageElement)
    this.groupSequence = 0
    this.gradientSequence = 0

    this.applySlideBackground(options.pageElement)

    const rootContext: VisitContext = {
      groupDepth: 0,
    }
    for (const child of Array.from(options.pageElement.children)) {
      await this.visitElement(child, rootContext)
    }

    return this.reportPage
  }

  /**
   * 递归访问元素并按优先级转换。
   * @param element 当前元素
   * @param context 当前 HTML 容器组合上下文
   */
  private async visitElement(element: Element, context: VisitContext): Promise<void> {
    if (!this.isVisibleElement(element)) {
      return
    }

    if (this.isMediaElement(element)) {
      await this.addMediaElement(element, context)
      return
    }

    if (element instanceof HTMLElement && await this.addBackgroundImageElement(element, context)) {
      return
    }

    if (element instanceof HTMLElement && this.addLinearGradientElement(element, context)) {
      return
    }

    if (element instanceof HTMLElement && this.shouldScreenshotComplexElement(element)) {
      await this.addScreenshotBlock(element, 'complex-css', '复杂 CSS 容器降级为局部截图', context)
      return
    }

    const textContext = element instanceof HTMLElement
      ? this.createTextInheritanceContext(element, context)
      : context
    const shouldAddShape = element instanceof HTMLElement && this.shouldAddShape(element)
    const shouldAddWholeText = element instanceof HTMLElement && this.shouldAddText(element)
    const shouldAddTextShape = element instanceof HTMLElement &&
      shouldAddWholeText &&
      (shouldAddShape || this.shouldPreservePaddedInlineTextBox(element, window.getComputedStyle(element)))
    const elementContext = element instanceof HTMLElement && this.shouldCreateCompositionGroup(element, shouldAddShape, shouldAddWholeText)
      ? this.createGroupContext(element, textContext)
      : textContext

    if (
      element instanceof HTMLElement &&
      shouldAddTextShape &&
      this.addTextShapeElement(element, elementContext)
    ) {
      return
    }

    if (element instanceof HTMLElement && shouldAddShape) {
      this.addShapeElement(element, elementContext)
    }

    if (element instanceof HTMLElement && shouldAddWholeText) {
      this.addTextElement(element, elementContext)
      return
    }

    for (const child of Array.from(element.children)) {
      await this.visitElement(child, elementContext)
    }
  }

  /**
   * 使用页面根背景设置 slide 背景。
   * @param pageElement 页面根元素
   */
  private applySlideBackground(pageElement: HTMLElement): void {
    const style = window.getComputedStyle(pageElement)
    const backgroundColor = this.parseCssColor(this.resolveBackgroundColorValue(pageElement, style), pageElement)
    if (backgroundColor) {
      this.options.slide.background = {
        color: backgroundColor.hex,
        transparency: this.alphaToTransparency(backgroundColor.alpha),
      }
    }
  }

  /**
   * 判断元素是否属于媒体或复杂渲染组件。
   * @param element 候选元素
   */
  private isMediaElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase()
    return element.matches(MEDIA_SELECTORS) ||
      tagName === 'img' ||
      tagName === 'svg' ||
      tagName === 'canvas' ||
      tagName === 'video'
  }

  /**
   * 添加媒体、SVG、canvas、视频封面或局部截图。
   * @param element 媒体元素
   */
  private async addMediaElement(element: Element, context: VisitContext): Promise<void> {
    const sourceType = this.resolveMediaSourceType(element)
    const label = this.buildElementLabel(element)

    if (this.isSvgBasedSource(sourceType, element)) {
      const svg = this.findRenderableSvg(element)
      if (svg) {
        this.addSvgBlock(svg, element, sourceType, label, context)
        return
      }
      await this.addScreenshotBlock(element, sourceType, '未找到可序列化 SVG，降级为局部截图', context)
      return
    }

    if (sourceType === 'chart') {
      const svg = this.findRenderableSvg(element)
      if (svg) {
        this.addSvgBlock(svg, element, sourceType, label, context)
        return
      }

      const canvas = element.querySelector?.('canvas') ?? (element instanceof HTMLCanvasElement ? element : null)
      if (canvas instanceof HTMLCanvasElement && this.addCanvasBlock(canvas, element, sourceType, label, context)) {
        return
      }

      await this.addScreenshotBlock(element, sourceType, 'ECharts 未提供 SVG 或 canvas，降级为局部截图', context)
      return
    }

    if (sourceType === 'canvas' && element instanceof HTMLCanvasElement) {
      if (!this.addCanvasBlock(element, element, sourceType, label, context)) {
        this.addSkippedItem(sourceType, label, 'canvas 像素为空或无法读取', context)
      }
      return
    }

    if (sourceType === 'video') {
      await this.addVideoBlock(element, label, context)
      return
    }

    const image = element instanceof HTMLImageElement
      ? element
      : element.querySelector?.('img')
    if (image instanceof HTMLImageElement && await this.addImagePathBlock(image.currentSrc || image.src, element, sourceType, label, context)) {
      return
    }

    await this.addScreenshotBlock(element, sourceType, '未找到可直接导出的图片资源，降级为局部截图', context)
  }

  /**
   * 添加视频封面图；没有封面时尝试当前帧，最后降级为截图。
   * @param element 视频或视频容器
   * @param label 对象摘要
   */
  private async addVideoBlock(element: Element, label: string, context: VisitContext): Promise<void> {
    const video = element instanceof HTMLVideoElement
      ? element
      : element.querySelector?.('video')
    if (!(video instanceof HTMLVideoElement)) {
      await this.addScreenshotBlock(element, 'video', '未找到 video 元素，降级为局部截图', context)
      return
    }

    const poster = video.getAttribute('poster') || video.poster
    if (poster && await this.addImagePathBlock(poster, element, 'video', label, context, '视频封面图导出为图片块')) {
      return
    }

    try {
      const canvas = document.createElement('canvas')
      const rect = this.measureElementPixels(video)
      canvas.width = Math.max(1, Math.round(rect.width))
      canvas.height = Math.max(1, Math.round(rect.height))
      const canvasContext = canvas.getContext('2d')
      if (!canvasContext) {
        throw new Error('无法创建视频帧 canvas')
      }
      canvasContext.drawImage(video, 0, 0, canvas.width, canvas.height)
      this.addImageDataBlock(canvas.toDataURL('image/png'), element, 'video', label, '视频当前帧导出为图片块', context)
    } catch {
      await this.addScreenshotBlock(element, 'video', '视频无封面且当前帧不可读取，降级为局部截图', context)
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
   * @param svg SVG 元素
   * @param sourceType 源类型
   * @param label 对象摘要
   */
  private addSvgBlock(
    svg: SVGSVGElement,
    element: Element,
    sourceType: PptxReportSourceType,
    label: string,
    context: VisitContext,
  ): void {
    const data = this.svgSerializer.svgToDataUrl(svg)
    this.addImageDataBlock(data, element, sourceType, label, 'SVG 作为可移动缩放图片块', context)
  }

  /**
   * 将 canvas 添加为 PNG 图片块。
   * @param canvas canvas 元素
   * @param sourceType 源类型
   * @param label 对象摘要
   */
  private addCanvasBlock(
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
      this.addImageDataBlock(canvas.toDataURL('image/png'), element, sourceType, label, 'canvas 导出为 PNG 图片块', context)
      return true
    } catch {
      return false
    }
  }

  /**
   * 按 URL 添加图片块。
   * @param path 图片 URL
   * @param sourceType 源类型
   * @param label 对象摘要
   * @param reason 报告原因
   */
  private async addImagePathBlock(
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
        this.svgSerializer.svgSourceToDataUrl(svgSource),
        element,
        sourceType === 'image' ? 'svg' : sourceType,
        label,
        'SVG 源文件原样嵌入为可移动缩放图片块',
        context,
      )
      return true
    }

    const box = this.getPptxBox(element)
    if (!box) {
      this.addSkippedItem(sourceType, label, '图片元素尺寸无效', context)
      return true
    }

    this.options.slide.addImage({
      path,
      ...box,
      ...this.buildImageSizing(element, box),
      ...this.buildPptObjectMeta(context, 'image', label, true),
    })
    this.addReportItem(sourceType, 'image', false, label, reason, context)
    return true
  }

  /**
   * 按 data URL 添加图片块。
   * @param data 图片 data URL
   * @param sourceType 源类型
   * @param label 对象摘要
   * @param reason 报告原因
   */
  private addImageDataBlock(
    data: string,
    element: Element,
    sourceType: PptxReportSourceType,
    label: string,
    reason: string,
    context: VisitContext,
  ): void {
    const box = this.getPptxBox(element)
    if (!box) {
      this.addSkippedItem(sourceType, label, '图片块尺寸无效', context)
      return
    }

    this.options.slide.addImage({
      data,
      ...box,
      ...this.buildImageSizing(element, box),
      ...this.buildPptObjectMeta(context, data.startsWith('data:image/svg') ? 'svg' : 'image', label, true),
    })
    this.addReportItem(sourceType, data.startsWith('data:image/svg') ? 'svg' : 'image', false, label, reason, context)
  }

  /**
   * 添加局部截图块。
   * @param element 目标元素
   * @param sourceType 源类型
   * @param reason 降级原因
   */
  private async addScreenshotBlock(
    element: Element,
    sourceType: PptxReportSourceType,
    reason: string,
    context: VisitContext,
  ): Promise<void> {
    if (!(element instanceof HTMLElement)) {
      this.addSkippedItem(sourceType, this.buildElementLabel(element), '非 HTML 元素无法局部截图', context)
      return
    }

    const box = this.getPptxBox(element)
    const label = this.buildElementLabel(element)
    if (!box) {
      this.addSkippedItem(sourceType, label, '截图元素尺寸无效', context)
      return
    }

    try {
      const data = await this.options.captureElementAsPng(element)
      this.options.slide.addImage({
        data,
        ...box,
        ...this.buildImageSizing(element, box),
        ...this.buildPptObjectMeta(context, 'screenshot', label, true),
      })
      this.addReportItem(sourceType, 'screenshot', false, label, reason, context)
    } catch (error) {
      this.addSkippedItem(
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
    const image = element instanceof HTMLImageElement
      ? element
      : element.querySelector?.('img')
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
   * 解析线性渐变，仅支持单个 linear-gradient。
   * @param value background-image 值
   * @param element CSS 变量解析上下文
   */
  private parseLinearGradient(value: string, element: HTMLElement): LinearGradientInfo | null {
    const normalized = String(value || '').trim()
    const match = /^linear-gradient\((.*)\)$/i.exec(normalized)
    if (!match) {
      return null
    }

    const parts = this.splitCssTopLevel(match[1], ',').map(part => part.trim()).filter(Boolean)
    if (parts.length < 2) {
      return null
    }

    let direction: LinearGradientDirection = 'bottom'
    let stopParts = parts
    const firstStop = this.parseLinearGradientStop(parts[0], element)
    if (!firstStop) {
      const parsedDirection = this.parseLinearGradientDirection(parts[0])
      if (!parsedDirection) {
        return null
      }
      direction = parsedDirection
      stopParts = parts.slice(1)
    }

    const stops = stopParts
      .map(part => this.parseLinearGradientStop(part, element))
      .filter((stop): stop is { color: ParsedColor; position?: number } => Boolean(stop))
    if (stops.length < 2) {
      return null
    }

    return {
      direction,
      stops: this.normalizeLinearGradientStops(stops),
    }
  }

  /**
   * 解析 linear-gradient 方向。
   * @param value 方向片段
   */
  private parseLinearGradientDirection(value: string): LinearGradientDirection | '' {
    const normalized = value.trim().toLowerCase()
    if (normalized.startsWith('to ')) {
      const direction = normalized.slice(3).trim()
      if (['right', 'left', 'bottom', 'top'].includes(direction)) {
        return direction as LinearGradientDirection
      }
      return ''
    }

    if (!normalized.endsWith('deg')) {
      return ''
    }

    const angle = ((Number.parseFloat(normalized) % 360) + 360) % 360
    if (Math.abs(angle - 90) <= 1) return 'right'
    if (Math.abs(angle - 270) <= 1) return 'left'
    if (Math.abs(angle - 180) <= 1) return 'bottom'
    if (angle <= 1 || Math.abs(angle - 360) <= 1) return 'top'
    return ''
  }

  /**
   * 解析单个 linear-gradient 颜色停靠点。
   * @param value 停靠点片段
   * @param element CSS 变量解析上下文
   */
  private parseLinearGradientStop(
    value: string,
    element: HTMLElement,
  ): { color: ParsedColor; position?: number } | null {
    const colorEnd = this.findCssColorStopEnd(value)
    if (colorEnd <= 0) {
      return null
    }

    const colorText = value.slice(0, colorEnd).trim()
    const color = colorText.toLowerCase() === 'transparent'
      ? { hex: '000000', alpha: 0 }
      : this.parseCssColor(colorText, element)
    if (!color) {
      return null
    }

    const rest = value.slice(colorEnd).trim()
    const positionToken = rest.split(/\s+/).find(token => token.endsWith('%') || /^-?\d*\.?\d+$/.test(token))
    return {
      color,
      position: positionToken ? this.parseGradientPosition(positionToken) : undefined,
    }
  }

  /**
   * 查找颜色停靠点里颜色值的结束位置。
   * @param value 停靠点片段
   */
  private findCssColorStopEnd(value: string): number {
    const trimmed = value.trimStart()
    const leadingOffset = value.length - trimmed.length
    const functionMatch = /^[a-z-]+\(/i.exec(trimmed)
    if (functionMatch) {
      const openIndex = leadingOffset + functionMatch[0].length - 1
      const closeIndex = this.findClosingParenthesis(value, openIndex)
      return closeIndex >= 0 ? closeIndex + 1 : -1
    }

    const tokenMatch = /^\S+/.exec(trimmed)
    return tokenMatch ? leadingOffset + tokenMatch[0].length : -1
  }

  /**
   * 解析渐变停靠点位置。
   * @param value 百分比或 0-1 数值
   */
  private parseGradientPosition(value: string): number {
    const normalized = String(value || '').trim()
    const parsed = Number.parseFloat(normalized)
    if (!Number.isFinite(parsed)) {
      return 0
    }
    return Math.max(0, Math.min(1, normalized.endsWith('%') || parsed > 1 ? parsed / 100 : parsed))
  }

  /**
   * 补齐渐变停靠点位置，保持位置单调。
   * @param stops 已解析停靠点
   */
  private normalizeLinearGradientStops(stops: Array<{ color: ParsedColor; position?: number }>): LinearGradientStop[] {
    const normalized = stops.map(stop => ({ ...stop }))
    if (normalized[0].position === undefined) {
      normalized[0].position = 0
    }
    const lastIndex = normalized.length - 1
    if (normalized[lastIndex].position === undefined) {
      normalized[lastIndex].position = 1
    }

    let index = 0
    while (index < normalized.length) {
      if (normalized[index].position !== undefined) {
        index += 1
        continue
      }

      const startIndex = index - 1
      let endIndex = index + 1
      while (endIndex < normalized.length && normalized[endIndex].position === undefined) {
        endIndex += 1
      }
      const start = normalized[startIndex].position ?? 0
      const end = normalized[endIndex]?.position ?? start
      const gap = endIndex - startIndex
      for (let fillIndex = index; fillIndex < endIndex; fillIndex += 1) {
        normalized[fillIndex].position = start + (end - start) * ((fillIndex - startIndex) / gap)
      }
      index = endIndex
    }

    let lastPosition = 0
    return normalized.map(stop => {
      const position = Math.max(lastPosition, Math.min(1, stop.position ?? lastPosition))
      lastPosition = position
      return {
        color: stop.color,
        position,
      }
    })
  }

  /**
   * 采样渐变颜色。
   * @param stops 渐变停靠点
   * @param position 0-1 位置
   */
  private sampleLinearGradientColor(stops: LinearGradientStop[], position: number): ParsedColor {
    const current = Math.max(0, Math.min(1, position))
    let left = stops[0]
    let right = stops[stops.length - 1]
    for (let index = 0; index < stops.length - 1; index += 1) {
      if (current >= stops[index].position && current <= stops[index + 1].position) {
        left = stops[index]
        right = stops[index + 1]
        break
      }
    }

    const span = Math.max(0.0001, right.position - left.position)
    const ratio = (current - left.position) / span
    const leftRgb = this.hexToRgb(left.color.hex)
    const rightRgb = this.hexToRgb(right.color.hex)
    return {
      hex: [
        this.interpolateColorChannel(leftRgb.red, rightRgb.red, ratio),
        this.interpolateColorChannel(leftRgb.green, rightRgb.green, ratio),
        this.interpolateColorChannel(leftRgb.blue, rightRgb.blue, ratio),
      ].map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase(),
      alpha: left.color.alpha + (right.color.alpha - left.color.alpha) * ratio,
    }
  }

  /**
   * 十六进制颜色转 RGB。
   * @param hex HEX 颜色
   */
  private hexToRgb(hex: string): { red: number; green: number; blue: number } {
    const normalized = hex.padEnd(6, '0')
    return {
      red: Number.parseInt(normalized.slice(0, 2), 16),
      green: Number.parseInt(normalized.slice(2, 4), 16),
      blue: Number.parseInt(normalized.slice(4, 6), 16),
    }
  }

  /**
   * 插值 RGB 单通道。
   * @param left 左侧颜色通道
   * @param right 右侧颜色通道
   * @param ratio 插值比例
   */
  private interpolateColorChannel(left: number, right: number, ratio: number): number {
    return Math.max(0, Math.min(255, Math.round(left + (right - left) * ratio)))
  }

  /**
   * 按顶层分隔符拆分 CSS 函数参数。
   * @param value CSS 参数
   * @param delimiter 分隔符
   */
  private splitCssTopLevel(value: string, delimiter: string): string[] {
    const parts: string[] = []
    let depth = 0
    let quote = ''
    let start = 0

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index]
      if (quote) {
        if (char === quote && value[index - 1] !== '\\') {
          quote = ''
        }
        continue
      }
      if (char === '"' || char === '\'') {
        quote = char
        continue
      }
      if (char === '(') {
        depth += 1
        continue
      }
      if (char === ')') {
        depth = Math.max(0, depth - 1)
        continue
      }
      if (depth === 0 && char === delimiter) {
        parts.push(value.slice(start, index))
        start = index + 1
      }
    }

    parts.push(value.slice(start))
    return parts
  }

  /**
   * 查找闭合括号位置。
   * @param value 原始字符串
   * @param openIndex 左括号位置
   */
  private findClosingParenthesis(value: string, openIndex: number): number {
    let depth = 0
    let quote = ''
    for (let index = openIndex; index < value.length; index += 1) {
      const char = value[index]
      if (quote) {
        if (char === quote && value[index - 1] !== '\\') {
          quote = ''
        }
        continue
      }
      if (char === '"' || char === '\'') {
        quote = char
        continue
      }
      if (char === '(') {
        depth += 1
        continue
      }
      if (char === ')') {
        depth -= 1
        if (depth === 0) {
          return index
        }
      }
    }
    return -1
  }

  /**
   * 构造 PPT 对象元信息，方便在选择窗格和报告中追踪 HTML 组合。
   * @param context 当前组合上下文
   * @param role PPT 对象角色
   * @param label 对象摘要
   * @param includeAltText 是否写入图片 altText
   */
  private buildPptObjectMeta(
    context: VisitContext,
    role: string,
    label: string,
    includeAltText = false,
  ): Record<string, unknown> {
    if (!context.groupId) {
      return includeAltText ? { altText: label.slice(0, 240) } : {}
    }

    const objectName = this.normalizeObjectName(`${context.groupId}:${role}:${label}`)
    return {
      objectName,
      ...(includeAltText ? { altText: `${context.groupLabel || context.groupId} · ${label}`.slice(0, 240) } : {}),
    }
  }

  /**
   * 判断元素是否应作为一组 HTML 容器对象展开。
   * @param element 当前元素
   * @param hasShape 当前元素是否会生成 shape
   * @param hasWholeText 当前元素是否会生成整体 text
   */
  private shouldCreateCompositionGroup(element: HTMLElement, hasShape: boolean, hasWholeText: boolean): boolean {
    const tagName = element.tagName.toLowerCase()
    const hasChildren = element.children.length > 0
    if (hasShape && (hasWholeText || hasChildren)) {
      return true
    }
    if (this.isLayoutContainerTag(tagName) && hasChildren && this.hasVisibleChildElement(element)) {
      return true
    }
    return false
  }

  /**
   * 创建子级组合上下文。
   * @param element 触发组合的 HTML 容器
   * @param parent 父级组合上下文
   */
  private createGroupContext(element: HTMLElement, parent: VisitContext): VisitContext {
    const groupId = this.createGroupId(element)
    return {
      ...parent,
      groupId,
      parentGroupId: parent.groupId,
      groupDepth: parent.groupDepth + 1,
      groupLabel: this.buildElementLabel(element),
    }
  }

  /**
   * 将简单 CSS background-image: url(...) 导出为 PPT 图片块。
   * @param element 背景图元素
   * @param context 当前组合上下文
   * @returns 是否已成功处理该背景图元素
   */
  private async addBackgroundImageElement(element: HTMLElement, context: VisitContext): Promise<boolean> {
    const style = window.getComputedStyle(element)
    const backgroundUrl = this.extractSingleBackgroundImageUrl(style.backgroundImage)
    if (!backgroundUrl) {
      return false
    }

    const label = this.buildElementLabel(element)
    if (backgroundUrl.startsWith('data:image/')) {
      this.addImageDataBlock(backgroundUrl, element, 'image', label, 'CSS 背景图导出为图片块', context)
      return true
    }

    return this.addImagePathBlock(backgroundUrl, element, 'image', label, context, 'CSS 背景图导出为图片块')
  }

  /**
   * 将可解析的 CSS linear-gradient 导出为单个 PPT 原生渐变形状。
   * @param element 渐变元素
   * @param context 当前组合上下文
   * @returns 是否已成功处理该渐变元素
   */
  private addLinearGradientElement(element: HTMLElement, context: VisitContext): boolean {
    const style = window.getComputedStyle(element)
    const gradient = this.parseLinearGradient(style.backgroundImage, element)
    if (!gradient) {
      return false
    }

    const box = this.getPptxBox(element)
    const label = this.buildElementLabel(element)
    if (!box) {
      this.addSkippedItem('shape', label, '渐变形状尺寸无效', context)
      return true
    }

    const objectName = this.createGradientObjectName(element)
    this.options.slide.addShape(this.options.shapeTypes.rect, {
      ...box,
      fill: this.buildFillOptions(this.sampleLinearGradientColor(gradient.stops, 0.5)),
      line: this.buildTransparentLineOptions(),
      ...this.buildPptObjectMeta(context, 'gradient', label),
      objectName,
    })
    this.options.gradientFillCollector?.({
      pageIndex: this.options.pageIndex,
      objectName,
      direction: gradient.direction,
      stops: gradient.stops,
    })

    this.addReportItem('shape', 'editable-shape', true, label, 'linear-gradient 导出为 PPT 原生渐变形状', context)
    return true
  }

  /**
   * 创建用于后处理定位的渐变形状对象名。
   * @param element 渐变元素
   */
  private createGradientObjectName(element: HTMLElement): string {
    this.gradientSequence += 1
    const label = this.buildElementLabel(element)
    return this.normalizeObjectName(`pptx-gradient-p${this.options.pageIndex}-${this.gradientSequence}-${label}`)
  }

  /**
   * 计算传给子节点的文本对齐继承上下文。
   * @param element 当前元素
   * @param parent 父级上下文
   */
  private createTextInheritanceContext(element: HTMLElement, parent: VisitContext): VisitContext {
    const style = window.getComputedStyle(element)
    const ownHorizontalAlign = this.resolveOwnInheritableTextHorizontalAlign(element, style)
    const ownVerticalAlign = this.resolveOwnTextVerticalAlign(element, style)

    return {
      ...parent,
      inheritedTextAlign: ownHorizontalAlign !== 'left' || this.hasExplicitTextHorizontalAlign(element)
        ? ownHorizontalAlign
        : parent.inheritedTextAlign,
      inheritedVerticalAlign: ownVerticalAlign !== 'top' || this.hasExplicitVerticalAlign(element)
        ? ownVerticalAlign
        : parent.inheritedVerticalAlign,
    }
  }

  /**
   * 创建稳定可读的组合 ID。
   * @param element HTML 容器
   */
  private createGroupId(element: HTMLElement): string {
    this.groupSequence += 1
    const tagName = element.tagName.toLowerCase()
    const id = element.id ? `-${element.id}` : ''
    const className = String(element.getAttribute('class') || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join('-')
    return this.normalizeObjectName(`p${this.options.pageIndex}-g${this.groupSequence}-${tagName}${id}${className ? `-${className}` : ''}`)
  }

  /**
   * 判断标签是否常用于 HTML 布局组合。
   * @param tagName 小写标签名
   */
  private isLayoutContainerTag(tagName: string): boolean {
    return [
      'a',
      'article',
      'aside',
      'button',
      'div',
      'footer',
      'header',
      'li',
      'main',
      'nav',
      'section',
      'span',
    ].includes(tagName)
  }

  /**
   * 判断元素是否包含可见子元素。
   * @param element 当前元素
   */
  private hasVisibleChildElement(element: HTMLElement): boolean {
    return Array.from(element.children).some(child => this.isVisibleElement(child))
  }

  /**
   * 清理 PowerPoint 对象名，避免选择窗格名称过长或含控制字符。
   * @param value 原始对象名
   */
  private normalizeObjectName(value: string): string {
    const withoutControlCharacters = Array.from(value)
      .filter(char => char.charCodeAt(0) >= 32)
      .join('')
    return withoutControlCharacters
      .replace(/[^\w\u4e00-\u9fa5#.-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 120)
  }

  /**
   * 构造 PPT fill 参数。
   * @param color 填充颜色
   */
  private buildFillOptions(color: ParsedColor | null): Record<string, unknown> {
    if (!color) {
      return {
        type: 'none',
        transparency: 100,
      }
    }

    return {
      type: 'solid',
      color: color.hex,
      transparency: this.alphaToTransparency(color.alpha),
    }
  }

  /**
   * 构造 PPT line 参数。
   * @param border 边框信息
   * @param fallbackColor 兜底颜色
   * @param fallbackWidthPt 兜底线宽
   */
  private buildLineOptions(
    border?: BorderInfo | null,
    fallbackColor?: ParsedColor | null,
    fallbackWidthPt = 1,
  ): Record<string, unknown> {
    const color = border?.color || fallbackColor || { hex: '000000', alpha: 1 }
    return {
      color: color.hex,
      transparency: this.alphaToTransparency(color.alpha),
      width: border?.widthPt || fallbackWidthPt,
      dashType: border?.dashType || 'solid',
    }
  }

  /**
   * 构造透明线条参数。
   */
  private buildTransparentLineOptions(): Record<string, unknown> {
    return {
      color: 'FFFFFF',
      transparency: 100,
      width: 0,
    }
  }

  /**
   * 对非统一边框逐边画线，提高卡片和分隔线还原度。
   * @param box 元素 PPTX 位置尺寸
   * @param border 边框信息
   */
  private addBorderSideLine(box: ElementBox, border: BorderInfo, context: VisitContext, label: string): void {
    const line = this.buildLineOptions(border)
    if (border.side === 'top') {
      this.options.slide.addShape(this.options.shapeTypes.line, {
        x: box.x,
        y: box.y,
        w: box.w,
        h: 0,
        line,
        ...this.buildPptObjectMeta(context, 'border-top', label),
      })
      return
    }

    if (border.side === 'bottom') {
      this.options.slide.addShape(this.options.shapeTypes.line, {
        x: box.x,
        y: box.y + box.h,
        w: box.w,
        h: 0,
        line,
        ...this.buildPptObjectMeta(context, 'border-bottom', label),
      })
      return
    }

    if (border.side === 'left') {
      this.options.slide.addShape(this.options.shapeTypes.line, {
        x: box.x,
        y: box.y,
        w: 0,
        h: box.h,
        line,
        ...this.buildPptObjectMeta(context, 'border-left', label),
      })
      return
    }

    this.options.slide.addShape(this.options.shapeTypes.line, {
      x: box.x + box.w,
      y: box.y,
      w: 0,
      h: box.h,
      line,
      ...this.buildPptObjectMeta(context, 'border-right', label),
    })
  }

  /**
   * 判断边框是否四边一致，可直接用 rect line 表示。
   * @param borders 四边边框
   */
  private getUniformBorderInfo(borders: BorderInfo[]): BorderInfo | null {
    if (borders.length !== 4) {
      return null
    }

    const [first] = borders
    const isUniform = borders.every(border => {
      return border.color.hex === first.color.hex &&
        Math.abs(border.color.alpha - first.color.alpha) < 0.001 &&
        Math.abs(border.widthPx - first.widthPx) < 0.001 &&
        border.dashType === first.dashType
    })

    return isUniform ? first : null
  }

  /**
   * 将元素 opacity 叠加到颜色透明度。
   * @param color 原始颜色
   * @param opacity 元素透明度
   */
  private applyOpacity(color: ParsedColor | null, opacity: number): ParsedColor | null {
    if (!color) {
      return null
    }

    return {
      hex: color.hex,
      alpha: Math.max(0, Math.min(1, color.alpha * opacity)),
    }
  }

  /**
   * 判断是否应将元素作为复杂 CSS 截图。
   * @param element 候选元素
   */
  private shouldScreenshotComplexElement(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element)
    const box = this.measureElementPixels(element)
    const pageArea = this.rootBox.width * this.rootBox.height
    const elementArea = box.width * box.height
    if (pageArea > 0 && elementArea / pageArea > 0.82) {
      return false
    }

    return this.isComplexImageValue(style.backgroundImage) ||
      this.isEnabledCssEffect(style.filter) ||
      this.isEnabledCssEffect((style as CSSStyleDeclaration & { backdropFilter?: string }).backdropFilter) ||
      this.isEnabledCssEffect(style.clipPath) ||
      this.isEnabledCssEffect(style.maskImage) ||
      this.isEnabledCssEffect((style as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage) ||
      this.isComplexTransform(style.transform) ||
      (style.mixBlendMode && style.mixBlendMode !== 'normal')
  }

  /**
   * 判断背景图片值是否复杂。
   * @param value CSS background-image
   */
  private isComplexImageValue(value: string): boolean {
    if (!value || value === 'none') {
      return false
    }
    return value.includes('gradient(') || value.includes('url(') || value.includes(',')
  }

  /**
   * 判断 CSS 特效属性是否启用。
   * @param value CSS 属性值
   */
  private isEnabledCssEffect(value?: string): boolean {
    return Boolean(value && value !== 'none' && value !== 'normal')
  }

  /**
   * 判断 transform 是否超出 v1 可编辑映射范围。
   * @param value transform 值
   */
  private isComplexTransform(value: string): boolean {
    return Boolean(value && value !== 'none')
  }

  /**
   * 判断元素是否应添加为 PPT 形状。
   * @param element 候选元素
   */
  private shouldAddShape(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element)
    const box = this.measureElementPixels(element)
    if (box.width < 1 || box.height < 1) {
      return false
    }

    return Boolean(this.parseCssColor(this.resolveBackgroundColorValue(element, style), element)) ||
      this.getBorderInfos(element, style).length > 0
  }

  /**
   * 添加简单形状、卡片、边框或分隔线。
   * @param element 源元素
   */
  private addShapeElement(element: HTMLElement, context: VisitContext): void {
    const box = this.getPptxBox(element)
    if (!box) {
      return
    }

    const style = window.getComputedStyle(element)
    const elementOpacity = this.parseOpacity(style.opacity)
    const fillColor = this.applyOpacity(this.parseCssColor(this.resolveBackgroundColorValue(element, style), element), elementOpacity)
    const borders = this.getBorderInfos(element, style).map(border => ({
      ...border,
      color: this.applyOpacity(border.color, elementOpacity) || border.color,
    }))
    const uniformBorder = this.getUniformBorderInfo(borders)
    const label = this.buildElementLabel(element)
    const isHorizontalLine = box.h <= 0.04 && box.w > box.h
    const isVerticalLine = box.w <= 0.04 && box.h > box.w

    if (isHorizontalLine || isVerticalLine) {
      this.options.slide.addShape(this.options.shapeTypes.line, {
        x: box.x,
        y: isHorizontalLine ? box.y + box.h / 2 : box.y,
        w: isHorizontalLine ? box.w : 0,
        h: isVerticalLine ? box.h : 0,
        line: this.buildLineOptions(
          uniformBorder,
          fillColor,
          Math.max(0.75, this.measuredPxToPt(isHorizontalLine ? box.h / this.inchPerPxY() : box.w / this.inchPerPxX())),
        ),
        ...this.buildPptObjectMeta(context, 'line', label),
      })
      this.addReportItem('shape', 'editable-shape', true, label, '分隔线转为 PPT line', context)
      return
    }

    const radiusPx = this.cssPxToMeasuredPx(this.parseCssPixel(style.borderTopLeftRadius) || this.parseCssPixel(style.borderRadius))
    this.options.slide.addShape(
      radiusPx > 0 ? this.options.shapeTypes.roundRect : this.options.shapeTypes.rect,
      {
        ...box,
        fill: this.buildFillOptions(fillColor),
        line: uniformBorder ? this.buildLineOptions(uniformBorder) : this.buildTransparentLineOptions(),
        ...(radiusPx > 0 ? { rectRadius: Math.min(1, radiusPx / Math.max(1, Math.min(this.measureElementPixels(element).width, this.measureElementPixels(element).height))) } : {}),
        ...this.buildPptObjectMeta(context, 'shape', label),
      },
    )
    if (!uniformBorder && borders.length > 0) {
      borders.forEach(border => this.addBorderSideLine(box, border, context, label))
    }
    this.addReportItem('shape', 'editable-shape', true, label, '纯色块、卡片或简单边框转为 PPT shape', context)
  }

  /**
   * 判断元素是否应添加为文本。
   * @param element 候选元素
   */
  private shouldAddText(element: HTMLElement): boolean {
    const text = this.normalizeText(element.textContent || '')
    if (!text) {
      return false
    }

    if (element.children.length === 0) {
      return true
    }

    const style = window.getComputedStyle(element)
    if (this.resolveLayoutDisplay(element, style)) {
      return false
    }

    const onlyInlineChildren = Array.from(element.children).every(child => {
      const tagName = child.tagName.toLowerCase()
      return INLINE_TEXT_TAGS.has(tagName)
    })
    if (!onlyInlineChildren) {
      return false
    }

    if (!this.hasDirectTextContent(element) && this.hasStyledInlineTextChildren(element)) {
      return false
    }

    return true
  }

  /**
   * 判断元素是否有直属文本，避免容器文本和子元素文本重复。
   * @param element 候选元素
   */
  private hasDirectTextContent(element: HTMLElement): boolean {
    return Array.from(element.childNodes).some(node => {
      return node.nodeType === Node.TEXT_NODE && this.normalizeText(node.textContent || '')
    })
  }

  /**
   * 判断 inline 子元素是否带有独立视觉/文字样式，应单独导出。
   * @param element 父元素
   */
  private hasStyledInlineTextChildren(element: HTMLElement): boolean {
    const parentStyle = window.getComputedStyle(element)
    return Array.from(element.children).some(child => {
      if (!(child instanceof HTMLElement) || !this.normalizeText(child.textContent || '')) {
        return false
      }
      if (this.shouldAddShape(child)) {
        return true
      }

      const childStyle = window.getComputedStyle(child)
      return childStyle.fontSize !== parentStyle.fontSize ||
        childStyle.fontWeight !== parentStyle.fontWeight ||
        childStyle.fontStyle !== parentStyle.fontStyle ||
        childStyle.color !== parentStyle.color ||
        childStyle.textDecorationLine !== parentStyle.textDecorationLine
    })
  }

  /**
   * 添加 PPT 可编辑文本框。
   * @param element 文本元素
   */
  private addTextElement(element: HTMLElement, context: VisitContext): void {
    const text = this.normalizeText(element.textContent || '')
    const box = this.getPptxBox(element)
    if (!text || !box) {
      return
    }

    const style = window.getComputedStyle(element)
    const sourceType = this.resolveTextSourceType(element, style, text)
    const shouldPreservePaddedBox = this.shouldPreservePaddedInlineTextBox(element, style)
    const textOptions = this.buildTextRunOptions(element, style, text, context, shouldPreservePaddedBox)
    const guardedBox = shouldPreservePaddedBox
      ? box
      : this.applyTextBoxWidthGuard(box, style, text, String(textOptions.align || 'left'), false)

    this.options.slide.addText(text, {
      ...guardedBox,
      margin: shouldPreservePaddedBox ? this.resolveTextShapeMargin(element, style) : 0,
      ...textOptions,
      isTextBox: true,
      ...this.buildPptObjectMeta(context, 'text', text),
    })
    this.addReportItem(sourceType, 'editable-text', true, text.slice(0, 60), '文本转为 PPT text', context)
  }

  /**
   * 添加带文本的 PPT 形状，让背景、边框、圆角和内边距由 PPT 自动绘制。
   * @param element 文本形状源元素
   * @param context 当前组合上下文
   * @returns 是否已成功转换为文本形状
   */
  private addTextShapeElement(element: HTMLElement, context: VisitContext): boolean {
    const text = this.normalizeText(element.textContent || '')
    const box = this.getPptxBox(element)
    if (!text || !box) {
      return false
    }

    const style = window.getComputedStyle(element)
    const shapeOptions = this.buildTextShapeVisualOptions(element, style, box)
    if (!shapeOptions) {
      return false
    }

    const sourceType = this.resolveTextSourceType(element, style, text)
    const label = this.buildElementLabel(element)
    const textOptions = this.buildTextRunOptions(element, style, text, context, true)
    const shouldPreservePaddedBox = this.shouldPreservePaddedInlineTextBox(element, style)
    const guardedBox = shouldPreservePaddedBox
      ? box
      : this.applyTextBoxWidthGuard(box, style, text, String(textOptions.align || 'left'), true)

    this.options.slide.addText(text, {
      ...guardedBox,
      ...shapeOptions,
      margin: this.resolveTextShapeMargin(element, style),
      ...textOptions,
      ...this.buildPptObjectMeta(context, 'text-shape', text),
    })
    this.addReportItem(sourceType, 'editable-text', true, text.slice(0, 60), '带背景文本转为 PPT text shape', context)
    this.addReportItem('shape', 'editable-shape', true, label, '背景、边框和圆角由 PPT 文本形状绘制', context)
    return true
  }

  /**
   * 构造 PPT 文本通用样式参数。
   * @param element 文本元素
   * @param style 计算样式
   * @param text 文本内容
   * @param context 当前组合上下文
   * @param isTextShape 是否为带形状文本
   */
  private buildTextRunOptions(
    element: HTMLElement,
    style: CSSStyleDeclaration,
    text: string,
    context: VisitContext,
    isTextShape = false,
  ): Record<string, unknown> {
    const fontSize = Math.max(1, this.cssPxToPt(this.parseCssPixel(style.fontSize) || 16))
    const color = this.applyOpacity(this.parseCssColor(style.color, element), this.parseOpacity(style.opacity))
    return {
      fit: 'none',
      fontFace: this.normalizeFontFace(style.fontFamily, text),
      fontSize,
      color: color?.hex || '000000',
      transparency: this.alphaToTransparency(color?.alpha ?? 1),
      bold: this.isBoldFont(style.fontWeight),
      italic: style.fontStyle === 'italic',
      underline: style.textDecorationLine.includes('underline'),
      breakLine: false,
      align: isTextShape
        ? this.resolveTextShapeHorizontalAlign(element, style, context)
        : this.resolveTextHorizontalAlign(element, style, context),
      valign: this.resolveTextVerticalAlign(element, style, text, context),
    }
  }

  /**
   * 构造文本形状的外观参数。
   * @param element 源元素
   * @param style 计算样式
   * @param box PPT 坐标盒
   */
  private buildTextShapeVisualOptions(
    element: HTMLElement,
    style: CSSStyleDeclaration,
    box: ElementBox,
  ): Record<string, unknown> | null {
    const isHorizontalLine = box.h <= 0.04 && box.w > box.h
    const isVerticalLine = box.w <= 0.04 && box.h > box.w
    if (isHorizontalLine || isVerticalLine) {
      return null
    }

    const elementOpacity = this.parseOpacity(style.opacity)
    const fillColor = this.applyOpacity(this.parseCssColor(this.resolveBackgroundColorValue(element, style), element), elementOpacity)
    const borders = this.getBorderInfos(element, style).map(border => ({
      ...border,
      color: this.applyOpacity(border.color, elementOpacity) || border.color,
    }))
    const uniformBorder = this.getUniformBorderInfo(borders)
    if (borders.length > 0 && !uniformBorder) {
      return null
    }

    const radiusPx = this.cssPxToMeasuredPx(this.parseCssPixel(style.borderTopLeftRadius) || this.parseCssPixel(style.borderRadius))
    const measuredBox = this.measureElementPixels(element)
    return {
      shape: radiusPx > 0 ? this.options.shapeTypes.roundRect : this.options.shapeTypes.rect,
      fill: this.buildFillOptions(fillColor),
      line: uniformBorder ? this.buildLineOptions(uniformBorder) : this.buildTransparentLineOptions(),
      ...(radiusPx > 0 ? { rectRadius: Math.min(1, radiusPx / Math.max(1, Math.min(measuredBox.width, measuredBox.height))) } : {}),
    }
  }

  /**
   * 给 PPT 文本框增加宽度冗余，降低 PowerPoint 字宽差异导致末字换行的概率。
   * @param box 原始 PPT 坐标盒
   * @param style 计算样式
   * @param text 文本内容
   * @param align 水平对齐
   * @param isTextShape 是否为带背景形状文本
   */
  private applyTextBoxWidthGuard(
    box: ElementBox,
    style: CSSStyleDeclaration,
    text: string,
    align: string,
    isTextShape: boolean,
  ): ElementBox {
    const guardWidth = this.calculateTextWidthGuard(box, style, text, isTextShape)
    if (guardWidth <= 0) {
      return box
    }

    let nextX = box.x
    if (align === 'center') {
      nextX -= guardWidth / 2
    } else if (align === 'right') {
      nextX -= guardWidth
    }

    nextX = Math.max(0, nextX)
    const maxWidth = Math.max(0.01, this.options.slideWidthIn - nextX)
    return {
      ...box,
      x: this.roundInch(nextX),
      w: this.roundInch(Math.min(maxWidth, box.w + guardWidth)),
    }
  }

  /**
   * 计算文本宽度冗余，普通文本框比带背景形状更积极。
   * @param box 原始 PPT 坐标盒
   * @param style 计算样式
   * @param text 文本内容
   * @param isTextShape 是否为带背景形状文本
   */
  private calculateTextWidthGuard(
    box: ElementBox,
    style: CSSStyleDeclaration,
    text: string,
    isTextShape: boolean,
  ): number {
    const fontSizePt = Math.max(1, this.cssPxToPt(this.parseCssPixel(style.fontSize) || 16))
    const fontSizeIn = fontSizePt / 72
    const isSingleLine = this.isLikelySingleLineTextBox(box, style, text)
    const ratioGuard = box.w * (isSingleLine ? (isTextShape ? 0.018 : 0.03) : (isTextShape ? 0.008 : 0.015))
    const emGuard = fontSizeIn * (isSingleLine ? (this.containsCjkText(text) ? 0.8 : 0.45) : (this.containsCjkText(text) ? 0.35 : 0.2))
    const minGuard = isTextShape ? 0.02 : 0.04
    const maxGuard = Math.max(isTextShape ? 0.04 : 0.08, box.w * (isTextShape ? 0.06 : 0.09))
    return Math.min(maxGuard, Math.max(minGuard, ratioGuard, emGuard))
  }

  /**
   * 判断文本盒是否大概率是单行，单行更容易出现末字换行。
   * @param box PPT 坐标盒
   * @param style 计算样式
   * @param text 文本内容
   */
  private isLikelySingleLineTextBox(box: ElementBox, style: CSSStyleDeclaration, text: string): boolean {
    if (!this.isSingleLineText(text)) {
      return false
    }
    if (['nowrap', 'pre', 'pre-line', 'pre-wrap'].includes(style.whiteSpace)) {
      return true
    }

    const fontSizePx = this.parseCssPixel(style.fontSize) || 16
    const lineHeightPx = this.parseCssPixel(style.lineHeight) || fontSizePx * 1.2
    const boxHeightPx = box.h / this.inchPerPxY()
    return boxHeightPx <= lineHeightPx * 1.9
  }

  /**
   * 将 HTML padding 映射为 PPT 文本形状内边距。
   * @param element 源元素
   * @param style 计算样式
   */
  private resolveTextShapeMargin(element: HTMLElement, style: CSSStyleDeclaration): number | [number, number, number, number] {
    const padding = this.resolveElementPaddingPixels(element, style)
    // pptxgenjs 的 addText 实际按 [left, right, bottom, top] 写入 lIns/rIns/bIns/tIns。
    const margin: [number, number, number, number] = [
      this.cssPxToPt(Math.max(0, padding.left)),
      this.cssPxToPt(Math.max(0, padding.right)),
      this.cssPxToPt(Math.max(0, padding.bottom)),
      this.cssPxToPt(Math.max(0, padding.top)),
    ]
    return margin.some(value => value > 0) ? margin : 0
  }

  /**
   * 根据元素和样式推断文本类型。
   * @param element 文本元素
   * @param style 计算样式
   * @param text 文本内容
   */
  private resolveTextSourceType(element: HTMLElement, style: CSSStyleDeclaration, text: string): PptxReportSourceType {
    const tagName = element.tagName.toLowerCase()
    const fontSize = this.parseCssPixel(style.fontSize)
    const numericChars = text.replace(/[^\d.%+-]/g, '').length
    if (numericChars >= Math.max(2, text.length * 0.55) && fontSize >= 22) {
      return 'number'
    }
    if (/^h[1-6]$/.test(tagName) || fontSize >= 30 || (this.isBoldFont(style.fontWeight) && fontSize >= 22)) {
      return 'title'
    }
    return 'body'
  }

  /**
   * 判断元素是否可见且有有效尺寸。
   * @param element 候选元素
   */
  private isVisibleElement(element: Element): boolean {
    const style = window.getComputedStyle(element)
    const box = this.measureElementPixels(element)
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity) !== 0 &&
      box.width > 0 &&
      box.height > 0
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

  /**
   * 计算元素在 slide 中的位置。
   * @param element 源元素
   */
  private getPptxBox(element: Element): ElementBox | null {
    const rect = this.measureElementPixels(element)
    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }

    const x = (rect.left - this.rootBox.left) * this.inchPerPxX()
    const y = (rect.top - this.rootBox.top) * this.inchPerPxY()
    return {
      x: this.roundInch(Math.max(0, x)),
      y: this.roundInch(Math.max(0, y)),
      w: this.roundInch(Math.max(0.01, Math.min(rect.width, this.rootBox.width) * this.inchPerPxX())),
      h: this.roundInch(Math.max(0.01, Math.min(rect.height, this.rootBox.height) * this.inchPerPxY())),
    }
  }

  /**
   * 测量页面根节点。
   * @param element 页面根元素
   */
  private measureRootBox(element: HTMLElement): MeasuredElementBox {
    const measured = this.measureElementPixels(element)
    return {
      left: measured.left,
      top: measured.top,
      width: measured.width || this.options.pageWidthPx,
      height: measured.height || this.options.pageHeightPx,
    }
  }

  /**
   * 测量元素像素位置和尺寸，jsdom 下回退读取 CSS 值。
   * @param element 源元素
   */
  private measureElementPixels(element: Element): MeasuredElementBox {
    const rawBox = this.measureElementRawPixels(element)
    return this.applyFlexItemLayoutFallback(element, rawBox)
  }

  /**
   * 读取元素原始像素位置和尺寸，不做布局推断。
   * @param element 源元素
   */
  private measureElementRawPixels(element: Element): MeasuredElementBox {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    const width = rect.width || this.parseCssPixel(style.width) || (element as HTMLElement).offsetWidth || 0
    const height = rect.height || this.parseCssPixel(style.height) || (element as HTMLElement).offsetHeight || 0
    const left = rect.left || this.parseCssPixel(style.left)
    const top = rect.top || this.parseCssPixel(style.top)

    return { left, top, width, height }
  }

  /**
   * 判断元素原始测量结果是否可见，避免 flex 兜底内部递归触发自身。
   * @param element 候选元素
   */
  private isRawVisibleElement(element: Element): boolean {
    const style = window.getComputedStyle(element)
    const box = this.measureElementRawPixels(element)
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity) !== 0 &&
      box.width > 0 &&
      box.height > 0
  }

  /**
   * 在测量环境没有执行 flex 布局时，按父级 flex 规则推断直接子项位置。
   * @param element 源元素
   * @param rawBox 原始测量盒
   */
  private applyFlexItemLayoutFallback(element: Element, rawBox: MeasuredElementBox): MeasuredElementBox {
    if (!(element instanceof HTMLElement) || !element.parentElement) {
      return rawBox
    }

    const parent = element.parentElement
    const parentStyle = window.getComputedStyle(parent)
    if (this.resolveLayoutDisplay(parent, parentStyle) !== 'flex') {
      return rawBox
    }

    const items = Array.from(parent.children).filter((child): child is HTMLElement => {
      return child instanceof HTMLElement && this.isRawVisibleElement(child)
    })
    const itemIndex = items.indexOf(element)
    if (itemIndex < 0) {
      return rawBox
    }

    const parentRawBox = this.measureElementRawPixels(parent)
    const parentBox = this.measureElementPixels(parent)
    const padding = this.resolveElementPaddingPixels(parent, parentStyle)
    const paddingLeft = this.cssPxToMeasuredPx(padding.left)
    const paddingRight = this.cssPxToMeasuredPx(padding.right)
    const paddingTop = this.cssPxToMeasuredPx(padding.top)
    const paddingBottom = this.cssPxToMeasuredPx(padding.bottom)
    const contentLeft = parentBox.left + paddingLeft
    const contentTop = parentBox.top + paddingTop
    const contentWidth = Math.max(0, parentBox.width - paddingLeft - paddingRight)
    const contentHeight = Math.max(0, parentBox.height - paddingTop - paddingBottom)
    const isColumn = this.resolveFlexDirection(parent, parentStyle).startsWith('column')
    const itemBoxes = items.map(item => this.measureElementRawPixels(item))
    const nextBox = { ...rawBox }

    if (isColumn) {
      const expectedTop = this.resolveFlexMainCoordinate(
        contentTop,
        contentHeight,
        itemBoxes.map(box => box.height),
        itemIndex,
        this.resolveClassJustifyContent(parent) || parentStyle.justifyContent,
      )
      const expectedLeft = this.resolveFlexCrossCoordinate(
        contentLeft,
        contentWidth,
        rawBox.width,
        this.resolveClassAlignItems(parent) || parentStyle.alignItems,
      )
      if (this.shouldUseFlexCoordinateFallback(rawBox.top, parentRawBox.top, expectedTop, parentBox.top)) {
        nextBox.top = expectedTop
      }
      if (this.shouldUseFlexCoordinateFallback(rawBox.left, parentRawBox.left, expectedLeft, parentBox.left)) {
        nextBox.left = expectedLeft
      }
      return nextBox
    }

    const expectedLeft = this.resolveFlexMainCoordinate(
      contentLeft,
      contentWidth,
      itemBoxes.map(box => box.width),
      itemIndex,
      this.resolveClassJustifyContent(parent) || parentStyle.justifyContent,
    )
    const expectedTop = this.resolveFlexCrossCoordinate(
      contentTop,
      contentHeight,
      rawBox.height,
      this.resolveClassAlignItems(parent) || parentStyle.alignItems,
    )
    if (this.shouldUseFlexCoordinateFallback(rawBox.left, parentRawBox.left, expectedLeft, parentBox.left)) {
      nextBox.left = expectedLeft
    }
    if (this.shouldUseFlexCoordinateFallback(rawBox.top, parentRawBox.top, expectedTop, parentBox.top)) {
      nextBox.top = expectedTop
    }
    return nextBox
  }

  /**
   * 按 flex 主轴分布计算子项坐标。
   * @param contentStart 内容区起点
   * @param contentSize 内容区尺寸
   * @param itemSizes 子项主轴尺寸
   * @param itemIndex 当前子项序号
   * @param justifyContent 主轴分布方式
   */
  private resolveFlexMainCoordinate(
    contentStart: number,
    contentSize: number,
    itemSizes: number[],
    itemIndex: number,
    justifyContent: string,
  ): number {
    const normalizedJustify = String(justifyContent || '').trim()
    const totalItemSize = itemSizes.reduce((total, size) => total + size, 0)
    const previousSize = itemSizes.slice(0, itemIndex).reduce((total, size) => total + size, 0)
    const freeSize = Math.max(0, contentSize - totalItemSize)
    const itemCount = itemSizes.length

    if (normalizedJustify === 'center') {
      return contentStart + freeSize / 2 + previousSize
    }
    if (normalizedJustify === 'flex-end' || normalizedJustify === 'end') {
      return contentStart + freeSize + previousSize
    }
    if (normalizedJustify === 'space-between' && itemCount > 1) {
      return contentStart + previousSize + (freeSize / (itemCount - 1)) * itemIndex
    }
    if (normalizedJustify === 'space-around' && itemCount > 0) {
      const distributedSize = freeSize / itemCount
      return contentStart + distributedSize / 2 + previousSize + distributedSize * itemIndex
    }
    if (normalizedJustify === 'space-evenly' && itemCount > 0) {
      const distributedSize = freeSize / (itemCount + 1)
      return contentStart + distributedSize + previousSize + distributedSize * itemIndex
    }
    return contentStart + previousSize
  }

  /**
   * 按 flex 交叉轴对齐计算子项坐标。
   * @param contentStart 内容区起点
   * @param contentSize 内容区尺寸
   * @param itemSize 当前子项交叉轴尺寸
   * @param alignItems 交叉轴对齐方式
   */
  private resolveFlexCrossCoordinate(
    contentStart: number,
    contentSize: number,
    itemSize: number,
    alignItems: string,
  ): number {
    const normalizedAlign = String(alignItems || '').trim()
    const freeSize = Math.max(0, contentSize - itemSize)
    if (normalizedAlign === 'center') {
      return contentStart + freeSize / 2
    }
    if (normalizedAlign === 'flex-end' || normalizedAlign === 'end') {
      return contentStart + freeSize
    }
    return contentStart
  }

  /**
   * 判断是否应使用 flex 推断坐标，避免覆盖真实浏览器布局。
   * @param rawCoordinate 子项原始坐标
   * @param rawParentCoordinate 父级原始坐标
   * @param expectedCoordinate 推断坐标
   * @param parentCoordinate 父级最终坐标
   */
  private shouldUseFlexCoordinateFallback(
    rawCoordinate: number,
    rawParentCoordinate: number,
    expectedCoordinate: number,
    parentCoordinate: number,
  ): boolean {
    if (Math.abs(rawCoordinate - expectedCoordinate) <= 1) {
      return false
    }

    const rawRelativeCoordinate = rawCoordinate - rawParentCoordinate
    const expectedRelativeCoordinate = expectedCoordinate - parentCoordinate
    return expectedRelativeCoordinate > 1 && Math.abs(rawRelativeCoordinate) <= 1
  }

  /**
   * 读取四边边框样式。
   * @param style 计算样式
   */
  private getBorderInfos(element: HTMLElement, style: CSSStyleDeclaration): BorderInfo[] {
    const borderSides = [
      ['top', style.borderTopStyle, style.borderTopWidth, style.borderTopColor],
      ['right', style.borderRightStyle, style.borderRightWidth, style.borderRightColor],
      ['bottom', style.borderBottomStyle, style.borderBottomWidth, style.borderBottomColor],
      ['left', style.borderLeftStyle, style.borderLeftWidth, style.borderLeftColor],
    ] as const
    const borders: BorderInfo[] = []

    for (const [side, borderStyle, borderWidth, borderColor] of borderSides) {
      const resolvedBorderStyle = this.resolveBorderStyleValue(element, side, borderStyle)
      const widthPx = this.parseCssPixel(this.resolveBorderWidthValue(element, side, borderWidth))
      const color = this.parseCssColor(this.resolveBorderColorValue(element, side, borderColor), element)
      if (widthPx > 0 && color && resolvedBorderStyle !== 'none' && resolvedBorderStyle !== 'hidden') {
        borders.push({
          color,
          side,
          style: resolvedBorderStyle,
          widthPx,
          widthPt: Math.max(0.25, this.cssPxToPt(widthPx)),
          dashType: this.normalizeBorderDashType(resolvedBorderStyle),
        })
      }
    }

    return borders
  }

  /**
   * 读取背景色，优先保留声明中的高级颜色函数。
   * @param element 元素
   * @param style 计算样式
   */
  private resolveBackgroundColorValue(element: HTMLElement, style: CSSStyleDeclaration): string {
    return this.cssParser.resolveBackgroundColorValue(element, style)
  }

  /**
   * 读取边框颜色，优先保留声明中的高级颜色函数。
   * @param element 元素
   * @param side 边框方向
   * @param computedColor 计算样式颜色
   */
  private resolveBorderColorValue(
    element: HTMLElement,
    side: PptxBorderSide,
    computedColor: string,
  ): string {
    return this.cssParser.resolveBorderColorValue(element, side, computedColor)
  }

  /**
   * 读取边框样式，computed 无效时回退解析 border 简写。
   * @param element 元素
   * @param side 边框方向
   * @param computedStyle 计算样式
   */
  private resolveBorderStyleValue(element: HTMLElement, side: PptxBorderSide, computedStyle: string): string {
    return this.cssParser.resolveBorderStyleValue(element, side, computedStyle)
  }

  /**
   * 读取边框宽度，computed 无效时回退解析 border 简写。
   * @param element 元素
   * @param side 边框方向
   * @param computedWidth 计算宽度
   */
  private resolveBorderWidthValue(element: HTMLElement, side: PptxBorderSide, computedWidth: string): string {
    return this.cssParser.resolveBorderWidthValue(element, side, computedWidth)
  }

  /**
   * 解析 CSS 颜色。
   * @param value CSS 颜色值
   * @param context 变量和 currentColor 的解析上下文
   * @param currentColor SVG currentColor 的显式兜底
   */
  private parseCssColor(value: string, context?: Element, currentColor?: ParsedColor | null): ParsedColor | null {
    return this.cssParser.parseCssColor(value, context, currentColor)
  }

  /**
   * 解析元素 opacity。
   * @param value CSS opacity
   */
  private parseOpacity(value: string): number {
    return this.cssParser.parseOpacity(value)
  }

  /**
   * 将 CSS border-style 映射到 PPTX 虚线类型。
   * @param value CSS border-style
   */
  private normalizeBorderDashType(value: string): string {
    return this.cssParser.normalizeBorderDashType(value)
  }

  /**
   * 解析 CSS px 值。
   * @param value CSS 长度
   */
  private parseCssPixel(value: string): number {
    return this.cssParser.parseCssPixel(value)
  }

  /**
   * 测量 px 按当前页面实际尺寸转 PPT pt。
   * @param value 测量 px 值
   */
  private measuredPxToPt(value: number): number {
    return Math.round(value * this.inchPerPxY() * 72 * 100) / 100
  }

  /**
   * CSS px 按设计画布尺寸转 PPT pt，避免 transform 缩放导致字号放大。
   * @param value CSS px 值
   */
  private cssPxToPt(value: number): number {
    const pageHeight = this.options.pageHeightPx || this.rootBox.height
    return Math.round(value * (this.options.slideHeightIn / pageHeight) * 72 * 100) / 100
  }

  /**
   * CSS px 转当前测量坐标系 px，用于圆角比例等需要和 rect 对齐的场景。
   * @param value CSS px 值
   */
  private cssPxToMeasuredPx(value: number): number {
    const scaleX = this.options.pageWidthPx > 0 ? this.rootBox.width / this.options.pageWidthPx : 1
    const scaleY = this.options.pageHeightPx > 0 ? this.rootBox.height / this.options.pageHeightPx : 1
    const scale = Math.min(
      Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
      Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
    )
    return value * scale
  }

  /**
   * alpha 转 PPT 透明度。
   * @param alpha CSS alpha
   */
  private alphaToTransparency(alpha: number): number {
    return Math.round((1 - Math.max(0, Math.min(1, alpha))) * 100)
  }

  /**
   * 横向每 px 对应 inch。
   */
  private inchPerPxX(): number {
    return this.options.slideWidthIn / this.rootBox.width
  }

  /**
   * 纵向每 px 对应 inch。
   */
  private inchPerPxY(): number {
    return this.options.slideHeightIn / this.rootBox.height
  }

  /**
   * 统一控制 inch 精度，避免 PPTX XML 浮点过长。
   * @param value inch 值
   */
  private roundInch(value: number): number {
    return Math.round(value * 10000) / 10000
  }

  /**
   * 规范化文本内容。
   * @param text 原始文本
   */
  private normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
  }

  /**
   * 规范化 PPT 可识别字体名，跳过 CSS 系统字体别名。
   * @param fontFamily CSS font-family
   * @param text 文本内容，用于判断中文兜底字体
   */
  private normalizeFontFace(fontFamily: string, text = ''): string {
    const candidates = String(fontFamily || '')
      .split(',')
      .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
    const concreteFont = candidates.find(font => !this.isCssSystemFontAlias(font))
    if (concreteFont && !(this.containsCjkText(text) && this.isLatinSystemUiFont(concreteFont))) {
      return concreteFont
    }

    if (this.containsCjkText(text)) {
      return 'Microsoft YaHei'
    }

    return this.resolveSystemFontFallback(candidates) || 'Arial'
  }

  /**
   * 判断字体名是否为 CSS 系统或通用字体别名。
   * @param fontName 字体名
   */
  private isCssSystemFontAlias(fontName: string): boolean {
    return [
      '-apple-system',
      'blinkmacsystemfont',
      'system-ui',
      'ui-sans-serif',
      'ui-serif',
      'ui-monospace',
      'ui-rounded',
      'sans-serif',
      'serif',
      'monospace',
      'cursive',
      'fantasy',
      'emoji',
      'math',
      'fangsong',
      'inherit',
      'initial',
      'unset',
      'revert',
    ].includes(fontName.trim().toLowerCase())
  }

  /**
   * 判断字体是否为常见拉丁系统 UI 字体。
   * @param fontName 字体名
   */
  private isLatinSystemUiFont(fontName: string): boolean {
    return [
      'segoe ui',
      'roboto',
      'oxygen',
      'ubuntu',
      'cantarell',
      'fira sans',
      'droid sans',
      'helvetica neue',
      'arial',
    ].includes(fontName.trim().toLowerCase())
  }

  /**
   * 根据 CSS 通用字体类别选择 PPT 兜底字体。
   * @param candidates font-family 候选列表
   */
  private resolveSystemFontFallback(candidates: string[]): string {
    const normalized = candidates.map(font => font.trim().toLowerCase())
    if (normalized.some(font => font === 'monospace' || font === 'ui-monospace')) {
      return 'Consolas'
    }
    if (normalized.some(font => font === 'serif' || font === 'ui-serif')) {
      return 'Times New Roman'
    }
    if (normalized.some(font => font === 'fangsong')) {
      return 'FangSong'
    }
    if (normalized.some(font => font === 'sans-serif' || font === 'system-ui' || font === 'ui-sans-serif')) {
      return 'Segoe UI'
    }
    return ''
  }

  /**
   * 判断文本是否包含中日韩字符。
   * @param text 文本内容
   */
  private containsCjkText(text: string): boolean {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(text)
  }

  /**
   * 判断字体是否加粗。
   * @param fontWeight CSS font-weight
   */
  private isBoldFont(fontWeight: string): boolean {
    if (fontWeight === 'bold' || fontWeight === 'bolder') {
      return true
    }
    const numericWeight = Number.parseInt(fontWeight, 10)
    return Number.isFinite(numericWeight) && numericWeight >= 600
  }

  /**
   * 解析文本水平对齐，兼容 text-align 与 flex/grid 居中布局。
   * @param element 文本元素
   * @param style 计算样式
   * @param context 当前继承上下文
   */
  private resolveTextHorizontalAlign(element: HTMLElement, style: CSSStyleDeclaration, context: VisitContext): string {
    const ownAlign = this.resolveOwnTextHorizontalAlign(element, style)
    if (ownAlign !== 'left' || this.hasExplicitTextHorizontalAlign(element)) {
      return ownAlign
    }

    return context.inheritedTextAlign || ownAlign
  }

  /**
   * 解析文本形状水平对齐，pill/badge 默认使用居中以贴近 HTML 视觉盒。
   * @param element 文本元素
   * @param style 计算样式
   * @param context 当前继承上下文
   */
  private resolveTextShapeHorizontalAlign(element: HTMLElement, style: CSSStyleDeclaration, context: VisitContext): string {
    const align = this.resolveTextHorizontalAlign(element, style, context)
    if (align !== 'left' || this.hasExplicitTextHorizontalAlign(element)) {
      return align
    }

    return this.shouldCenterPillTextShape(element, style) ? 'center' : align
  }

  /**
   * 解析文本垂直对齐，兼容 flex/grid 与 line-height 居中。
   * @param element 文本元素
   * @param style 计算样式
   * @param text 文本内容
   * @param context 当前继承上下文
   */
  private resolveTextVerticalAlign(
    element: HTMLElement,
    style: CSSStyleDeclaration,
    text: string,
    context: VisitContext,
  ): string {
    if (this.isSingleLineText(text) && this.isLineHeightCentered(element, style)) {
      return 'middle'
    }

    const ownAlign = this.resolveOwnTextVerticalAlign(element, style)
    if (ownAlign !== 'top' || this.hasExplicitVerticalAlign(element)) {
      return ownAlign
    }

    return context.inheritedVerticalAlign || ownAlign
  }

  /**
   * 解析元素自身声明或布局提供的水平对齐。
   * @param element 文本元素
   * @param style 计算样式
   */
  private resolveOwnTextHorizontalAlign(element: HTMLElement, style: CSSStyleDeclaration): string {
    const textAlign = this.resolveOwnInheritableTextHorizontalAlign(element, style)

    return this.resolveLayoutHorizontalAlign(element, style) || textAlign
  }

  /**
   * 解析真正会按 HTML 规则向后代继承的文本水平对齐。
   * @param element 文本元素
   * @param style 计算样式
   */
  private resolveOwnInheritableTextHorizontalAlign(element: HTMLElement, style: CSSStyleDeclaration): string {
    const textAlign = this.normalizeCssHorizontalAlign(style.textAlign, style.direction)
    if (textAlign !== 'left') {
      return textAlign
    }

    return this.resolveClassTextAlign(element, style.direction) || textAlign
  }

  /**
   * 解析元素自身声明或布局提供的垂直对齐。
   * @param element 文本元素
   * @param style 计算样式
   */
  private resolveOwnTextVerticalAlign(element: HTMLElement, style: CSSStyleDeclaration): string {
    return this.resolveCssVerticalAlign(element, style) ||
      this.resolveClassVerticalAlign(element) ||
      this.resolveLayoutVerticalAlign(element, style) ||
      'top'
  }

  /**
   * 从 flex/grid 布局中推断水平对齐。
   * @param style 计算样式
   */
  private resolveLayoutHorizontalAlign(element: HTMLElement, style: CSSStyleDeclaration): string {
    const display = this.resolveLayoutDisplay(element, style)
    if (display === 'flex') {
      const isColumn = this.resolveFlexDirection(element, style).startsWith('column')
      const value = isColumn
        ? this.resolveClassAlignItems(element) || style.alignItems
        : this.resolveClassJustifyContent(element) || style.justifyContent
      return this.normalizeCssHorizontalAlign(value, style.direction, true)
    }
    if (display === 'grid') {
      const gridStyle = style as CSSStyleDeclaration & {
        justifyItems?: string
        placeContent?: string
        placeItems?: string
      }
      return this.normalizeCssHorizontalAlign(
        gridStyle.justifyItems ||
          this.resolveClassJustifyItems(element) ||
          this.extractPlaceAlignment(gridStyle.placeItems || style.getPropertyValue('place-items'), 'horizontal') ||
          this.resolveClassPlaceAlignment(element, 'horizontal') ||
          style.justifyContent ||
          this.resolveClassJustifyContent(element) ||
          this.extractPlaceAlignment(gridStyle.placeContent || style.getPropertyValue('place-content'), 'horizontal'),
        style.direction,
        true,
      )
    }

    return ''
  }

  /**
   * 从 flex/grid 布局中推断垂直对齐。
   * @param style 计算样式
   */
  private resolveLayoutVerticalAlign(element: HTMLElement, style: CSSStyleDeclaration): string {
    const display = this.resolveLayoutDisplay(element, style)
    if (display === 'flex') {
      const isColumn = this.resolveFlexDirection(element, style).startsWith('column')
      const value = isColumn
        ? this.resolveClassJustifyContent(element) || style.justifyContent
        : this.resolveClassAlignItems(element) || style.alignItems
      return this.normalizeCssVerticalAlign(value)
    }
    if (display === 'grid') {
      const gridStyle = style as CSSStyleDeclaration & {
        placeContent?: string
        placeItems?: string
      }
      return this.normalizeCssVerticalAlign(
        style.alignItems ||
          this.resolveClassAlignItems(element) ||
          this.extractPlaceAlignment(gridStyle.placeItems || style.getPropertyValue('place-items'), 'vertical') ||
          this.resolveClassPlaceAlignment(element, 'vertical') ||
          style.alignContent ||
          this.extractPlaceAlignment(gridStyle.placeContent || style.getPropertyValue('place-content'), 'vertical'),
      )
    }

    return ''
  }

  /**
   * 解析布局 display，computed 缺失时回退 Tailwind class。
   * @param element 当前元素
   * @param style 计算样式
   */
  private resolveLayoutDisplay(element: HTMLElement, style: CSSStyleDeclaration): 'flex' | 'grid' | '' {
    if (style.display.includes('flex') || this.hasAnyClass(element, ['flex', 'inline-flex'])) {
      return 'flex'
    }
    if (style.display.includes('grid') || this.hasAnyClass(element, ['grid', 'inline-grid'])) {
      return 'grid'
    }
    return ''
  }

  /**
   * 解析 flex-direction，computed 缺失时回退 Tailwind class。
   * @param element 当前元素
   * @param style 计算样式
   */
  private resolveFlexDirection(element: HTMLElement, style: CSSStyleDeclaration): string {
    if (this.hasAnyClass(element, ['flex-col', 'flex-col-reverse'])) {
      return 'column'
    }
    if (this.hasAnyClass(element, ['flex-row', 'flex-row-reverse'])) {
      return 'row'
    }
    return style.flexDirection || 'row'
  }

  /**
   * 从 place-items/place-content 里取水平或垂直对齐。
   * @param value CSS place-* 值
   * @param axis 目标轴
   */
  private extractPlaceAlignment(value: string | undefined, axis: 'horizontal' | 'vertical'): string {
    const parts = String(value || '').trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      return ''
    }
    if (parts.length === 1) {
      return parts[0]
    }
    return axis === 'vertical' ? parts[0] : parts[1]
  }

  /**
   * 从 Tailwind 文本对齐类名中解析水平对齐。
   * @param element 当前元素
   * @param direction 文本方向
   */
  private resolveClassTextAlign(element: HTMLElement, direction = 'ltr'): string {
    if (element.classList.contains('text-center')) return 'center'
    if (element.classList.contains('text-right')) return 'right'
    if (element.classList.contains('text-left')) return 'left'
    if (element.classList.contains('text-justify')) return 'justify'
    if (element.classList.contains('text-start')) return direction === 'rtl' ? 'right' : 'left'
    if (element.classList.contains('text-end')) return direction === 'rtl' ? 'left' : 'right'
    return ''
  }

  /**
   * 从 Tailwind justify-* 类名中解析主轴对齐。
   * @param element 当前元素
   */
  private resolveClassJustifyContent(element: HTMLElement): string {
    if (element.classList.contains('justify-center')) return 'center'
    if (element.classList.contains('justify-end')) return 'flex-end'
    if (element.classList.contains('justify-start')) return 'flex-start'
    if (element.classList.contains('justify-between')) return 'space-between'
    if (element.classList.contains('justify-around')) return 'space-around'
    if (element.classList.contains('justify-evenly')) return 'space-evenly'
    return ''
  }

  /**
   * 从 Tailwind items-* 类名中解析交叉轴对齐。
   * @param element 当前元素
   */
  private resolveClassAlignItems(element: HTMLElement): string {
    if (element.classList.contains('items-center')) return 'center'
    if (element.classList.contains('items-end')) return 'flex-end'
    if (element.classList.contains('items-start')) return 'flex-start'
    if (element.classList.contains('items-baseline')) return 'baseline'
    if (element.classList.contains('items-stretch')) return 'stretch'
    return ''
  }

  /**
   * 从 Tailwind justify-items-* 类名中解析网格水平对齐。
   * @param element 当前元素
   */
  private resolveClassJustifyItems(element: HTMLElement): string {
    if (element.classList.contains('justify-items-center')) return 'center'
    if (element.classList.contains('justify-items-end')) return 'end'
    if (element.classList.contains('justify-items-start')) return 'start'
    return ''
  }

  /**
   * 从 Tailwind place-items-* 类名中解析网格双轴对齐。
   * @param element 当前元素
   * @param axis 目标轴
   */
  private resolveClassPlaceAlignment(element: HTMLElement, axis: 'horizontal' | 'vertical'): string {
    if (element.classList.contains('place-items-center') || element.classList.contains('place-content-center')) {
      return 'center'
    }
    if (element.classList.contains('place-items-end') || element.classList.contains('place-content-end')) {
      return axis === 'vertical' ? 'end' : 'end'
    }
    if (element.classList.contains('place-items-start') || element.classList.contains('place-content-start')) {
      return axis === 'vertical' ? 'start' : 'start'
    }
    return ''
  }

  /**
   * 从 Tailwind vertical-align 类名中解析垂直对齐。
   * @param element 当前元素
   */
  private resolveClassVerticalAlign(element: HTMLElement): string {
    if (element.classList.contains('align-middle')) return 'middle'
    if (element.classList.contains('align-bottom') || element.classList.contains('align-text-bottom')) return 'bottom'
    if (element.classList.contains('align-top') || element.classList.contains('align-text-top')) return 'top'
    return ''
  }

  /**
   * 从 vertical-align/table-cell 中推断文本垂直对齐。
   * @param element 文本元素
   * @param style 计算样式
   */
  private resolveCssVerticalAlign(element: HTMLElement, style: CSSStyleDeclaration): string {
    const normalized = this.normalizeCssVerticalAlign(style.verticalAlign)
    if (!normalized) {
      return ''
    }

    const tagName = element.tagName.toLowerCase()
    if (style.display.includes('table-cell') || ['td', 'th'].includes(tagName)) {
      return normalized
    }

    const box = this.measureElementPixels(element)
    if (box.height > 0 && this.isTextOnlyLayoutElement(element)) {
      return normalized
    }

    return ''
  }

  /**
   * 判断圆角徽标类文本形状是否可默认居中。
   * @param element 文本形状元素
   * @param style 计算样式
   */
  private shouldCenterPillTextShape(element: HTMLElement, style: CSSStyleDeclaration): boolean {
    const tagName = element.tagName.toLowerCase()
    const padding = this.resolveElementPaddingPixels(element, style)
    const hasHorizontalPadding = padding.left > 0 || padding.right > 0
    const radiusPx = this.parseCssPixel(style.borderTopLeftRadius) || this.parseCssPixel(style.borderRadius)
    const isInlineLike = style.display.includes('inline') ||
      INLINE_TEXT_TAGS.has(tagName) ||
      tagName === 'button'
    return hasHorizontalPadding &&
      isInlineLike &&
      (radiusPx > 0 || this.hasRoundedClass(element)) &&
      this.isSingleLineText(this.normalizeText(element.textContent || ''))
  }

  /**
   * 判断普通文本是否也需要保留 inline padding 盒子。
   * @param element 文本元素
   * @param style 计算样式
   */
  private shouldPreservePaddedInlineTextBox(element: HTMLElement, style: CSSStyleDeclaration): boolean {
    return this.shouldCenterPillTextShape(element, style)
  }

  /**
   * 解析元素四边 padding，computed 缺失时回退常见 Tailwind spacing 类。
   * @param element 源元素
   * @param style 计算样式
   */
  private resolveElementPaddingPixels(element: HTMLElement, style: CSSStyleDeclaration): ElementPadding {
    const classPadding = this.resolveTailwindPaddingPixels(element)
    return {
      top: this.parseCssPixel(style.paddingTop) || classPadding.top,
      right: this.parseCssPixel(style.paddingRight) || classPadding.right,
      bottom: this.parseCssPixel(style.paddingBottom) || classPadding.bottom,
      left: this.parseCssPixel(style.paddingLeft) || classPadding.left,
    }
  }

  /**
   * 从 Tailwind padding 类中解析 px 值，覆盖测试环境没有 CSS 的场景。
   * @param element 源元素
   */
  private resolveTailwindPaddingPixels(element: HTMLElement): ElementPadding {
    const padding: ElementPadding = { top: 0, right: 0, bottom: 0, left: 0 }
    Array.from(element.classList).forEach(className => {
      if (className.includes(':')) {
        return
      }
      const match = /^(p|px|py|pt|pr|pb|pl)-(.+)$/.exec(className)
      if (!match) {
        return
      }

      const value = this.resolveTailwindSpacingPixels(match[2])
      if (value <= 0) {
        return
      }
      this.applyPaddingUtility(padding, match[1], value)
    })
    return padding
  }

  /**
   * 将 Tailwind spacing token 转为 CSS px。
   * @param token spacing token
   */
  private resolveTailwindSpacingPixels(token: string): number {
    if (token === 'px') {
      return 1
    }

    const arbitraryPx = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token)
    if (arbitraryPx) {
      return Number.parseFloat(arbitraryPx[1])
    }

    const numeric = Number.parseFloat(token)
    return Number.isFinite(numeric) ? numeric * 4 : 0
  }

  /**
   * 应用 Tailwind padding utility 到四边 padding。
   * @param padding 当前 padding
   * @param utility utility 前缀
   * @param value px 值
   */
  private applyPaddingUtility(padding: ElementPadding, utility: string, value: number): void {
    if (utility === 'p' || utility === 'py' || utility === 'pt') padding.top = value
    if (utility === 'p' || utility === 'px' || utility === 'pr') padding.right = value
    if (utility === 'p' || utility === 'py' || utility === 'pb') padding.bottom = value
    if (utility === 'p' || utility === 'px' || utility === 'pl') padding.left = value
  }

  /**
   * 判断元素是否有圆角类名。
   * @param element 源元素
   */
  private hasRoundedClass(element: HTMLElement): boolean {
    return Array.from(element.classList).some(className => {
      return className.startsWith('rounded') && className !== 'rounded-none'
    })
  }

  /**
   * 判断元素是否显式声明了可继承的文本水平对齐。
   * @param element 文本元素
   */
  private hasExplicitTextHorizontalAlign(element: HTMLElement): boolean {
    const inlineStyle = element.style
    return Boolean(
      inlineStyle.getPropertyValue('text-align') ||
      element.getAttribute('align') ||
      this.hasAnyClass(element, [
        'text-left',
        'text-center',
        'text-right',
        'text-justify',
        'text-start',
        'text-end',
      ]),
    )
  }

  /**
   * 判断元素是否显式声明了垂直对齐。
   * @param element 文本元素
   */
  private hasExplicitVerticalAlign(element: HTMLElement): boolean {
    const inlineStyle = element.style
    return Boolean(
      inlineStyle.getPropertyValue('vertical-align') ||
      inlineStyle.getPropertyValue('align-items') ||
      inlineStyle.getPropertyValue('align-content') ||
      inlineStyle.getPropertyValue('justify-content') ||
      inlineStyle.getPropertyValue('place-content') ||
      inlineStyle.getPropertyValue('place-items') ||
      element.getAttribute('valign') ||
      this.hasAnyClass(element, [
        'items-start',
        'items-center',
        'items-end',
        'justify-start',
        'justify-center',
        'justify-end',
        'justify-between',
        'justify-around',
        'justify-evenly',
        'place-items-start',
        'place-items-center',
        'place-items-end',
        'place-content-start',
        'place-content-center',
        'place-content-end',
        'align-top',
        'align-middle',
        'align-bottom',
        'align-text-top',
        'align-text-bottom',
      ]),
    )
  }

  /**
   * 判断元素是否包含任一 class。
   * @param element 当前元素
   * @param classNames class 名称集合
   */
  private hasAnyClass(element: HTMLElement, classNames: string[]): boolean {
    return classNames.some(className => element.classList.contains(className))
  }

  /**
   * 规范化 CSS 水平对齐。
   * @param value CSS 对齐值
   * @param direction 文本方向
   * @param fromLayout 是否来自布局属性
   */
  private normalizeCssHorizontalAlign(value: string, direction = 'ltr', fromLayout = false): string {
    const normalized = String(value || '').trim()
    if (normalized === 'center') {
      return 'center'
    }
    if (normalized === 'right' || normalized === 'end' || normalized === 'flex-end') {
      return direction === 'rtl' && normalized === 'end' ? 'left' : 'right'
    }
    if (normalized === 'justify') {
      return 'justify'
    }
    if (normalized === 'left' || normalized === 'start' || normalized === 'flex-start') {
      return direction === 'rtl' && normalized === 'start' ? 'right' : 'left'
    }
    return fromLayout ? '' : 'left'
  }

  /**
   * 规范化 CSS 垂直对齐。
   * @param value CSS 对齐值
   */
  private normalizeCssVerticalAlign(value: string): string {
    const normalized = String(value || '').trim()
    if (normalized === 'center' || normalized === 'middle') {
      return 'middle'
    }
    if (normalized === 'end' || normalized === 'flex-end' || normalized === 'bottom' || normalized === 'text-bottom') {
      return 'bottom'
    }
    if (normalized === 'start' || normalized === 'flex-start' || normalized === 'top' || normalized === 'text-top') {
      return 'top'
    }
    return ''
  }

  /**
   * 判断当前元素是否可把布局对齐直接映射到文本框。
   * @param element 文本元素
   */
  private isTextOnlyLayoutElement(element: HTMLElement): boolean {
    return element.children.length === 0 ||
      Array.from(element.children).every(child => INLINE_TEXT_TAGS.has(child.tagName.toLowerCase()))
  }

  /**
   * 判断是否为单行文本。
   * @param text 文本内容
   */
  private isSingleLineText(text: string): boolean {
    return !/[\r\n]/.test(text)
  }

  /**
   * 判断 line-height 是否表达了垂直居中。
   * @param element 文本元素
   * @param style 计算样式
   */
  private isLineHeightCentered(element: HTMLElement, style: CSSStyleDeclaration): boolean {
    const lineHeight = this.parseCssPixel(style.lineHeight)
    if (lineHeight <= 0) {
      return false
    }

    const cssHeight = this.parseCssPixel(style.height)
    const measuredHeight = this.measureElementPixels(element).height
    const measuredCssScale = this.cssPxToMeasuredPx(1)
    const measuredCssHeight = measuredCssScale > 0 ? measuredHeight / measuredCssScale : 0
    const targetHeight = cssHeight || measuredCssHeight
    return targetHeight > 0 && Math.abs(lineHeight - targetHeight) <= 1
  }

  /**
   * 构造元素摘要，用于报告和位置追踪。
   * @param element 源元素
   */
  private buildElementLabel(element: Element): string {
    const tagName = element.tagName.toLowerCase()
    const id = element.id ? `#${element.id}` : ''
    const className = element instanceof HTMLElement || element instanceof SVGElement
      ? String(element.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).map(item => `.${item}`).join('')
      : ''
    const text = this.normalizeText(element.textContent || '').slice(0, 40)
    return `${tagName}${id}${className}${text ? ` ${text}` : ''}`.slice(0, 120)
  }

  /**
   * 写入报告项。
   * @param sourceType 源类型
   * @param result 导出结果
   * @param editable 是否可编辑
   * @param label 对象摘要
   * @param reason 原因
   */
  private addReportItem(
    sourceType: PptxReportSourceType,
    result: PptxReportItemResult,
    editable: boolean,
    label: string,
    reason?: string,
    context?: VisitContext,
  ): void {
    const item: PptxExportReportItem = {
      pageIndex: this.options.pageIndex,
      pageTitle: this.options.pageTitle,
      pageRoute: this.options.pageRoute,
      sourceType,
      result,
      editable,
      label,
      reason,
      groupId: context?.groupId,
      parentGroupId: context?.parentGroupId,
      groupDepth: context?.groupId ? context.groupDepth : undefined,
      groupLabel: context?.groupLabel,
    }
    this.reportPage.items.push(item)
  }

  /**
   * 添加跳过报告项。
   * @param sourceType 源类型
   * @param label 对象摘要
   * @param reason 跳过原因
   */
  private addSkippedItem(sourceType: PptxReportSourceType, label: string, reason: string, context?: VisitContext): void {
    this.addReportItem(sourceType, 'skipped', false, label, reason, context)
  }
}
