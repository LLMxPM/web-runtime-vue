/**
 * 文件用途：验证 Runtime Tailwind 主题中的动态字号与默认行高比例。
 */

import { describe, expect, it } from 'vitest'

import { createDynamicFontSizeScale } from './runtime-tailwind-theme.js'

describe('runtime tailwind theme font size scale', () => {
  it('应按 Tailwind 默认比例生成字号与行高配置', () => {
    const fontSize = createDynamicFontSizeScale()

    expect(fontSize.base).toEqual([
      'var(--tw-font-size-base)',
      { lineHeight: 'calc(var(--tw-font-size-base) * 1.5)' },
    ])
    expect(fontSize.xl).toEqual([
      'calc(var(--tw-font-size-base) * 1.25)',
      { lineHeight: 'calc(var(--tw-font-size-base) * 1.75)' },
    ])
    expect(fontSize['4xl']).toEqual([
      'calc(var(--tw-font-size-base) * 2.25)',
      { lineHeight: 'calc(var(--tw-font-size-base) * 2.5)' },
    ])
    expect(fontSize['5xl']).toEqual([
      'calc(var(--tw-font-size-base) * 3)',
      { lineHeight: '1' },
    ])
  })
})
