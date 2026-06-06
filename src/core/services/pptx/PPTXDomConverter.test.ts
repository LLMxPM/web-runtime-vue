// @vitest-environment jsdom

/**
 * 文件用途：验证 PPTX DOM 转换器对文本、简单形状、SVG、视频封面和复杂 CSS 的分类逻辑。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PPTXDomConverter, type PptxGradientFillInstruction } from './PPTXDomConverter'

const shapeTypes = {
  rect: 'rect',
  roundRect: 'roundRect',
  line: 'line',
}

describe('PPTXDomConverter', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('应将标题、正文、关键数字和简单形状转换为可编辑对象', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px; background: #ffffff;">
        <section style="width: 800px; height: 320px; background: rgb(248, 250, 252); border: 1px solid rgb(203, 213, 225); border-radius: 12px;">
          <h1 style="width: 600px; height: 64px; font-size: 40px; font-weight: 700; color: rgb(15, 23, 42);">业务增长概览</h1>
          <p style="width: 620px; height: 48px; font-size: 20px; color: rgb(71, 85, 105);">核心指标保持稳定增长</p>
          <strong style="display: block; width: 260px; height: 72px; font-size: 56px; font-weight: 700; color: rgb(37, 99, 235);">128%</strong>
          <div style="width: 500px; height: 2px; background: rgb(15, 23, 42);"></div>
        </section>
      </div>
    `

    const report = await convert(slide)

    expect(slide.addText).toHaveBeenCalledTimes(3)
    expect(slide.addText).toHaveBeenCalledWith('业务增长概览', expect.objectContaining({ fontSize: 20 }))
    expect(slide.addText).toHaveBeenCalledWith('核心指标保持稳定增长', expect.objectContaining({ fontSize: 10 }))
    expect(slide.addText).toHaveBeenCalledWith('128%', expect.objectContaining({ fontSize: 28 }))
    expect(slide.addShape).toHaveBeenCalledWith('roundRect', expect.objectContaining({
      fill: expect.objectContaining({ color: 'F8FAFC' }),
      line: expect.objectContaining({ color: 'CBD5E1' }),
    }))
    expect(slide.addShape).toHaveBeenCalledWith('line', expect.any(Object))
    expect(report.items.filter(item => item.result === 'editable-text')).toHaveLength(3)
    expect(report.items.filter(item => item.result === 'editable-shape')).toHaveLength(2)
    expect(report.items.map(item => item.sourceType)).toEqual(expect.arrayContaining(['title', 'body', 'number', 'shape']))
  })

  it('应将多级 div/span 展开为按层级排列的多个组合对象', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px; background: #ffffff;">
        <div id="card" style="width: 700px; height: 360px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 16px;">
          <span id="badge" style="display: inline-block; width: 96px; height: 36px; background: #dbeafe; border-radius: 18px; color: #1d4ed8; font-size: 18px; font-weight: 700;">Q2</span>
          <div id="metric" style="width: 320px; height: 120px;">
            <span style="display: inline-block; width: 120px; height: 32px; font-size: 20px; color: #334155;">Revenue</span>
            <strong style="display: inline-block; width: 180px; height: 72px; font-size: 56px; color: #16a34a;">128%</strong>
          </div>
        </div>
      </div>
    `

    const report = await convert(slide)
    const events = slide.__events

    expect(events[0]).toEqual(expect.objectContaining({ kind: 'shape', shapeName: 'roundRect' }))
    expect(events.some(event => event.kind === 'text' && event.text === 'Q2')).toBe(true)
    expect(events.some(event => event.kind === 'text' && event.text === 'Revenue')).toBe(true)
    expect(events.some(event => event.kind === 'text' && event.text === '128%')).toBe(true)
    expect(events.some(event => event.kind === 'text' && event.text === 'Q2 Revenue 128%')).toBe(false)

    const cardShape = report.items.find(item => item.label.includes('div#card') && item.result === 'editable-shape')
    const badgeShape = report.items.find(item => item.label.includes('span#badge') && item.result === 'editable-shape')
    const numberText = report.items.find(item => item.label === '128%')

    expect(cardShape?.groupId).toBeTruthy()
    expect(badgeShape?.groupId).toBeTruthy()
    expect(badgeShape?.parentGroupId).toBe(cardShape?.groupId)
    expect(numberText).toEqual(expect.objectContaining({
      sourceType: 'number',
      groupId: expect.any(String),
      parentGroupId: cardShape?.groupId,
    }))
    expect(String((events[0].options as Record<string, unknown>).objectName)).toContain(cardShape?.groupId)
  })

  it('应导出 flex 列表项中 span 后的直属文本节点', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px; background: #ffffff;">
        <ul style="width: 720px; height: 120px;">
          <li class="flex items-start text-secondary" style="width: 720px; height: 32px; font-size: 20px; color: #475569;">
            <span class="text-primary mr-2" style="display: inline-block; width: 16px; height: 24px; color: #2563eb;">•</span>
            多用户登录、会话和平台用户管理
          </li>
        </ul>
      </div>
    `

    const listItem = document.querySelector('li') as HTMLElement
    const bullet = listItem.querySelector('span') as HTMLElement
    const bodyTextNode = Array.from(listItem.childNodes).find((node): node is Text => {
      return node.nodeType === Node.TEXT_NODE && /多用户登录/.test(node.textContent || '')
    }) as Text
    const createRect = (left: number, top: number, width: number, height: number) => ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    })

    vi.spyOn(listItem, 'getBoundingClientRect').mockReturnValue(createRect(100, 120, 720, 32))
    vi.spyOn(bullet, 'getBoundingClientRect').mockReturnValue(createRect(100, 120, 16, 24))
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let currentNode: Node | null = null
      const textRect = createRect(124, 120, 300, 24)
      return {
        selectNodeContents: (node: Node) => {
          currentNode = node
        },
        getClientRects: () => currentNode === bodyTextNode ? [textRect] : [],
        getBoundingClientRect: () => currentNode === bodyTextNode ? textRect : createRect(0, 0, 0, 0),
      } as unknown as Range
    })

    const report = await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('•', expect.objectContaining({
      color: '2563EB',
    }))
    expect(slide.addText).toHaveBeenCalledWith('多用户登录、会话和平台用户管理', expect.objectContaining({
      color: '475569',
    }))
    expect(slide.addText).not.toHaveBeenCalledWith('• 多用户登录、会话和平台用户管理', expect.any(Object))
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: '•',
        result: 'editable-text',
      }),
      expect.objectContaining({
        label: '多用户登录、会话和平台用户管理',
        sourceType: 'body',
        result: 'editable-text',
        reason: '直属文本节点转为 PPT text',
      }),
    ]))
  })

  it('应对直属文本节点中的长英文 token 追加更积极的宽度保护', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px; background: #ffffff;">
        <ul style="width: 720px; height: 120px;">
          <li class="flex items-start text-secondary" style="width: 720px; height: 32px; font-size: 20px; color: #475569;">
            <span class="text-accent1 mr-2" style="display: inline-block; width: 16px; height: 24px; color: #0f766e;">•</span>
            runtime-kit.manifest.json 是 Backend 校验的单一事实源
          </li>
        </ul>
      </div>
    `

    const listItem = document.querySelector('li') as HTMLElement
    const bullet = listItem.querySelector('span') as HTMLElement
    const bodyTextNode = Array.from(listItem.childNodes).find((node): node is Text => {
      return node.nodeType === Node.TEXT_NODE && /runtime-kit\.manifest\.json/.test(node.textContent || '')
    }) as Text
    const createRect = (left: number, top: number, width: number, height: number) => ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    })

    vi.spyOn(listItem, 'getBoundingClientRect').mockReturnValue(createRect(100, 120, 720, 32))
    vi.spyOn(bullet, 'getBoundingClientRect').mockReturnValue(createRect(100, 120, 16, 24))
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let currentNode: Node | null = null
      const textRect = createRect(124, 120, 240, 24)
      return {
        selectNodeContents: (node: Node) => {
          currentNode = node
        },
        getClientRects: () => currentNode === bodyTextNode ? [textRect] : [],
        getBoundingClientRect: () => currentNode === bodyTextNode ? textRect : createRect(0, 0, 0, 0),
      } as unknown as Range
    })

    await convert(slide)
    const bodyTextCall = slide.addText.mock.calls.find(([text]) => text === 'runtime-kit.manifest.json 是 Backend 校验的单一事实源')?.[1] as Record<string, unknown>
    const originalTextWidth = (240 / 1920) * 13.333

    expect(bodyTextCall).toEqual(expect.objectContaining({
      color: '475569',
    }))
    expect(bodyTextCall?.w as number).toBeGreaterThan(originalTextWidth + 0.15)
  })

  it('应对斜杠分隔的中英混排直属文本追加通用宽度保护', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px; background: #ffffff;">
        <ul style="width: 720px; height: 120px;">
          <li class="flex items-start text-secondary" style="width: 720px; height: 32px; font-size: 20px; color: #475569;">
            <span class="text-accent2 mr-2" style="display: inline-block; width: 16px; height: 24px; color: #7c3aed;">•</span>
            通过 Docker / Docker Compose / GitHub Actions 负责服务编排
          </li>
        </ul>
      </div>
    `

    const listItem = document.querySelector('li') as HTMLElement
    const bullet = listItem.querySelector('span') as HTMLElement
    const bodyTextNode = Array.from(listItem.childNodes).find((node): node is Text => {
      return node.nodeType === Node.TEXT_NODE && /Docker Compose/.test(node.textContent || '')
    }) as Text
    const createRect = (left: number, top: number, width: number, height: number) => ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    })

    vi.spyOn(listItem, 'getBoundingClientRect').mockReturnValue(createRect(100, 120, 720, 32))
    vi.spyOn(bullet, 'getBoundingClientRect').mockReturnValue(createRect(100, 120, 16, 24))
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let currentNode: Node | null = null
      const textRect = createRect(124, 120, 240, 24)
      return {
        selectNodeContents: (node: Node) => {
          currentNode = node
        },
        getClientRects: () => currentNode === bodyTextNode ? [textRect] : [],
        getBoundingClientRect: () => currentNode === bodyTextNode ? textRect : createRect(0, 0, 0, 0),
      } as unknown as Range
    })

    await convert(slide)
    const bodyTextCall = slide.addText.mock.calls.find(([text]) => text === '通过 Docker / Docker Compose / GitHub Actions 负责服务编排')?.[1] as Record<string, unknown>
    const originalTextWidth = (240 / 1920) * 13.333

    expect(bodyTextCall).toEqual(expect.objectContaining({
      color: '475569',
    }))
    expect(bodyTextCall?.w as number).toBeGreaterThan(originalTextWidth + 0.14)
  })

  it('应对块级长英文 token 文本追加通用宽度保护', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <p style="position: absolute; left: 120px; top: 80px; width: 240px; height: 24px; font-size: 20px; color: #475569;">
          runtime-kit.manifest.json 是 Backend 校验的单一事实源
        </p>
      </div>
    `

    await convert(slide)
    const textCall = slide.addText.mock.calls.find(([text]) => text === 'runtime-kit.manifest.json 是 Backend 校验的单一事实源')?.[1] as Record<string, unknown>
    const originalTextWidth = (240 / 1920) * 13.333

    expect(textCall).toEqual(expect.objectContaining({
      color: '475569',
    }))
    expect(textCall?.w as number).toBeGreaterThan(originalTextWidth + 0.15)
  })

  it('应让 flex 图标卡片中的正文段落占用祖先剩余宽度', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px; background: #ffffff;">
        <div class="flex items-start" style="width: 560px; height: 80px;">
          <div class="w-8 h-8 bg-secondary/10 rounded-lg flex items-center justify-center mr-4 mt-1" style="width: 32px; height: 32px; margin-right: 16px; margin-top: 4px;">
            <span class="text-secondary font-bold" style="display: inline-block; width: 12px; height: 20px; color: #475569; font-weight: 700;">2</span>
          </div>
          <div>
            <p class="text-lg text-secondary" style="font-size: 20px; color: #475569;">
              确认子仓库 Docker Release 已推送 web-runtime-vue:sha-12位提交
            </p>
          </div>
        </div>
      </div>
    `

    const row = document.querySelector('.flex.items-start') as HTMLElement
    const iconBox = row.children[0] as HTMLElement
    const textWrapper = row.children[1] as HTMLElement
    const paragraph = textWrapper.querySelector('p') as HTMLElement
    const createRect = (left: number, top: number, width: number, height: number) => ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    })

    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(createRect(100, 120, 560, 80))
    vi.spyOn(iconBox, 'getBoundingClientRect').mockReturnValue(createRect(100, 124, 32, 32))
    vi.spyOn(textWrapper, 'getBoundingClientRect').mockReturnValue(createRect(148, 120, 240, 48))
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue(createRect(148, 120, 240, 24))

    await convert(slide)
    const textCall = slide.addText.mock.calls.find(([text]) => text === '确认子仓库 Docker Release 已推送 web-runtime-vue:sha-12位提交')?.[1] as Record<string, unknown>
    const paragraphOriginalWidth = (240 / 1920) * 13.333
    const rowRemainingWidth = ((100 + 560 - 148) / 1920) * 13.333

    expect(textCall).toEqual(expect.objectContaining({
      color: '475569',
    }))
    expect(textCall?.w as number).toBeGreaterThan(paragraphOriginalWidth + 0.6)
    expect(textCall?.w as number).toBeGreaterThan(rowRemainingWidth - 0.05)
  })

  it('不应将显式宽度约束的段落错误扩展到祖先剩余宽度', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px; background: #ffffff;">
        <div class="flex items-start" style="width: 560px; height: 80px;">
          <div class="w-8 h-8 bg-secondary/10 rounded-lg flex items-center justify-center mr-4 mt-1" style="width: 32px; height: 32px; margin-right: 16px; margin-top: 4px;">
            <span class="text-secondary font-bold" style="display: inline-block; width: 12px; height: 20px; color: #475569; font-weight: 700;">2</span>
          </div>
          <div style="width: 240px; height: 48px;">
            <p class="text-lg text-secondary" style="width: 240px; height: 24px; font-size: 20px; color: #475569;">
              确认子仓库 Docker Release 已推送 web-runtime-vue:sha-12位提交
            </p>
          </div>
        </div>
      </div>
    `

    const row = document.querySelector('.flex.items-start') as HTMLElement
    const iconBox = row.children[0] as HTMLElement
    const textWrapper = row.children[1] as HTMLElement
    const paragraph = textWrapper.querySelector('p') as HTMLElement
    const createRect = (left: number, top: number, width: number, height: number) => ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    })

    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(createRect(100, 120, 560, 80))
    vi.spyOn(iconBox, 'getBoundingClientRect').mockReturnValue(createRect(100, 124, 32, 32))
    vi.spyOn(textWrapper, 'getBoundingClientRect').mockReturnValue(createRect(148, 120, 240, 48))
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue(createRect(148, 120, 240, 24))

    await convert(slide)
    const textCall = slide.addText.mock.calls.find(([text]) => text === '确认子仓库 Docker Release 已推送 web-runtime-vue:sha-12位提交')?.[1] as Record<string, unknown>
    const rowRemainingWidth = ((100 + 560 - 148) / 1920) * 13.333

    expect(textCall).toEqual(expect.objectContaining({
      color: '475569',
    }))
    expect(textCall?.w as number).toBeLessThan(rowRemainingWidth - 0.2)
  })

  it('应按设计画布计算字体大小，避免缩放预览导致字号放大', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <h1 style="width: 600px; height: 64px; font-size: 40px;">缩放页标题</h1>
      </div>
    `
    const pageElement = document.getElementById('page') as HTMLElement
    vi.spyOn(pageElement, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 960,
      bottom: 540,
      width: 960,
      height: 540,
      toJSON: () => ({}),
    })

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('缩放页标题', expect.objectContaining({
      fontSize: 20,
    }))
  })

  it('应将所有 PPT 文本框设置为不自动调整', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <p style="width: 360px; height: 32px; font-size: 16px;">普通文本</p>
        <span class="rounded-full px-3 py-1" style="display: inline-block; width: 96px; height: 24px; background: #bfdbfe; border-radius: 9999px; font-size: 12px;">徽标文本</span>
      </div>
    `

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('普通文本', expect.objectContaining({
      fit: 'none',
    }))
    expect(slide.addText).toHaveBeenCalledWith('徽标文本', expect.objectContaining({
      fit: 'none',
      shape: 'roundRect',
    }))
  })

  it('应给文本框增加宽度冗余以避免末字换行', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <p style="position: absolute; left: 120px; top: 40px; width: 360px; height: 32px; font-size: 16px;">左对齐文本</p>
        <p style="position: absolute; left: 120px; top: 90px; width: 360px; height: 32px; font-size: 16px; text-align: center;">居中文本</p>
        <p style="position: absolute; left: 120px; top: 140px; width: 360px; height: 32px; font-size: 16px; text-align: right;">右对齐文本</p>
        <span class="rounded-full px-3 py-1" style="position: absolute; left: 120px; top: 190px; display: inline-block; width: 96px; height: 24px; background: #bfdbfe; border-radius: 9999px; font-size: 12px;">徽标</span>
      </div>
    `

    await convert(slide)
    const inchPerPx = 13.333 / 1920
    const originalX = 120 * inchPerPx
    const originalWidth = 360 * inchPerPx
    const originalBadgeWidth = 96 * inchPerPx
    const leftCall = slide.addText.mock.calls.find(([text]) => text === '左对齐文本')?.[1]
    const centerCall = slide.addText.mock.calls.find(([text]) => text === '居中文本')?.[1]
    const rightCall = slide.addText.mock.calls.find(([text]) => text === '右对齐文本')?.[1]
    const badgeCall = slide.addText.mock.calls.find(([text]) => text === '徽标')?.[1]

    expect(leftCall?.w as number).toBeGreaterThan(originalWidth)
    expect(leftCall?.x as number).toBeCloseTo(originalX, 3)
    expect(centerCall?.w as number).toBeGreaterThan(originalWidth)
    expect((centerCall?.x as number) + (centerCall?.w as number) / 2).toBeCloseTo(originalX + originalWidth / 2, 3)
    expect(rightCall?.w as number).toBeGreaterThan(originalWidth)
    expect((rightCall?.x as number) + (rightCall?.w as number)).toBeCloseTo(originalX + originalWidth, 3)
    expect(badgeCall).toEqual(expect.objectContaining({
      shape: 'roundRect',
      align: 'center',
    }))
    expect(badgeCall?.w as number).toBeGreaterThan(originalBadgeWidth)
    expect((badgeCall?.x as number) + (badgeCall?.w as number) / 2).toBeCloseTo(originalX + originalBadgeWidth / 2, 3)
  })

  it('应按实际圆角半径导出 roundRect，避免普通圆角全部变成 full', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <section style="width: 800px; height: 320px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px;"></section>
        <span style="display: inline-block; width: 96px; height: 24px; padding: 4px 12px; background: #bfdbfe; border-radius: 9999px; font-size: 12px;">徽标</span>
      </div>
    `

    await convert(slide)

    const cardShapeOptions = slide.addShape.mock.calls.find(([shapeName]) => shapeName === 'roundRect')?.[1] as Record<string, unknown>
    const badgeTextOptions = slide.addText.mock.calls.find(([text]) => text === '徽标')?.[1] as Record<string, unknown>
    const expectedRadiusIn = 12 * (13.333 / 1920)

    expect(Number(cardShapeOptions.rectRadius)).toBeCloseTo(expectedRadiusIn, 4)
    expect(Number(badgeTextOptions.rectRadius)).toBeCloseTo(expectedRadiusIn, 4)
  })

  it('应对内容宽度驱动的反色 inline 文本追加更积极的宽度保护', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div id="card" class="bg-background-invert-100 border border-border p-4 rounded" style="width: 420px; height: 56px; padding: 16px; background: #1e293b; border: 1px solid #334155; border-radius: 4px;">
          <span id="label" class="text-invert-100" style="color: #f8fafc;">反色背景 100 (bg-background-invert-100)</span>
        </div>
      </div>
    `

    const pageElement = document.getElementById('page') as HTMLElement
    const cardElement = document.getElementById('card') as HTMLElement
    const labelElement = document.getElementById('label') as HTMLElement
    vi.spyOn(pageElement, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1920,
      bottom: 1080,
      width: 1920,
      height: 1080,
      toJSON: () => ({}),
    })
    vi.spyOn(cardElement, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 80,
      top: 80,
      left: 100,
      right: 520,
      bottom: 136,
      width: 420,
      height: 56,
      toJSON: () => ({}),
    })
    vi.spyOn(labelElement, 'getBoundingClientRect').mockReturnValue({
      x: 116,
      y: 96,
      top: 96,
      left: 116,
      right: 356,
      bottom: 120,
      width: 240,
      height: 24,
      toJSON: () => ({}),
    })

    await convert(slide)

    const labelOptions = slide.addText.mock.calls.find(([text]) => text === '反色背景 100 (bg-background-invert-100)')?.[1] as Record<string, unknown>
    const inchPerPx = 13.333 / 1920
    const originalX = 116 * inchPerPx
    const originalWidth = 240 * inchPerPx

    expect(labelOptions?.w as number).toBeGreaterThan(originalWidth + 0.17)
    expect(labelOptions?.x as number).toBeCloseTo(originalX, 3)
  })

  it('应将 CSS 系统字体别名映射为 PPT 可识别字体', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <p style="width: 360px; height: 32px; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">主题能力</p>
        <p style="width: 360px; height: 32px; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">Runtime badge</p>
        <p style="width: 360px; height: 32px; font-size: 16px; font-family: '思源黑体', -apple-system, sans-serif;">主题字体</p>
      </div>
    `

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('主题能力', expect.objectContaining({
      fontFace: 'Microsoft YaHei',
    }))
    expect(slide.addText).toHaveBeenCalledWith('Runtime badge', expect.objectContaining({
      fontFace: 'Segoe UI',
    }))
    expect(slide.addText).toHaveBeenCalledWith('主题字体', expect.objectContaining({
      fontFace: '思源黑体',
    }))
  })

  it('应还原 flex 布局中的左右居中和上下居中', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div style="display: flex; justify-content: center; align-items: center; width: 480px; height: 160px; font-size: 32px;">居中文本</div>
      </div>
    `

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('居中文本', expect.objectContaining({
      align: 'center',
      valign: 'middle',
    }))
  })

  it('应识别 Tailwind text-center 类名并让子文本继承居中', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div class="text-center" style="width: 560px; height: 180px;">
          <strong style="display: block; width: 320px; height: 72px; color: #2563eb; font-size: 36px;">类名居中</strong>
        </div>
      </div>
    `

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('类名居中', expect.objectContaining({
      align: 'center',
    }))
  })

  it('应识别 Tailwind items-center 和 justify-between 类名', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div class="flex items-center justify-between" style="width: 560px; height: 180px;">
          <span style="display: block; width: 160px; height: 48px; color: #0f172a; font-size: 24px;">左侧</span>
          <strong style="display: block; width: 160px; height: 48px; color: #2563eb; font-size: 24px;">右侧</strong>
        </div>
      </div>
    `

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('左侧', expect.objectContaining({
      align: 'left',
      valign: 'middle',
    }))
    expect(slide.addText).toHaveBeenCalledWith('右侧', expect.objectContaining({
      align: 'left',
      valign: 'middle',
    }))
  })

  it('应在 flex justify-between 测量缺失时按右侧位置导出代码标签', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div class="flex items-center justify-between bg-background-invert p-3 rounded border" style="width: 500px; height: 60px; background: #0f172a; border: 1px solid #334155; border-radius: 4px;">
          <span class="text-invert" style="display: block; width: 120px; height: 24px;">Invert 默认</span>
          <code class="text-invert text-xs px-2 py-1 rounded" style="display: block; width: 80px; height: 20px;">text-invert</code>
        </div>
      </div>
    `

    await convert(slide)
    const spanOptions = slide.addText.mock.calls.find(([text]) => text === 'Invert 默认')?.[1] as Record<string, unknown>
    const codeOptions = slide.addText.mock.calls.find(([text]) => text === 'text-invert')?.[1] as Record<string, unknown>
    const expectedCodeX = (408 / 1920) * 13.333
    const expectedCodeW = (80 / 1920) * 13.333

    expect(codeOptions).toEqual(expect.objectContaining({
      shape: 'rect',
      align: 'center',
      valign: 'middle',
      margin: [3, 3, 1.5, 1.5],
    }))
    expect(codeOptions.isTextBox).toBeUndefined()
    expect(slide.addText).not.toHaveBeenCalledWith('Invert 默认 text-invert', expect.any(Object))
    expect(Number(codeOptions.x)).toBeCloseTo(expectedCodeX, 4)
    expect(Number(codeOptions.w)).toBeCloseTo(expectedCodeW, 4)
    expect(Number(codeOptions.x)).toBeGreaterThan(Number(spanOptions.x))
  })

  it('应将圆角徽标导出为带文本和内边距的 PPT 形状', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div class="flex items-center justify-between" style="width: 560px; height: 180px;">
          <span class="rounded-full px-3 py-1" style="display: inline-block; width: 96px; height: 24px; background: #bfdbfe; border-radius: 9999px; color: #1e40af; font-size: 12px;">主题能力</span>
          <a style="display: inline-block; width: 96px; height: 24px; color: #2563eb; font-size: 14px;">查看展示</a>
        </div>
      </div>
    `

    const report = await convert(slide)
    const badgeCall = slide.addText.mock.calls.find(([text]) => text === '主题能力')?.[1]

    expect(badgeCall).toEqual(expect.objectContaining({
      shape: 'roundRect',
      fill: expect.objectContaining({ color: 'BFDBFE' }),
      margin: [4.5, 4.5, 1.5, 1.5],
      align: 'center',
      valign: 'middle',
    }))
    expect(slide.addShape).not.toHaveBeenCalledWith('roundRect', expect.objectContaining({
      fill: expect.objectContaining({ color: 'BFDBFE' }),
    }))
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: '主题能力',
        result: 'editable-text',
        reason: '带背景文本转为 PPT text shape',
      }),
      expect.objectContaining({
        label: expect.stringContaining('span.rounded-full.px-3.py-1'),
        result: 'editable-shape',
        reason: '背景、边框和圆角由 PPT 文本形状绘制',
      }),
    ]))
  })

  it('应保持卡片描述段落居左且不受资源徽标居中影响', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <article class="overflow-hidden rounded-lg border border-border bg-background-subtle" style="width: 720px; height: 260px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div class="p-5 bg-accent5-100" style="width: 720px; height: 160px; padding: 20px; background: #fef3c7;">
            <div class="mb-3 flex items-center" style="display: flex; align-items: center; width: 680px; height: 32px;">
              <span class="app-icon inline-flex items-center justify-center mr-2 size-5" style="display: inline-flex; width: 20px; height: 20px;"></span>
              <h3 class="font-heading text-lg font-semibold text-accent5-800" style="width: 240px; height: 28px; font-size: 18px; font-weight: 600;">LaTeX 公式</h3>
            </div>
            <p class="font-body text-sm leading-relaxed text-accent5-700" style="width: 680px; height: 40px; font-size: 14px; color: #854d0e;">展示公式文本资源的块级和行内排版能力。</p>
          </div>
          <div class="p-4" style="width: 720px; height: 80px; padding: 16px;">
            <div class="flex items-center justify-between gap-3" style="display: flex; align-items: center; justify-content: space-between; width: 688px; height: 28px;">
              <span class="rounded-full px-3 py-1 text-xs font-medium bg-accent5-200 text-accent5-800" style="display: inline-block; width: 96px; height: 24px; padding: 4px 12px; background: #fde68a; border-radius: 9999px; font-size: 12px;">资源渲染</span>
              <a class="whitespace-nowrap text-sm font-medium text-link" style="display: inline-block; width: 96px; height: 24px; font-size: 14px;">查看展示</a>
            </div>
          </div>
        </article>
      </div>
    `

    await convert(slide)
    const descriptionCall = slide.addText.mock.calls.find(([text]) => text === '展示公式文本资源的块级和行内排版能力。')?.[1]
    const badgeCall = slide.addText.mock.calls.find(([text]) => text === '资源渲染')?.[1]
    const originalBadgeWidth = (96 / 1920) * 13.333

    expect(descriptionCall).toEqual(expect.objectContaining({
      align: 'left',
    }))
    expect(badgeCall).toEqual(expect.objectContaining({
      shape: 'roundRect',
      align: 'center',
      valign: 'middle',
    }))
    expect(badgeCall?.w as number).toBeGreaterThan(originalBadgeWidth)
  })

  it('应将 line-height 等于高度的单行文本识别为上下居中', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <p style="width: 360px; height: 64px; line-height: 64px; text-align: center; font-size: 24px;">单行居中</p>
      </div>
    `

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('单行居中', expect.objectContaining({
      align: 'center',
      valign: 'middle',
    }))
  })

  it('应还原 table-cell 的居左居下和垂直居中', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div style="display: table-cell; width: 420px; height: 180px; vertical-align: bottom; text-align: left; font-size: 24px;">左下文本</div>
        <div style="display: table-cell; width: 420px; height: 180px; vertical-align: middle; text-align: right; font-size: 24px;">右中文本</div>
      </div>
    `

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('左下文本', expect.objectContaining({
      align: 'left',
      valign: 'bottom',
    }))
    expect(slide.addText).toHaveBeenCalledWith('右中文本', expect.objectContaining({
      align: 'right',
      valign: 'middle',
    }))
  })

  it('应还原 column flex 的右下对齐', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-end; width: 480px; height: 160px; font-size: 28px;">右下文本</div>
      </div>
    `

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('右下文本', expect.objectContaining({
      align: 'right',
      valign: 'bottom',
    }))
  })

  it('应让拆分出的子文本继承父级垂直布局对齐，水平仍按文本自身对齐', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div style="display: flex; justify-content: center; align-items: flex-end; width: 560px; height: 180px;">
          <strong style="display: block; width: 320px; height: 72px; color: #2563eb; font-size: 36px;">继承居中</strong>
        </div>
      </div>
    `

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('继承居中', expect.objectContaining({
      align: 'left',
      valign: 'bottom',
    }))
  })

  it('应让子文本显式对齐覆盖父级继承对齐', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div style="display: flex; justify-content: center; align-items: center; width: 560px; height: 180px;">
          <span style="display: block; width: 320px; height: 72px; text-align: right; vertical-align: bottom; font-size: 28px;">覆盖对齐</span>
        </div>
      </div>
    `

    await convert(slide)

    expect(slide.addText).toHaveBeenCalledWith('覆盖对齐', expect.objectContaining({
      align: 'right',
      valign: 'bottom',
    }))
  })

  it('应将 Mermaid SVG 转为 SVG 图片块', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div class="mermaid-viewer" style="width: 640px; height: 360px;">
          <svg viewBox="0 0 100 50"><rect width="100" height="50" fill="#fff" /></svg>
        </div>
      </div>
    `

    const report = await convert(slide)

    expect(slide.addImage).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    }))
    expect(report.items[0]).toEqual(expect.objectContaining({
      sourceType: 'mermaid',
      result: 'svg',
      editable: false,
    }))
  })

  it('应读取外部 SVG 源文件并作为 SVG 源嵌入', async () => {
    const slide = createSlideMock()
    const svgSource = '<svg viewBox="0 0 120 60"><rect width="120" height="60" fill="#2563eb"/></svg>'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? 'image/svg+xml' : '',
      },
      text: async () => svgSource,
    })))
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <img class="theme-logo" src="/assets/chart.svg" style="width: 320px; height: 160px;" />
      </div>
    `

    const report = await convert(slide)
    const addImageCall = slide.addImage.mock.calls[0]?.[0] as Record<string, string>

    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/chart\.svg$/))
    expect(addImageCall.data).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(decodeSvgDataUrl(addImageCall.data)).toBe(svgSource)
    expect(report.items[0]).toEqual(expect.objectContaining({
      sourceType: 'svg',
      result: 'svg',
      reason: 'SVG 源文件原样嵌入为可移动缩放图片块',
    }))
  })

  it('应将内联 SVG 的 currentColor、描边和文字样式内联到源文件', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <style>
        #page .accent-path {
          stroke: rgb(15, 23, 42);
          stroke-width: 3px;
          stroke-linecap: round;
        }
      </style>
      <div id="page" style="width: 1920px; height: 1080px; color: rgb(37, 99, 235);">
        <svg viewBox="0 0 100 50" style="width: 300px; height: 150px; color: rgb(37, 99, 235);">
          <path class="accent-path" d="M 4 44 L 50 6 L 96 44" fill="currentColor" />
        </svg>
      </div>
    `

    await convert(slide)
    const addImageCall = slide.addImage.mock.calls[0]?.[0] as Record<string, string>
    const serializedSvg = decodeSvgDataUrl(addImageCall.data)

    expect(serializedSvg).toContain('fill="#2563EB"')
    expect(serializedSvg).toContain('stroke="#0F172A"')
    expect(serializedSvg).toContain('stroke-width="3px"')
  })

  it('应还原 CSS 变量、HSL 背景和 dashed 边框', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <section style="--card-bg: hsl(210 40% 96%); width: 420px; height: 220px; background-color: var(--card-bg); border-top: 4px dashed rgba(15, 23, 42, 0.4);"></section>
      </div>
    `

    await convert(slide)

    expect(slide.addShape).toHaveBeenCalledWith('rect', expect.objectContaining({
      fill: expect.objectContaining({ color: 'F1F5F9' }),
    }))
    expect(slide.addShape).toHaveBeenCalledWith('line', expect.objectContaining({
      line: expect.objectContaining({
        color: '0F172A',
        dashType: 'dash',
        transparency: 60,
      }),
    }))
  })

  it('应还原 CSS Color 4 颜色函数和主题相对颜色', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px; --accent: #60a5fa;">
        <section style="
          width: 420px;
          height: 220px;
          background-color: rgb(from var(--accent) calc(r + (255 - r) * .3) calc(g + (255 - g) * .3) calc(b + (255 - b) * .3) / .5);
          border: 2px solid color-mix(in srgb, var(--accent) 70%, black);
          color: oklch(62.3% 0.214 259.815);
        ">
          <span style="display: block; width: 220px; height: 48px; color: color(srgb 0.1 0.2 0.3 / 0.8); font-size: 24px;">主题色</span>
        </section>
      </div>
    `

    await convert(slide)

    expect(slide.addShape).toHaveBeenCalledWith('rect', expect.objectContaining({
      fill: expect.objectContaining({
        color: '90C0FC',
        transparency: 50,
      }),
      line: expect.objectContaining({ color: '4373AF' }),
    }))
    expect(slide.addText).toHaveBeenCalledWith('主题色', expect.objectContaining({
      color: '1A334D',
      transparency: 20,
    }))
  })

  it('应优先使用视频封面作为图片块', async () => {
    const slide = createSlideMock()
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <section class="video-viewer" style="width: 640px; height: 360px;">
          <video poster="/assets/video-cover.png"></video>
        </section>
      </div>
    `

    const report = await convert(slide)

    expect(slide.addImage).toHaveBeenCalledWith(expect.objectContaining({
      path: '/assets/video-cover.png',
    }))
    expect(report.items[0]).toEqual(expect.objectContaining({
      sourceType: 'video',
      result: 'image',
    }))
  })

  it('应将全屏 CSS 背景图导出为图片块', async () => {
    const slide = createSlideMock()
    const captureElementAsPng = vi.fn(async () => 'data:image/png;base64,capture')
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <div class="background-image" style="width: 1920px; height: 1080px; background-image: url('/src/assets/runtime-shell/background.png'); background-size: cover; background-position: center; background-repeat: no-repeat;"></div>
        <div class="gradient-overlay" style="width: 1920px; height: 1080px; background-image: linear-gradient(90deg, rgba(0,0,0,.9), rgba(0,0,0,.5));"></div>
      </div>
    `

    const report = await convert(slide, captureElementAsPng)

    expect(captureElementAsPng).not.toHaveBeenCalled()
    expect(slide.addImage).toHaveBeenCalledWith(expect.objectContaining({
      path: '/src/assets/runtime-shell/background.png',
      sizing: expect.objectContaining({
        type: 'cover',
      }),
    }))
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'image',
        result: 'image',
        reason: 'CSS 背景图导出为图片块',
      }),
    ]))
  })

  it('应将线性渐变蒙版导出为单个 PPT 原生渐变形状', async () => {
    const slide = createSlideMock()
    const captureElementAsPng = vi.fn(async () => 'data:image/png;base64,capture')
    const gradientFills: PptxGradientFillInstruction[] = []
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px; --tw-color-bg-invert: #000000;">
        <div class="gradient-overlay" style="width: 1920px; height: 1080px; background-image: linear-gradient(to right, rgb(from var(--tw-color-bg-invert) r g b / 1) 0%, rgb(from var(--tw-color-bg-invert) r g b / 0.5) 100%);"></div>
      </div>
    `

    const report = await convert(slide, captureElementAsPng, instruction => gradientFills.push(instruction))
    const shapeCalls = slide.addShape.mock.calls
    const gradientShape = shapeCalls[0]?.[1] as Record<string, unknown>

    expect(captureElementAsPng).not.toHaveBeenCalled()
    expect(shapeCalls).toHaveLength(1)
    expect(gradientShape.objectName).toMatch(/^pptx-gradient-p1-1-/)
    expect(gradientShape.fill).toEqual(expect.objectContaining({
      color: '000000',
      transparency: 25,
    }))
    expect(gradientFills).toHaveLength(1)
    expect(gradientFills[0]).toEqual(expect.objectContaining({
      pageIndex: 1,
      objectName: gradientShape.objectName,
      direction: 'right',
    }))
    expect(gradientFills[0].stops[0].color).toEqual(expect.objectContaining({
      hex: '000000',
      alpha: 1,
    }))
    expect(gradientFills[0].stops[1].color).toEqual(expect.objectContaining({
      hex: '000000',
      alpha: 0.5,
    }))
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'shape',
        result: 'editable-shape',
        reason: 'linear-gradient 导出为 PPT 原生渐变形状',
      }),
    ]))
  })

  it('应将复杂 CSS 容器降级为局部截图并写入报告', async () => {
    const slide = createSlideMock()
    const captureElementAsPng = vi.fn(async () => 'data:image/png;base64,capture')
    document.body.innerHTML = `
      <div id="page" style="width: 1920px; height: 1080px;">
        <section style="width: 420px; height: 220px; background-image: radial-gradient(circle, #111827, #2563eb);">
          <span style="display: block; width: 200px; height: 32px;">复杂背景</span>
        </section>
      </div>
    `

    const report = await convert(slide, captureElementAsPng)

    expect(captureElementAsPng).toHaveBeenCalledTimes(1)
    expect(slide.addImage).toHaveBeenCalledWith(expect.objectContaining({
      data: 'data:image/png;base64,capture',
    }))
    expect(report.items[0]).toEqual(expect.objectContaining({
      sourceType: 'complex-css',
      result: 'screenshot',
      reason: '复杂 CSS 容器降级为局部截图',
    }))
  })
})

/**
 * 执行转换。
 * @param slide slide mock
 * @param captureElementAsPng 截图函数
 */
async function convert(
  slide = createSlideMock(),
  captureElementAsPng = vi.fn(async () => 'data:image/png;base64,test'),
  gradientFillCollector?: (instruction: PptxGradientFillInstruction) => void,
) {
  const pageElement = document.getElementById('page') as HTMLElement
  const converter = new PPTXDomConverter()

  return converter.convertPage({
    slide,
    pageElement,
    pageIndex: 1,
    pageTitle: '测试页',
    pageRoute: '/test',
    pageWidthPx: 1920,
    pageHeightPx: 1080,
    slideWidthIn: 13.333,
    slideHeightIn: 7.5,
    shapeTypes,
    captureElementAsPng,
    gradientFillCollector,
  })
}

/**
 * 创建 slide API mock。
 */
function createSlideMock() {
  const events: Array<Record<string, unknown>> = []
  return {
    __events: events,
    addText: vi.fn((text: string, options?: Record<string, unknown>) => {
      events.push({ kind: 'text', text, options })
    }),
    addShape: vi.fn((shapeName: string, options?: Record<string, unknown>) => {
      events.push({ kind: 'shape', shapeName, options })
    }),
    addImage: vi.fn((options?: Record<string, unknown>) => {
      events.push({ kind: 'image', options })
    }),
    background: undefined as Record<string, unknown> | undefined,
  }
}

/**
 * 解码 SVG data URL，便于断言源 XML。
 * @param data data URL
 */
function decodeSvgDataUrl(data: string): string {
  const base64 = data.replace(/^data:image\/svg\+xml;base64,/, '')
  const binary = window.atob(base64)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
