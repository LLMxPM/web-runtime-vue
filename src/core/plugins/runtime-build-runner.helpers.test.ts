/**
 * 文件用途：验证 Runtime 整项目构建 helper 的 baseUrl 规范化与静态资源路径推导逻辑。
 */

import { describe, expect, it } from 'vitest'

import {
  buildStaticAssetPath,
  hasForbiddenRootAbsoluteAssetPath,
  normalizeBuildBaseUrl,
  stripInspectableComments,
} from './runtime-build-runner.helpers'

describe('runtime build runner helpers', () => {
  it('应规范化构建 baseUrl', () => {
    expect(normalizeBuildBaseUrl(undefined)).toBe('./')
    expect(normalizeBuildBaseUrl('./')).toBe('./')
    expect(normalizeBuildBaseUrl('/demo')).toBe('/demo/')
    expect(normalizeBuildBaseUrl('/nested/path/')).toBe('/nested/path/')
  })

  it('应拒绝非法的构建 baseUrl', () => {
    expect(() => normalizeBuildBaseUrl('https://example.com/demo')).toThrow('base_url')
    expect(() => normalizeBuildBaseUrl('//cdn.example.com/demo')).toThrow('base_url')
    expect(() => normalizeBuildBaseUrl('demo')).toThrow('base_url')
  })

  it('应优先使用原始文件名或逻辑名推导静态资源扩展名', () => {
    expect(buildStaticAssetPath('hash-logo', 'logo.svg')).toBe('__build_assets/hash-logo.svg')
    expect(buildStaticAssetPath('hash-photo', undefined, 'img/photo/banner.webp')).toBe(
      '__build_assets/hash-photo.webp',
    )
    expect(buildStaticAssetPath('hash-font')).toBe('__build_assets/hash-font')
  })

  it('缺少资源 hash 时应抛错', () => {
    expect(() => buildStaticAssetPath('')).toThrow('资源 hash')
  })

  it('应识别真实源码中的根绝对静态资源引用', () => {
    expect(hasForbiddenRootAbsoluteAssetPath("const icon = { src: '/img/logo/custom-logo.svg' }")).toBe(true)
    expect(hasForbiddenRootAbsoluteAssetPath(".hero { background-image: url('/img/bg.png'); }")).toBe(true)
  })

  it('应忽略注释中的根绝对静态资源示例', () => {
    const sourceCode = [
      "// src: '/img/logo/custom-logo.svg'",
      "/* url('/img/background.png') */",
      "<!-- <img src=\"/img/demo.png\" /> -->",
      "const icon = { src: './img/logo.svg' }",
    ].join('\n')

    const sanitizedCode = stripInspectableComments(sourceCode)

    expect(sanitizedCode).not.toContain("'/img/")
    expect(sanitizedCode).not.toContain('"/img/')
    expect(hasForbiddenRootAbsoluteAssetPath(sourceCode)).toBe(false)
  })
})
