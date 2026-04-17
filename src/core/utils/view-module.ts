/**
 * 文件用途：统一处理页面视图模块的本地加载、远程虚拟模块加载与缺省回退逻辑。
 */

import {
  buildRemoteModuleId,
  isBuiltinLocalViewPath,
  normalizeRuntimeModulePath,
  toAliasModulePath,
} from '@/core/shared/runtime-preview'
import { getRuntimePreviewContext, getRuntimePreviewToken } from '@/core/utils/path'

const LOCAL_VIEW_MODULES = {
  ...import.meta.glob('@/views/**/*.vue'),
  ...import.meta.glob('/src/views/**/*.vue')
}

const NOT_FOUND_FALLBACK_KEYS = [
  '@/views/defaultpage/NotFoundPage.vue',
  '/src/views/defaultpage/NotFoundPage.vue'
]

/**
 * 规范化逻辑路径并返回对应的本地别名路径。
 * @param viewPath 页面逻辑路径
 * @returns 规范化结果
 */
export function resolveViewModulePath(viewPath: string): {
  normalizedPath: string
  aliasPath: string
} {
  const normalizedPath = normalizeRuntimeModulePath(viewPath)
  return {
    normalizedPath,
    aliasPath: toAliasModulePath(normalizedPath)
  }
}

/**
 * 判断当前页面模块是否应通过远程发布产物加载。
 * @param normalizedPath 已规范化的逻辑路径
 * @returns 是否走远程虚拟模块
 */
export function shouldUseRemoteViewModule(normalizedPath: string): boolean {
  const previewContext = getRuntimePreviewContext()
  return Boolean(
    previewContext
    && normalizedPath
    && !isBuiltinLocalViewPath(normalizedPath)
  )
}

/**
 * 生成页面模块的动态导入器。
 * @param viewPath 页面逻辑路径
 * @returns 异步模块导入函数
 */
export function createViewModuleLoader(viewPath: string): () => Promise<any> {
  return async () => importViewModule(viewPath)
}

/**
 * 动态导入页面模块。
 * @param viewPath 页面逻辑路径
 * @returns 页面模块对象
 */
export async function importViewModule(viewPath: string): Promise<any> {
  const { normalizedPath, aliasPath } = resolveViewModulePath(viewPath)

  if (!normalizedPath) {
    return importFallbackModule()
  }

  if (shouldUseRemoteViewModule(normalizedPath)) {
    const previewContext = getRuntimePreviewContext()
    if (!previewContext) {
      return importFallbackModule()
    }
    const previewToken = getRuntimePreviewToken()
    if (!previewToken) {
      return importFallbackModule()
    }

    const remoteModuleId = buildRemoteModuleId(
      previewContext.artifactId,
      normalizedPath,
      previewToken,
    )
    return import(/* @vite-ignore */ remoteModuleId)
  }

  const localModuleLoader = resolveLocalViewModuleLoader(aliasPath)
  if (localModuleLoader) {
    return localModuleLoader()
  }

  return importFallbackModule()
}

/**
 * 解析本地页面模块导入器。
 * @param aliasPath `@/views/...` 形式的别名路径
 * @returns 对应导入器；未命中时返回 null
 */
function resolveLocalViewModuleLoader(aliasPath: string): (() => Promise<any>) | null {
  if (!aliasPath) {
    return null
  }

  const directLoader = LOCAL_VIEW_MODULES[aliasPath]
  if (directLoader) {
    return directLoader
  }

  const srcPath = aliasPath.replace('@/', '/src/')
  return LOCAL_VIEW_MODULES[srcPath] || null
}

/**
 * 加载本地内建的 NotFound 页面。
 * @returns Fallback 模块
 */
async function importFallbackModule(): Promise<any> {
  for (const fallbackKey of NOT_FOUND_FALLBACK_KEYS) {
    const loader = LOCAL_VIEW_MODULES[fallbackKey]
    if (loader) {
      return loader()
    }
  }

  return {
    default: {
      template: '<div class="p-8 text-red-600">页面组件加载失败</div>'
    }
  }
}
