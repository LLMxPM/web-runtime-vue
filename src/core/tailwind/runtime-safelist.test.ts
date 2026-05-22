/**
 * 文件用途：验证 Runtime 全局 Tailwind safelist 覆盖页面和组件常用设计系统类。
 */

import { describe, expect, it } from 'vitest'

import { runtimeTailwindSafelist } from './runtime-safelist.js'

describe('runtime tailwind safelist', () => {
  it('应覆盖主题、背景、渐变和画布布局常用类', () => {
    expect(runtimeTailwindSafelist).toEqual(
      expect.arrayContaining([
        'relative',
        'size-4',
        'h-full',
        'w-full',
        'overflow-hidden',
        'pt-16',
        'bg-cover',
        'bg-center',
        'bg-no-repeat',
        'text-primary',
        'text-secondary',
        'text-invert',
        'bg-background',
        'bg-background-subtle',
        'bg-background-invert',
        'border-border',
        'from-background-invert/80',
        'bg-accent1-100',
      ]),
    )
  })
})
