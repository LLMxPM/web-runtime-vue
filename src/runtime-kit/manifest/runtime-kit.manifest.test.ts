/**
 * 文件用途：验证 Runtime Kit 公开清单只包含 Backend/Agent 无法直接实现的运行时能力。
 */

import { describe, expect, it } from 'vitest'

import manifest from './runtime-kit.manifest.json'

const PUBLIC_CATEGORIES = ['asset', 'page', 'runtime']

describe('runtime kit manifest', () => {
  it('应声明 @runtime-kit 别名与收敛后的运行时能力', () => {
    const exportPaths = manifest.exports.map((item) => item.import_path)
    const exportNames = manifest.exports.map((item) => item.name)

    expect(manifest.alias).toBe('@runtime-kit')
    expect(exportPaths).toContain(
      '@runtime-kit/public/components/assets/AssetImage.vue'
    )
    expect(exportPaths).toContain(
      '@runtime-kit/public/components/page/layout/DefaultContainer.vue'
    )
    expect(exportPaths).toContain(
      '@runtime-kit/public/components/primitives/Icon.vue'
    )
    expect(exportNames).toContain('useRouteCatalog')
    expect(exportNames).toContain('Connector')
    expect(exportNames).toContain('useTheme')
    expect(exportNames).toContain('useAssetFontFamily')
    expect(exportNames).toContain('resolveAssetFontFamily')
  })

  it('不应公开聚合渲染器、页面模板和样式区块组件', () => {
    const exportNames = manifest.exports.map((item) => item.name)

    expect(exportNames).not.toContain('AssetRenderer')
    expect(exportNames).not.toContain('DefaultCoverPage')
    expect(exportNames).not.toContain('DefaultContentPage')
    expect(exportNames).not.toContain('HeaderSection')
    expect(exportNames).not.toContain('FooterSection')
    expect(exportNames).not.toContain('Pagination')
    expect(exportNames).not.toContain('TableOfContents')
    expect(exportNames).not.toContain('useAssetMetadata')
    expect(exportNames).not.toContain('useIcon')
  })

  it('不应把 internal、runtime-shell 和 component-preview 暴露给页面源码', () => {
    const exportPaths = manifest.exports.map((item) => item.import_path)

    expect(exportPaths.some((path) => path.includes('PDF'))).toBe(false)
    expect(exportPaths.some((path) => path.includes('runtime-shell'))).toBe(
      false
    )
    expect(
      exportPaths.some((path) => path.includes('@runtime-kit/internal/'))
    ).toBe(false)
    expect(exportPaths.some((path) => path.includes('component-preview'))).toBe(
      false
    )
  })

  it('公开能力应只属于三个一级能力分组', () => {
    manifest.exports.forEach((item) => {
      expect(
        PUBLIC_CATEGORIES,
        `${item.name} 使用了非公开能力分组 ${item.category}`
      ).toContain(item.category)
    })
  })

  it('标签不应重复分类、类型或展示状态字段', () => {
    manifest.exports.forEach((item) => {
      const tags = item.capability?.tags || []
      const redundantTags = [
        item.category,
        item.kind,
        'doc-only',
        item.capability?.recommendation_level,
      ].filter(Boolean)

      redundantTags.forEach((tag) => {
        expect(
          tags,
          `${item.name} 的 tags 不应重复已有字段 ${tag}`
        ).not.toContain(tag)
      })
    })
  })

  it('所有能力应声明推荐等级，便于 Agent 排序', () => {
    manifest.exports.forEach((item) => {
      expect(
        ['default', 'advanced', 'internal-only'],
        `${item.name} 缺少 recommendation_level`
      ).toContain(item.capability?.recommendation_level)
    })
  })

  it('组件预览只允许默认推荐组件或明确高级组件按能力声明进入', () => {
    const previewableItems = manifest.exports.filter(
      (item) => item.capability?.previewable === true
    )
    const previewableNames = previewableItems.map((item) => item.name)

    expect(previewableNames).toEqual(
      expect.arrayContaining([
        'AssetImage',
        'AssetVideo',
        'AssetDrawio',
        'AssetMermaid',
        'AssetChart',
        'AssetFormula',
        'DefaultContainer',
        'Icon',
      ])
    )
    expect(previewableNames).not.toContain('Connector')
    previewableItems.forEach((item) => {
      expect(item.kind).toBe('component')
      expect(
        item.capability?.preview_schema,
        `${item.name} 缺少 preview_schema`
      ).toEqual(expect.any(Object))
      expect(
        Object.keys(item.capability?.preview_schema || {}),
        `${item.name} 的 preview_schema 不应为空`
      ).not.toHaveLength(0)
      expect(
        item.capability?.preview_options,
        `${item.name} 缺少 preview_options`
      ).toEqual(expect.any(Object))
    })
  })

  it('doc-only 能力应包含 usage、returns、return_example 和 constraints', () => {
    const docOnlyItems = manifest.exports.filter(
      (item) => item.capability?.previewable === false
    )

    expect(docOnlyItems.length).toBeGreaterThan(0)
    docOnlyItems.forEach((item) => {
      expect(item.capability?.usage, `${item.name} 缺少 usage`).toEqual(
        expect.arrayContaining([expect.any(String)])
      )
      expect(item.capability?.returns, `${item.name} 缺少 returns`).toEqual(
        expect.any(String)
      )
      expect(
        item.capability?.return_example,
        `${item.name} 缺少 return_example`
      ).toEqual(expect.arrayContaining([expect.any(String)]))
      expect(
        item.capability?.constraints,
        `${item.name} 缺少 constraints`
      ).toEqual(expect.arrayContaining([expect.any(String)]))
    })
  })

  it('所有公开能力都应包含面向 Backend/Agent 的说明字段', () => {
    manifest.exports.forEach((item) => {
      expect(
        item.capability?.display_name,
        `${item.name} 缺少 display_name`
      ).toEqual(expect.any(String))
      expect(item.capability?.summary, `${item.name} 缺少 summary`).toEqual(
        expect.any(String)
      )
      expect(item.capability?.audiences, `${item.name} 缺少 audiences`).toEqual(
        expect.arrayContaining(['backend', 'agent'])
      )
      expect(
        item.capability?.constraints,
        `${item.name} 缺少 constraints`
      ).toEqual(expect.arrayContaining([expect.any(String)]))
    })
  })
})
