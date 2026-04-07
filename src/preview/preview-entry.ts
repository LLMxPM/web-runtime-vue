/**
 * 文件功能：Editor 专用 Runtime 预览入口，初始化配置、图标与独立预览应用。
 */

import { createApp } from 'vue'

import EditorRuntimePreviewApp from './EditorRuntimePreviewApp.vue'
import { initializeConfig } from '@/core/utils/config'
import { initializeStaticIcons } from '@/core/utils/static-icons'

import '@/styles/global.css'
import '@/styles/fonts.css'

declare global {
  interface Window {
    __RUNTIME_PREVIEW__?: {
      filePath: string
      currentDateSegment: string
    }
    __EDITOR_RUNTIME_PREVIEW_READY__?: boolean
  }
}

/**
 * 启动独立预览应用。
 */
async function bootstrapPreviewApp(): Promise<void> {
  const payload = window.__RUNTIME_PREVIEW__
  window.__EDITOR_RUNTIME_PREVIEW_READY__ = false
  if (!payload?.filePath || !payload.currentDateSegment) {
    throw new Error('预览上下文缺失，无法启动页面预览。')
  }

  await initializeConfig()
  initializeStaticIcons()

  createApp(EditorRuntimePreviewApp, {
    filePath: payload.filePath,
    currentDateSegment: payload.currentDateSegment,
  }).mount('#app')
}

void bootstrapPreviewApp()
