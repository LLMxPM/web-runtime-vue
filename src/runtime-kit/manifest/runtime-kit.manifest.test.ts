/**
 * 文件用途：验证 Runtime Kit 公开清单只包含 Backend/Agent 无法直接实现的运行时能力。
 */

import { describe, expect, it } from 'vitest'

import manifest from './runtime-kit.manifest.json'

const PUBLIC_CATEGORIES = ['asset', 'page', 'runtime']

interface PreviewField {
  type?: string
  default?: unknown
  options?: Array<{ value: unknown }>
}

interface PreviewSchema {
  props?: Record<string, PreviewField>
  slots?: Record<string, unknown>
  presets?: Array<{ key?: string }>
}

describe('runtime kit manifest', () => {
  it('应声明 @runtime-kit 别名与收敛后的运行时能力', () => {
    const exportPaths = manifest.exports.map((item) => item.import_path)
    const exportNames = manifest.exports.map((item) => item.name)

    expect(manifest.alias).toBe('@runtime-kit')
    expect(exportPaths).toContain(
      '@runtime-kit/public/components/assets/AssetImage.v1.vue'
    )
    expect(exportPaths).toContain(
      '@runtime-kit/public/components/page/layout/DefaultContainer.v1.vue'
    )
    expect(exportPaths).toContain(
      '@runtime-kit/public/components/primitives/Icon.v1.vue'
    )
    expect(exportPaths).toContain(
      '@runtime-kit/public/components/primitives/ThemeLogo.v1.vue'
    )
    expect(exportNames).toContain('useRouteCatalog.v1')
    expect(exportNames).toContain('Connector.v1')
    expect(exportNames).toContain('useTheme.v1')
    expect(exportNames).toContain('useAssetFontFamily.v1')
    expect(exportNames).toContain('resolveAssetFontFamily.v1')
  })

  it('公开能力应使用文件名版本化命名', () => {
    const names = new Set<string>()
    const baseVersionKeys = new Set<string>()

    manifest.exports.forEach((item) => {
      expect(item.base_name, `${item.name} 缺少 base_name`).toEqual(expect.any(String))
      expect(item.version_no, `${item.name} 缺少 version_no`).toEqual(expect.any(Number))
      expect(item.version_no, `${item.name} version_no 必须为正整数`).toBeGreaterThan(0)
      expect(item.name).toBe(`${item.base_name}.v${item.version_no}`)
      expect(item.import_path, `${item.name} import_path 必须包含 .vN`).toMatch(/\.v\d+(?:\.[A-Za-z0-9]+)?$/)

      const key = `${item.kind}:${item.base_name}:v${item.version_no}`
      expect(names.has(item.name), `${item.name} 重复`).toBe(false)
      expect(baseVersionKeys.has(key), `${key} 重复`).toBe(false)
      names.add(item.name)
      baseVersionKeys.add(key)
    })
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
    const previewableNames = previewableItems.map((item) => item.base_name)

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
        'ThemeLogo',
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

  it('可预览组件 schema 应覆盖真实可调字段和首屏示例输入', () => {
    const assetImageProps = getPreviewProps('AssetImage')
    expect(Object.keys(assetImageProps)).toEqual(expect.arrayContaining([
      'name',
      'fallback',
      'width',
      'height',
      'minHeight',
      'backgroundColor',
      'showBorder',
      'borderRadius',
      'padding',
      'fit',
      'position',
      'showFallbackPlaceholder',
    ]))
    expect(assetImageProps.fallback.default).toEqual(expect.stringMatching(/^data:image\/svg\+xml,/))
    expect(getPresetKeys('AssetImage')).toEqual(expect.arrayContaining(['contain-preview', 'cover-banner']))

    const assetVideoProps = getPreviewProps('AssetVideo')
    expect(Object.keys(assetVideoProps)).toEqual(expect.arrayContaining([
      'posterFallback',
      'playsInline',
      'width',
      'minHeight',
      'backgroundColor',
      'borderRadius',
      'fit',
      'position',
    ]))

    const assetDrawioProps = getPreviewProps('AssetDrawio')
    expect(assetDrawioProps.fallback.default).toEqual(expect.stringMatching(/^data:text\/xml,/))
    expect(Object.keys(assetDrawioProps)).toEqual(expect.arrayContaining([
      'minHeight',
      'backgroundColor',
      'borderRadius',
      'padding',
    ]))

    const assetMermaidProps = getPreviewProps('AssetMermaid')
    expect(assetMermaidProps.fallback.default).toEqual(expect.stringMatching(/^data:text\/plain,/))
    expect(Object.keys(assetMermaidProps)).toEqual(expect.arrayContaining([
      'minHeight',
      'backgroundColor',
      'borderRadius',
      'padding',
    ]))

    const assetChartProps = getPreviewProps('AssetChart')
    expect(assetChartProps.fallback.default).toEqual(expect.stringMatching(/^data:application\/json,/))
    expect(Object.keys(assetChartProps)).toEqual(expect.arrayContaining([
      'minHeight',
      'backgroundColor',
      'theme',
      'borderRadius',
      'padding',
      'notMerge',
      'lazyUpdate',
    ]))

    const assetFormulaProps = getPreviewProps('AssetFormula')
    expect(assetFormulaProps.fallback.default).toEqual(expect.stringMatching(/^data:text\/plain,/))
    expect(Object.keys(assetFormulaProps)).toEqual(expect.arrayContaining([
      'height',
      'minHeight',
      'backgroundColor',
      'borderRadius',
      'throwOnError',
      'strict',
      'trust',
    ]))

    const iconProps = getPreviewProps('Icon')
    expect(iconProps.class.default).toBe('size-16')
    expect(iconProps.strokeWidth.default).toBe(2)
    expect(iconProps.disabled.default).toBe(false)
    expect(iconProps.fallback.default).toBe('?')

    const themeLogoProps = getPreviewProps('ThemeLogo')
    expect(Object.keys(themeLogoProps)).toEqual(expect.arrayContaining([
      'variant',
      'alt',
      'size',
    ]))
    expect(themeLogoProps.variant.default).toBe('logo')
    expect(themeLogoProps.size.default).toBe(4)
    expect(themeLogoProps).not.toHaveProperty('width')
    expect(themeLogoProps).not.toHaveProperty('height')
    expect(themeLogoProps).not.toHaveProperty('fit')
    expect(themeLogoProps).not.toHaveProperty('fallbackSrc')
    expect(getPresetKeys('ThemeLogo')).toEqual(expect.arrayContaining(['theme-logo', 'theme-invert-logo']))

    expect(getPresetKeys('DefaultContainer')).toEqual(expect.arrayContaining(['center-canvas', 'section-stack']))
  })

  it('preview schema 中 select 字段的默认值应命中 options', () => {
    const previewableItems = manifest.exports.filter(
      (item) => item.capability?.previewable === true
    )

    previewableItems.forEach((item) => {
      const schema = item.capability?.preview_schema as PreviewSchema
      Object.entries(schema.props || {}).forEach(([fieldName, field]) => {
        if (field.type !== 'select') {
          return
        }
        const optionValues = (field.options || []).map((option) => option.value)
        expect(
          optionValues,
          `${item.name}.${fieldName} 的默认值必须来自 options`
        ).toContain(field.default)
      })
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

function getPreviewProps(componentName: string): Record<string, PreviewField> {
  const schema = getPreviewSchema(componentName)
  return schema.props || {}
}

function getPresetKeys(componentName: string): string[] {
  const schema = getPreviewSchema(componentName)
  return (schema.presets || []).map((preset) => String(preset.key || ''))
}

function getPreviewSchema(componentName: string): PreviewSchema {
  const item = manifest.exports.find((exportItem) => exportItem.base_name === componentName)
  expect(item, `未找到 Runtime Kit 能力 ${componentName}`).toBeTruthy()
  const schema = item?.capability?.preview_schema
  expect(schema, `${componentName} 缺少 preview_schema`).toEqual(expect.any(Object))
  return schema as PreviewSchema
}
