/**
 * 文件用途：验证 SaaS 预览入口的资源基址选择与内联 JSON 安全序列化逻辑。
 */

import { describe, expect, it } from 'vitest'

import { resolvePreviewAssetBase, serializeForInlineScript } from './runtime-saas-preview'

describe('runtime saas preview helpers', () => {
  it('应优先使用 Backend 透传的浏览器可访问 Runtime 地址', () => {
    expect(resolvePreviewAssetBase('https://runtime.example.com/', 'http://127.0.0.1:7373')).toBe(
      'https://runtime.example.com',
    )
    expect(resolvePreviewAssetBase('', 'http://127.0.0.1:7373/')).toBe('http://127.0.0.1:7373')
  })

  it('应对内联 script 中的 JSON 做安全转义', () => {
    const serialized = serializeForInlineScript({
      title: '</script><script>alert(1)</script>',
      body: 'A&B',
    })

    expect(serialized).toContain('\\u003C/script\\u003E')
    expect(serialized).toContain('\\u0026')
    expect(serialized).not.toContain('</script>')
  })
})
