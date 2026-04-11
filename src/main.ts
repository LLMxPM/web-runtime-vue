/**
 * 文件用途：应用入口，负责初始化只读预览运行时、配置系统、主题系统、图标系统与路由。
 */

import { createApp } from 'vue'

import App from './App.vue'
import { loadThemeConfigs } from './core/composables/useTheme'
import { initializeStaticIcons } from './core/utils/static-icons'
import { initializeConfig } from './core/utils/config'
import { getPreviewEntryRoute } from './core/utils/path'

import './styles/global.css'
import './styles/fonts.css'

/**
 * 初始化并挂载应用。
 */
async function initializeApp(): Promise<void> {
  try {
    await initializeConfig()
    await loadThemeConfigs()
    initializeStaticIcons()

    const { default: routerPromise } = await import('./core/router')
    const router = await routerPromise
    const app = createApp(App)
    app.use(router)

    const previewEntryRoute = getPreviewEntryRoute()
    if (previewEntryRoute) {
      await router.replace(previewEntryRoute)
    }

    await router.isReady()
    app.mount('#app')
  } catch (error) {
    console.error('应用初始化失败', error)
    document.body.innerHTML = `
      <div style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:Segoe UI,PingFang SC,sans-serif;background:#f8fafc;">
        <div style="max-width:720px;padding:32px;text-align:center;color:#dc2626;background:#ffffff;border:1px solid #fecaca;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.08);">
          <h1 style="margin:0 0 12px;font-size:28px;">Runtime 初始化失败</h1>
          <p style="margin:0 0 16px;color:#7f1d1d;">请刷新页面重试；若问题持续，请联系平台侧排查预览上下文、发布产物或内部接口。</p>
          <details style="margin-top:20px;text-align:left;">
            <summary style="cursor:pointer;color:#991b1b;">错误详情</summary>
            <pre style="margin-top:12px;padding:12px;border-radius:12px;background:#fef2f2;overflow:auto;white-space:pre-wrap;">${String(error)}</pre>
          </details>
        </div>
      </div>
    `
  }
}

initializeApp()
