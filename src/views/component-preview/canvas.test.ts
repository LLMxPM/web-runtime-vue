/**
 * 文件用途：验证组件预览画布配置的归一化与缩放计算逻辑。
 */

import { describe, expect, it } from 'vitest'

import {
  computeComponentPreviewScale,
  normalizeComponentPreviewCanvasConfig,
  resolveComponentPreviewCanvasOverrides,
} from './canvas'

describe('component preview canvas helpers', () => {
  it('should merge query overrides with runtime canvas config', () => {
    expect(normalizeComponentPreviewCanvasConfig(
      {
        width: 1280,
        height: 720,
        padding: 24,
        background: '#ffffff',
      },
      {
        width: 1440,
        height: null,
        padding: 12,
        background: '#f0f0f0',
      },
    )).toEqual({
      width: 1440,
      height: 720,
      padding: 12,
      background: '#f0f0f0',
    })
  })

  it('should parse legacy canvas query overrides from search string', () => {
    expect(resolveComponentPreviewCanvasOverrides(
      '?component_preview_width=1600&component_preview_height=900&component_preview_padding=8&component_preview_background=%23ffffff',
    )).toEqual({
      width: 1600,
      height: 900,
      padding: 8,
      background: '#ffffff',
    })
  })

  it('should compute component preview scale from viewport and canvas size', () => {
    expect(computeComponentPreviewScale(720, 540, 1440, 900)).toBeCloseTo(0.5)
    expect(computeComponentPreviewScale(2400, 1800, 1440, 900)).toBe(1)
  })
})
