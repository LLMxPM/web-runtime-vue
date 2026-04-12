/**
 * 文件用途：补充运行时全局类型定义，尤其是预览上下文与部署环境变量约束。
 */

import type {
  RuntimePreloadedConfigBundle,
  RuntimePreviewContext,
} from '@/core/shared/runtime-preview'
import type { RuntimeConfigContext } from '@/core/utils/path'

export interface AppConfig {
  title: string
  version: string
  description?: string
  logo?: string
}

export interface SidebarConfig {
  width: number
  collapsible: boolean
  defaultCollapsed: boolean
}

export interface BaseResponse<T = unknown> {
  success: boolean
  data: T
  message?: string
  code?: number | string
}

export interface ImportMetaEnv {
  readonly VITE_APP_TITLE?: string
  readonly VITE_APP_VERSION?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_BUILD_TIME?: string
  readonly RUNTIME_PREVIEW_JWKS_URL?: string
  readonly RUNTIME_PREVIEW_TOKEN_AUDIENCE?: string
  readonly RUNTIME_BACKEND_API_BASE_URL?: string
  readonly RUNTIME_SERVICE_TOKEN_AUDIENCE?: string
  readonly RUNTIME_SERVICE_JWT?: string
}

export interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    __RUNTIME_CONFIG_CONTEXT__?: RuntimeConfigContext
    __RUNTIME_PREVIEW_CONTEXT__?: RuntimePreviewContext
    __RUNTIME_PRELOADED_CONFIG__?: RuntimePreloadedConfigBundle
    __EDITOR_RUNTIME_PREVIEW_READY__?: boolean
  }
}
