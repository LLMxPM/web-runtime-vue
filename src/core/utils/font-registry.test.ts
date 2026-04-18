// @vitest-environment jsdom

/**
 * 文件用途：验证运行时动态字体注册与主题字体引用解析逻辑。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reloadThemeConfigs, useTheme } from '@/core/composables/useTheme'

import { initializeRuntimeFontRegistry, resolveThemeFontFamily } from './font-registry'
import { setRuntimePreloadedConfig, setRuntimePreviewContext } from './path'

beforeEach(() => {
  vi.stubGlobal('window', window)
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

afterEach(async () => {
  setRuntimePreviewContext(undefined)
  setRuntimePreloadedConfig({
    themes: {
      themes: {
        white: {
          name: '白色经典',
          description: '测试重置主题',
          palette: {
            text: { primary: '#111111', secondary: '#222222', invert: '#ffffff' },
            background: { default: '#ffffff', invert: '#111111' },
            border: { default: '#dddddd', subtle: '#cccccc' },
            link: { default: '#3b82f6', hover: '#2563eb', visited: '#7c3aed' },
            accent: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'],
          },
          typography: {
            headingfont: 'system-ui',
            bodyfont: 'system-ui',
            codefont: 'monospace',
            baseFontSize: '16px',
          },
        },
      },
      default: {
        theme: 'white',
      },
    },
  })
  await reloadThemeConfigs()
  setRuntimePreloadedConfig(undefined)
  vi.unstubAllGlobals()
})

describe('runtime font registry', () => {
  it('应根据预加载字体配置注入动态 @font-face', () => {
    setRuntimePreviewContext({
      artifactId: 'artifact_font',
      tenantId: 'tenant_font',
      previewKind: 'project',
      scopeType: 'project',
      workspaceId: 'workspace_font',
      projectId: 'project_font',
      entryDescriptor: { entry_type: 'route', route: '/home' },
      assetBaseUrl: 'https://assets.example/runtime-font',
      traceId: 'trace_font',
    })
    setRuntimePreloadedConfig({
      manifest: {
        artifact_id: 'artifact_font',
        tenant_id: 'tenant_font',
        preview_kind: 'project',
        owner_scope: {
          scope_type: 'project',
          project_id: 'project_font',
          workspace_id: 'workspace_font',
        },
        entry_descriptor: { entry_type: 'route', route: '/home' },
        project_id: 'project_font',
        modules: {},
        assets: {
          'SourceHanSansSC-VF': 'fonts/source-han-sans.woff2',
        },
      },
      fonts: {
        items: {
          'SourceHanSansSC-VF': {
            asset_name: 'SourceHanSansSC-VF',
            font_family: '思源黑体',
            font_format: 'woff2',
            font_weight: '100 900',
            font_style: 'normal',
            font_display: 'swap',
          },
        },
      },
    })

    const cssText = initializeRuntimeFontRegistry()
    const styleElement = document.getElementById('runtime-dynamic-fonts')

    expect(styleElement).not.toBeNull()
    expect(cssText).toContain("font-family: '思源黑体'")
    expect(cssText).toContain("url('https://assets.example/runtime-font/fonts/source-han-sans.woff2')")
    expect(cssText).toContain("font-weight: 100 900;")
  })

  it('应先按 asset_name 再按历史 font_family 解析主题字体引用', () => {
    setRuntimePreloadedConfig({
      fonts: {
        items: {
          'SourceHanSansSC-VF': {
            asset_name: 'SourceHanSansSC-VF',
            font_family: '思源黑体',
            font_format: 'woff2',
            font_weight: '400',
            font_style: 'normal',
            font_display: 'swap',
          },
        },
      },
    })

    expect(resolveThemeFontFamily('SourceHanSansSC-VF')).toBe('思源黑体')
    expect(resolveThemeFontFamily('思源黑体')).toBe('思源黑体')
    expect(resolveThemeFontFamily('system-ui')).toBe('system-ui')
  })

  it('useTheme 应把主题中的字体资源名解析为实际 font-family', async () => {
    setRuntimePreloadedConfig({
      themes: {
        themes: {
          lightblue: {
            name: '白底蓝色',
            description: '测试主题',
            palette: {
              text: { primary: '#111111', secondary: '#222222', invert: '#ffffff' },
              background: { default: '#ffffff', invert: '#111111' },
              border: { default: '#dddddd', subtle: '#cccccc' },
              link: { default: '#3b82f6', hover: '#2563eb', visited: '#7c3aed' },
              accent: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'],
            },
            typography: {
              headingfont: 'SourceHanSansSC-VF',
              bodyfont: '思源黑体',
              codefont: 'SourceCodePro-Regular',
              baseFontSize: '16px',
            },
          },
        },
        default: {
          theme: 'lightblue',
        },
      },
      fonts: {
        items: {
          'SourceHanSansSC-VF': {
            asset_name: 'SourceHanSansSC-VF',
            font_family: '思源黑体',
            font_format: 'woff2',
            font_weight: '100 900',
            font_style: 'normal',
            font_display: 'swap',
          },
          'SourceCodePro-Regular': {
            asset_name: 'SourceCodePro-Regular',
            font_family: 'SourceCodePro',
            font_format: 'woff2',
            font_weight: '400',
            font_style: 'normal',
            font_display: 'swap',
          },
        },
      },
    })

    await reloadThemeConfigs()
    const { themeStyles } = useTheme('lightblue')

    expect(themeStyles.value['--theme-font-heading']).toBe('思源黑体')
    expect(themeStyles.value['--theme-font-body']).toBe('思源黑体')
    expect(themeStyles.value['--theme-font-code']).toBe('SourceCodePro')
  })
})
