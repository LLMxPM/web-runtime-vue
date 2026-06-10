/**
 * 文件用途：封装 Runtime Kit DataTable 到 PPTX 原生表格的导出逻辑。
 */

import type {
  PptxExportReportItem,
  PptxReportItemResult,
  PptxReportSourceType,
} from '@/core/types/pptx-export'
import type { ParsedColor } from '@/core/services/pptx/PPTXCssParser'
import type {
  BorderInfo,
  ElementBox,
  PptxPageConvertOptions,
  PptxTableCellLike,
  PptxTableRowLike,
  VisitContext,
} from '@/core/services/pptx/PPTXDomConverter.types'
import type { PPTXDomConverterLayout } from '@/core/services/pptx/PPTXDomConverterLayout'

export interface PptxDomTableExportHost {
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
  addSkippedItem: (sourceType: PptxReportSourceType, label: string, reason: string, context?: VisitContext) => void
}

interface RuntimeTableCellEntry {
  element: HTMLElement
  rowIndex: number
  columnIndex: number
}

/**
 * Runtime Kit 表格导出 helper。
 */
export class PPTXDomConverterTable {
  constructor(private readonly layout: PPTXDomConverterLayout) {}

  /**
   * 判断元素是否为 Runtime Kit DataTable 根节点。
   * @param element 候选元素
   */
  isTableElement(element: Element): boolean {
    return element instanceof HTMLElement && element.getAttribute('data-runtime-kit-table') === 'v1'
  }

  /**
   * 将 DataTable 导出为 PPT 原生表格。
   * @param host 导出宿主能力
   * @param element DataTable 根节点
   * @param context 当前组合上下文
   */
  addTableElement(host: PptxDomTableExportHost, element: HTMLElement, context: VisitContext): boolean {
    const box = this.layout.getPptxBox(element)
    const label = this.layout.buildElementLabel(element)
    if (!box) {
      host.addSkippedItem('table', label, '表格尺寸无效，无法导出为 PPT 原生表格', context)
      return true
    }

    const entries = this.collectCellEntries(element)
    const rowCount = this.resolveRowCount(element, entries)
    const columnCount = this.resolveColumnCount(element, entries)
    if (rowCount <= 0 || columnCount <= 0) {
      host.addSkippedItem('table', label, '表格没有有效单元格，已跳过', context)
      return true
    }

    const tableRows = this.buildTableRows(entries, rowCount, columnCount, context)
    host.options.slide.addTable(tableRows, {
      ...box,
      rowH: this.resolveRowHeights(entries, box, rowCount),
      colW: this.resolveColumnWidths(entries, box, columnCount),
      autoPage: false,
      fit: 'shrink',
      margin: 0,
      ...host.buildPptObjectMeta(context, 'table', label),
    })
    host.addReportItem('table', 'editable-table', true, label, 'Runtime Kit 表格导出为 PPT 原生表格', context)
    return true
  }

  /**
   * 收集带行列索引的单元格节点。
   * @param tableElement DataTable 根节点
   */
  private collectCellEntries(tableElement: HTMLElement): RuntimeTableCellEntry[] {
    return Array.from(tableElement.querySelectorAll('[data-runtime-kit-table-cell="v1"]'))
      .filter((cell): cell is HTMLElement => cell instanceof HTMLElement)
      .map(cell => ({
        element: cell,
        rowIndex: Number(cell.dataset.rowIndex),
        columnIndex: Number(cell.dataset.columnIndex),
      }))
      .filter(entry => Number.isInteger(entry.rowIndex) && entry.rowIndex >= 0 && Number.isInteger(entry.columnIndex) && entry.columnIndex >= 0)
      .sort((left, right) => {
        return left.rowIndex === right.rowIndex
          ? left.columnIndex - right.columnIndex
          : left.rowIndex - right.rowIndex
      })
  }

  /**
   * 构造 pptxgenjs addTable 所需二维行数据。
   * @param entries 单元格条目
   * @param rowCount 行数
   * @param columnCount 列数
   * @param context 当前文本继承上下文
   */
  private buildTableRows(
    entries: RuntimeTableCellEntry[],
    rowCount: number,
    columnCount: number,
    context: VisitContext,
  ): PptxTableRowLike[] {
    const cellsByKey = new Map(entries.map(entry => [`${entry.rowIndex},${entry.columnIndex}`, entry]))

    return Array.from({ length: rowCount }, (_, rowIndex) => {
      return Array.from({ length: columnCount }, (_, columnIndex) => {
        const entry = cellsByKey.get(`${rowIndex},${columnIndex}`)
        if (!entry) {
          return { text: '', options: { fit: 'shrink' } }
        }
        return this.buildTableCell(entry.element, context)
      })
    })
  }

  /**
   * 构造单个 PPT 表格单元格。
   * @param element 单元格 DOM
   * @param context 当前文本继承上下文
   */
  private buildTableCell(element: HTMLElement, context: VisitContext): PptxTableCellLike {
    const text = this.layout.normalizeText(element.textContent || '')
    const style = window.getComputedStyle(element)
    return {
      text,
      options: {
        ...this.buildTextOptions(element, style, text, context),
        ...this.buildCellVisualOptions(element, style),
        margin: this.buildCellMargin(element, style),
        fit: 'shrink',
      },
    }
  }

  /**
   * 构造单元格文字样式。
   * @param element 单元格 DOM
   * @param style 计算样式
   * @param text 单元格文本
   * @param context 当前文本继承上下文
   */
  private buildTextOptions(
    element: HTMLElement,
    style: CSSStyleDeclaration,
    text: string,
    context: VisitContext,
  ): Record<string, unknown> {
    const color = this.applyOpacity(this.layout.parseCssColor(style.color, element), this.layout.parseOpacity(style.opacity))
    return {
      fontFace: this.layout.normalizeFontFace(style.fontFamily, text),
      fontSize: Math.max(1, this.layout.cssPxToPt(this.layout.parseCssPixel(style.fontSize) || 16)),
      color: color?.hex || '000000',
      transparency: this.layout.alphaToTransparency(color?.alpha ?? 1),
      bold: this.layout.isBoldFont(style.fontWeight),
      italic: style.fontStyle === 'italic',
      underline: style.textDecorationLine.includes('underline'),
      align: this.layout.resolveTextHorizontalAlign(element, style, context),
      valign: this.layout.resolveTextVerticalAlign(element, style, text, context),
    }
  }

  /**
   * 构造单元格背景和边框样式。
   * @param element 单元格 DOM
   * @param style 计算样式
   */
  private buildCellVisualOptions(element: HTMLElement, style: CSSStyleDeclaration): Record<string, unknown> {
    const elementOpacity = this.layout.parseOpacity(style.opacity)
    const fillColor = this.applyOpacity(
      this.layout.parseCssColor(this.layout.resolveBackgroundColorValue(element, style), element),
      elementOpacity,
    )
    const borders = this.layout.getBorderInfos(element, style).map(border => ({
      ...border,
      color: this.applyOpacity(border.color, elementOpacity) || border.color,
    }))

    return {
      ...(fillColor ? {
        fill: {
          color: fillColor.hex,
          transparency: this.layout.alphaToTransparency(fillColor.alpha),
        },
      } : {}),
      border: this.buildTableBorderOptions(borders),
    }
  }

  /**
   * 将 CSS 单元格边框映射为 pptxgenjs 表格边框数组。
   * @param borders 计算后的四边边框
   */
  private buildTableBorderOptions(borders: BorderInfo[]): Array<Record<string, unknown>> {
    const borderBySide = new Map(borders.map(border => [border.side, border]))
    return (['top', 'right', 'bottom', 'left'] as const).map(side => {
      const border = borderBySide.get(side)
      if (!border) {
        return {
          type: 'none',
          color: 'FFFFFF',
          pt: 0,
        }
      }
      return {
        type: border.style === 'dashed' || border.style === 'dotted' ? 'dash' : 'solid',
        color: border.color.hex,
        pt: border.widthPt,
      }
    })
  }

  /**
   * 将 CSS padding 转为 PPT 表格单元格 margin。
   * @param element 单元格 DOM
   * @param style 计算样式
   */
  private buildCellMargin(element: HTMLElement, style: CSSStyleDeclaration): number | [number, number, number, number] {
    const padding = this.layout.resolveElementPaddingPixels(element, style)
    const margin: [number, number, number, number] = [
      this.layout.cssPxToPt(padding.top),
      this.layout.cssPxToPt(padding.right),
      this.layout.cssPxToPt(padding.bottom),
      this.layout.cssPxToPt(padding.left),
    ]
    return margin.some(value => value > 0) ? margin : 0
  }

  /**
   * 根据单元格测量结果解析每行高度。
   * @param entries 单元格条目
   * @param box 表格 PPT 盒模型
   * @param rowCount 行数
   */
  private resolveRowHeights(entries: RuntimeTableCellEntry[], box: ElementBox, rowCount: number): number[] {
    const fallbackHeight = this.layout.roundInch(box.h / rowCount)
    return Array.from({ length: rowCount }, (_, rowIndex) => {
      const measuredHeight = entries
        .filter(entry => entry.rowIndex === rowIndex)
        .reduce((maxHeight, entry) => Math.max(maxHeight, this.layout.measureElementPixels(entry.element).height), 0)
      return measuredHeight > 0
        ? this.layout.roundInch(measuredHeight * this.layout.inchPerPxY())
        : fallbackHeight
    })
  }

  /**
   * 根据单元格测量结果解析每列宽度。
   * @param entries 单元格条目
   * @param box 表格 PPT 盒模型
   * @param columnCount 列数
   */
  private resolveColumnWidths(entries: RuntimeTableCellEntry[], box: ElementBox, columnCount: number): number[] {
    const fallbackWidth = this.layout.roundInch(box.w / columnCount)
    return Array.from({ length: columnCount }, (_, columnIndex) => {
      const measuredWidth = entries
        .filter(entry => entry.columnIndex === columnIndex)
        .reduce((maxWidth, entry) => Math.max(maxWidth, this.layout.measureElementPixels(entry.element).width), 0)
      return measuredWidth > 0
        ? this.layout.roundInch(measuredWidth * this.layout.inchPerPxX())
        : fallbackWidth
    })
  }

  /**
   * 解析表格行数。
   * @param tableElement 表格根节点
   * @param entries 单元格条目
   */
  private resolveRowCount(tableElement: HTMLElement, entries: RuntimeTableCellEntry[]): number {
    const declaredRowCount = Number(tableElement.getAttribute('aria-rowcount'))
    if (Number.isInteger(declaredRowCount) && declaredRowCount > 0) {
      return declaredRowCount
    }
    return entries.reduce((maxIndex, entry) => Math.max(maxIndex, entry.rowIndex + 1), 0)
  }

  /**
   * 解析表格列数。
   * @param tableElement 表格根节点
   * @param entries 单元格条目
   */
  private resolveColumnCount(tableElement: HTMLElement, entries: RuntimeTableCellEntry[]): number {
    const declaredColumnCount = Number(tableElement.getAttribute('aria-colcount'))
    if (Number.isInteger(declaredColumnCount) && declaredColumnCount > 0) {
      return declaredColumnCount
    }
    return entries.reduce((maxIndex, entry) => Math.max(maxIndex, entry.columnIndex + 1), 0)
  }

  /**
   * 对颜色叠加元素 opacity。
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
}
