/**
 * 文件用途：封装 PPTX DOM 转换中需要降级截图的 3D CSS 视觉识别。
 */

import { MEDIA_SELECTORS } from '@/core/services/pptx/PPTXDomConverter.types'
import type { PPTXDomConverterLayout } from '@/core/services/pptx/PPTXDomConverterLayout'

export const PPTX_3D_SCREENSHOT_REASON = '3D CSS 视觉降级为局部截图'

const PAGE_AREA_SCREENSHOT_THRESHOLD = 0.82

/**
 * 负责识别 PPTX 难以原生表达的 3D CSS 子树，并选择稳定截图宿主。
 */
export class PPTXDomConverterRaster {
  constructor(private readonly layout: PPTXDomConverterLayout) {}

  /**
   * 解析当前元素是否应因 3D CSS 视觉降级截图。
   * @param element 当前访问元素
   * @param pageElement 页面根元素
   * @returns 需要截图的 HTML 元素；不命中时返回 null
   */
  resolve3dScreenshotTarget(element: Element, pageElement: HTMLElement): HTMLElement | null {
    if (element === pageElement) {
      return null
    }

    if (element instanceof HTMLElement) {
      const groupTarget = this.resolve3dGroupTarget(element, pageElement)
      if (groupTarget) {
        return groupTarget
      }
    }

    if (this.hasOwn3dVisual(element)) {
      return this.resolveOwn3dTarget(element, pageElement)
    }

    if (this.isTerminalMediaElement(element) && this.contains3dVisual(element)) {
      return this.resolveMediaDescendantTarget(element, pageElement)
    }

    return null
  }

  /**
   * 判断元素自身是否启用了会产生 3D 视觉的 CSS。
   * @param element 候选元素
   */
  hasOwn3dVisual(element: Element): boolean {
    const style = window.getComputedStyle(element)
    if (this.has3dTransform(style.transform)) {
      return true
    }

    return (this.hasPreserve3d(style) || this.hasCssPerspective(style)) &&
      !this.shouldDefer3dContextContainer(element)
  }

  /**
   * 判断元素或其后代是否包含 3D CSS 触发点。
   * @param element 候选元素
   */
  contains3dVisual(element: Element): boolean {
    if (this.hasOwn3dTrigger(element)) {
      return true
    }

    return Array.from(element.children).some(child => this.contains3dVisual(child))
  }

  /**
   * 当多个直接子分支都包含 3D 视觉时，优先截图共同父容器。
   * @param element 候选父容器
   * @param pageElement 页面根元素
   */
  private resolve3dGroupTarget(element: HTMLElement, pageElement: HTMLElement): HTMLElement | null {
    if (element === pageElement || this.isNearPageArea(element, pageElement)) {
      return null
    }

    const branches = this.collectDirect3dBranches(element)
    if (branches.length < 2 || this.hasMeaningfulTextOutsideBranches(element, branches)) {
      return null
    }

    return element
  }

  /**
   * 收集当前容器下直接包含 3D 视觉的可见子分支。
   * @param element 候选父容器
   */
  private collectDirect3dBranches(element: HTMLElement): Element[] {
    return Array.from(element.children).filter(child => {
      return this.layout.isVisibleElement(child) && this.contains3dVisual(child)
    })
  }

  /**
   * 识别所有 3D 相关 CSS 触发点，包含只作为子级上下文的 perspective。
   * @param element 候选元素
   */
  private hasOwn3dTrigger(element: Element): boolean {
    const style = window.getComputedStyle(element)
    return this.has3dTransform(style.transform) ||
      this.hasPreserve3d(style) ||
      this.hasCssPerspective(style)
  }

  /**
   * 判断 transform 是否包含 PPTX 难以还原的 3D 函数。
   * @param value transform 计算值或声明值
   */
  private has3dTransform(value: string): boolean {
    const normalizedValue = String(value || '').trim()
    if (!normalizedValue || normalizedValue === 'none') {
      return false
    }

    if (/\b(?:perspective|rotatex|rotatey|rotate3d)\s*\(/i.test(normalizedValue)) {
      return true
    }

    const matrix3d = /\bmatrix3d\(([^)]+)\)/i.exec(normalizedValue)
    return Boolean(matrix3d && !this.isPureTranslateMatrix3d(matrix3d[1]))
  }

  /**
   * 判断 matrix3d 是否只表达位移，纯 translate3d 不需要截图。
   * @param value matrix3d 参数列表
   */
  private isPureTranslateMatrix3d(value: string): boolean {
    const values = this.parseTransformNumberList(value)
    if (values.length !== 16) {
      return false
    }

    return values.every((item, index) => {
      if ([12, 13, 14].includes(index)) {
        return true
      }
      return this.isNearlyEqual(item, [0, 5, 10, 15].includes(index) ? 1 : 0)
    })
  }

  /**
   * 解析 transform 矩阵参数为数字列表。
   * @param value 逗号或空格分隔参数
   */
  private parseTransformNumberList(value: string): number[] {
    return value
      .split(/[,\s]+/)
      .map(item => Number.parseFloat(item))
      .filter(item => Number.isFinite(item))
  }

  /**
   * 浮点近似比较，避免浏览器矩阵小数误差导致误判。
   * @param actual 实际值
   * @param expected 期望值
   */
  private isNearlyEqual(actual: number, expected: number): boolean {
    return Math.abs(actual - expected) <= 0.0001
  }

  /**
   * 判断 transform-style 是否保留 3D 子级空间。
   * @param style 计算样式
   */
  private hasPreserve3d(style: CSSStyleDeclaration): boolean {
    const style3d = style as CSSStyleDeclaration & { transformStyle?: string }
    return String(style3d.transformStyle || style.getPropertyValue('transform-style') || '').trim() === 'preserve-3d'
  }

  /**
   * 判断 CSS perspective 属性是否启用。
   * @param style 计算样式
   */
  private hasCssPerspective(style: CSSStyleDeclaration): boolean {
    const style3d = style as CSSStyleDeclaration & { perspective?: string }
    const value = String(style3d.perspective || style.getPropertyValue('perspective') || '').trim().toLowerCase()
    if (!value || value === 'none') {
      return false
    }

    const numeric = Number.parseFloat(value)
    return !Number.isFinite(numeric) || numeric > 0
  }

  /**
   * 3D 上下文只影响子级投影，普通容器先交给子树或分组规则处理。
   * @param element 候选元素
   */
  private shouldDefer3dContextContainer(element: Element): boolean {
    if (this.isTerminalMediaElement(element)) {
      return false
    }

    return element.children.length > 0
  }

  /**
   * 为自身带 3D 视觉的元素选择截图宿主。
   * @param element 当前元素
   * @param pageElement 页面根元素
   */
  private resolveOwn3dTarget(element: Element, pageElement: HTMLElement): HTMLElement | null {
    if (element instanceof HTMLElement) {
      if (this.isMediaLeafElement(element)) {
        return this.resolveMediaLeafWrapper(element, pageElement)
      }
      return element === pageElement ? null : element
    }

    return this.resolveNearestHtmlWrapper(element, pageElement)
  }

  /**
   * 媒体终止节点包含 3D 后代时，截图媒体宿主本身。
   * @param element 当前媒体元素
   * @param pageElement 页面根元素
   */
  private resolveMediaDescendantTarget(element: Element, pageElement: HTMLElement): HTMLElement | null {
    if (element instanceof HTMLElement) {
      return element === pageElement ? null : element
    }

    return this.resolveNearestHtmlWrapper(element, pageElement)
  }

  /**
   * 媒体叶子节点优先提升到只有它一个可见子元素的包裹层，保留圆角和阴影。
   * @param element 媒体叶子元素
   * @param pageElement 页面根元素
   */
  private resolveMediaLeafWrapper(element: HTMLElement, pageElement: HTMLElement): HTMLElement | null {
    const parent = element.parentElement
    if (
      parent &&
      parent !== pageElement &&
      this.collectVisibleChildren(parent).length === 1 &&
      !this.hasMeaningfulDirectText(parent)
    ) {
      return parent
    }

    return element === pageElement ? null : element
  }

  /**
   * 为非 HTML 元素查找最近 HTML 截图宿主。
   * @param element 当前元素
   * @param pageElement 页面根元素
   */
  private resolveNearestHtmlWrapper(element: Element, pageElement: HTMLElement): HTMLElement | null {
    const parent = element.parentElement
    if (!parent || parent === pageElement) {
      return null
    }

    return parent
  }

  /**
   * 判断当前元素是否属于转换器不会继续深入的媒体节点。
   * @param element 候选元素
   */
  private isTerminalMediaElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase()
    return element.matches(MEDIA_SELECTORS) || ['img', 'svg', 'canvas', 'video'].includes(tagName)
  }

  /**
   * 判断当前元素是否为普通媒体叶子节点。
   * @param element 候选元素
   */
  private isMediaLeafElement(element: HTMLElement): boolean {
    return ['img', 'canvas', 'video'].includes(element.tagName.toLowerCase())
  }

  /**
   * 判断候选容器是否接近整页，避免误把页面大布局整块栅格化。
   * @param element 候选容器
   * @param pageElement 页面根元素
   */
  private isNearPageArea(element: HTMLElement, pageElement: HTMLElement): boolean {
    const elementBox = this.layout.measureElementPixels(element)
    const pageBox = this.layout.measureElementPixels(pageElement)
    const pageArea = pageBox.width * pageBox.height
    const elementArea = elementBox.width * elementBox.height
    return pageArea > 0 && elementArea / pageArea > PAGE_AREA_SCREENSHOT_THRESHOLD
  }

  /**
   * 判断 3D 分支之外是否存在应保留可编辑的文本。
   * @param element 候选父容器
   * @param branches 直接 3D 子分支
   */
  private hasMeaningfulTextOutsideBranches(element: HTMLElement, branches: Element[]): boolean {
    if (this.hasMeaningfulDirectText(element)) {
      return true
    }

    const branchSet = new Set(branches)
    return Array.from(element.children).some(child => {
      return !branchSet.has(child) && this.subtreeHasMeaningfulText(child)
    })
  }

  /**
   * 判断元素的直属文本节点是否包含有效文本。
   * @param element 候选元素
   */
  private hasMeaningfulDirectText(element: Element): boolean {
    return Array.from(element.childNodes).some(node => {
      return node instanceof Text && Boolean(this.layout.normalizeText(node.textContent || ''))
    })
  }

  /**
   * 判断子树中是否包含有效文本。
   * @param element 候选元素
   */
  private subtreeHasMeaningfulText(element: Element): boolean {
    return Boolean(this.layout.normalizeText(element.textContent || ''))
  }

  /**
   * 收集可见直接子元素。
   * @param element 候选父元素
   */
  private collectVisibleChildren(element: HTMLElement): Element[] {
    return Array.from(element.children).filter(child => this.layout.isVisibleElement(child))
  }
}
