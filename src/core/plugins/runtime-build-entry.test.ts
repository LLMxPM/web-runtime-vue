/**
 * 文件用途：验证 Runtime backend build 入口脚本与 index.html 的生成逻辑。
 */

import { describe, expect, it } from 'vitest'

import { createBuildEntrySource, createBuildIndexHtmlSource } from './runtime-build-entry'

describe('runtime build entry', () => {
  it('应先注入预加载配置，再通过动态导入启动主入口', () => {
    const entrySource = createBuildEntrySource({
      app: { app: { title: '示例应用' } },
      routes: { routes: [{ route: 'cover', component: '@/views/Cover.vue' }] },
    } as any)

    expect(entrySource).toContain("window.__RUNTIME_PRELOADED_CONFIG__ = ")
    expect(entrySource).toContain("void import('./main').catch((error) => {")
    expect(entrySource.indexOf('window.__RUNTIME_PRELOADED_CONFIG__ = ')).toBeLessThan(
      entrySource.indexOf("void import('./main').catch((error) => {"),
    )
    expect(entrySource).not.toContain("import './main'")
  })

  it('应生成指向构建态入口脚本的 index.html', () => {
    const htmlSource = createBuildIndexHtmlSource()

    expect(htmlSource).toContain('<script type="module" src="/src/__build_entry__.ts"></script>')
    expect(htmlSource).toContain('<div id="app"></div>')
  })
})
