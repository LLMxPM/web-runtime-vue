/**
 * 文件用途：统一加载应用配置、路由配置与图标配置，并为整项目预览提供组件解析能力。
 */

import { reactive, computed } from 'vue'
import { parse } from 'yaml'
import type { RouteRecordRaw } from 'vue-router'

import type { RouteConfig } from '@/core/types/navigation'
import { getRuntimePreloadedConfig, getRuntimePreviewContext } from '@/core/utils/path'
import { buildConfigUrl, hasExternalConfigSource } from './path'
import { createViewModuleLoader } from './view-module'

/**
 * 应用配置接口。
 */
export interface AppConfig {
  app: {
    icon: string
    title: string
    version: string
    description: string
    features?: {
      showPdfExportButton?: boolean
      menuMode?: 'text' | 'preview'
    }
  }
}

/**
 * 路由配置结构。
 */
export interface RouteConfigYaml {
  routes: Array<{
    route: string
    component?: string
    meta: {
      title: string
      icon?: string
      order: number
      pageNumber?: number
      hidden?: boolean
    }
    children?: Array<{
      route: string
      component: string
      meta: {
        title: string
        order: number
        pageNumber?: number
        hidden?: boolean
      }
    }>
  }>
}

/**
 * 图标配置结构。
 */
export interface IconConfigYaml {
  lucide_icons: Record<string, string[]> | string[]
  static_icons: Record<string, Array<{ name: string; src: string }>> | Array<{ name: string; src: string }>
  config: {
    default_size?: number
    default_stroke_width?: number
    fallback_behavior?: string
    placeholder_text?: string
  }
}

/**
 * 配置变化监听器类型。
 */
export type ConfigChangeListener = (configType: 'app' | 'routes' | 'icons') => void

/**
 * 默认应用配置。
 */
const defaultAppConfig: AppConfig = {
  app: {
    icon: 'Presentation',
    title: 'web-runtime-vue',
    version: '1.0.0',
    description: '只读预览运行时',
    features: {
      showPdfExportButton: true,
      menuMode: 'text'
    }
  }
}

/**
 * 默认图标配置。
 */
const defaultIconConfig: IconConfigYaml = {
  lucide_icons: [],
  static_icons: [],
  config: {
    default_size: 20,
    default_stroke_width: 2,
    fallback_behavior: 'show_placeholder',
    placeholder_text: '?'
  }
}

/**
 * 配置缓存。
 */
const configCache = new Map<string, unknown>()

/**
 * 配置状态。
 */
const configState = reactive({
  appConfig: null as AppConfig | null,
  routeConfig: null as RouteConfigYaml | null,
  iconConfig: null as IconConfigYaml | null,
  isLoading: false,
  error: null as string | null
})

/**
 * 配置变化监听器列表。
 */
const listeners: ConfigChangeListener[] = []

/**
 * 读取预加载配置中的指定分段。
 * @param configType 配置分段名称
 * @returns 预加载配置值
 */
function getPreloadedConfigSection<T>(configType: 'app' | 'routes' | 'icons'): T | undefined {
  const preloadedConfig = getRuntimePreloadedConfig()
  const value = preloadedConfig?.[configType]
  if (!value) {
    return undefined
  }
  return value as T
}

/**
 * 判断当前是否处于 SaaS 预览模式。
 * @returns 是否为预览模式
 */
function isPreviewMode(): boolean {
  return Boolean(getRuntimePreviewContext())
}

/**
 * 读取 YAML 配置文件，可选使用内存缓存。
 * @param url 配置 URL
 * @param useCache 是否使用缓存
 * @returns 解析后的配置对象
 */
export async function loadYamlFromUrl<T>(url: string, useCache = true): Promise<T> {
  if (useCache && configCache.has(url)) {
    return configCache.get(url) as T
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`加载配置失败：${url} -> ${response.status} ${response.statusText}`)
  }

  const yamlText = await response.text()
  const config = parse(yamlText) as T
  if (useCache) {
    configCache.set(url, config)
  }
  return config
}

/**
 * 清理配置缓存。
 * @param url 指定 URL；不传时清空全部缓存
 */
export function clearConfigCache(url?: string): void {
  if (url) {
    configCache.delete(url)
    return
  }
  configCache.clear()
}

/**
 * 在预览模式下校验预加载配置是否存在。
 * @param configType 配置分段名称
 */
function assertPreviewConfigExists(configType: 'app' | 'routes' | 'icons' | 'themes'): never {
  throw new Error(`预览模式缺少必需的预加载配置：${configType}`)
}

/**
 * 加载应用配置。
 * @param force 是否强制刷新
 * @returns 应用配置对象
 */
export async function loadAppConfig(force = false): Promise<AppConfig> {
  if (configState.appConfig && !force) {
    return configState.appConfig
  }

  try {
    configState.isLoading = true
    configState.error = null

    const preloadedAppConfig = getPreloadedConfigSection<AppConfig>('app')
    if (preloadedAppConfig) {
      configState.appConfig = preloadedAppConfig
      notifyListeners('app')
      return preloadedAppConfig
    }

    if (isPreviewMode()) {
      return assertPreviewConfigExists('app')
    }

    const configUrl = buildConfigUrl('app')
    configState.appConfig = await loadYamlFromUrl<AppConfig>(configUrl, !force)
    notifyListeners('app')
  } catch (error) {
    if (hasExternalConfigSource() || isPreviewMode()) {
      configState.error = error instanceof Error ? error.message : 'Unknown error'
      throw error
    }

    console.warn('加载应用配置失败，回退到默认配置：', error)
    configState.appConfig = { ...defaultAppConfig }
    configState.error = error instanceof Error ? error.message : 'Unknown error'
  } finally {
    configState.isLoading = false
  }

  return configState.appConfig || defaultAppConfig
}

/**
 * 加载路由配置。
 * @param force 是否强制刷新
 * @returns 路由配置对象
 */
export async function loadRouteConfig(force = false): Promise<RouteConfigYaml> {
  if (configState.routeConfig && !force) {
    return configState.routeConfig
  }

  try {
    configState.isLoading = true
    configState.error = null

    const preloadedRouteConfig = getPreloadedConfigSection<RouteConfigYaml>('routes')
    if (preloadedRouteConfig) {
      configState.routeConfig = preloadedRouteConfig
      notifyListeners('routes')
      return preloadedRouteConfig
    }

    if (isPreviewMode()) {
      return assertPreviewConfigExists('routes')
    }

    const configUrl = buildConfigUrl('routes')
    configState.routeConfig = await loadYamlFromUrl<RouteConfigYaml>(configUrl, !force)
    notifyListeners('routes')
  } catch (error) {
    if (hasExternalConfigSource() || isPreviewMode()) {
      configState.error = error instanceof Error ? error.message : 'Unknown error'
      throw error
    }

    console.warn('加载路由配置失败，回退到空路由：', error)
    configState.routeConfig = { routes: [] }
    configState.error = error instanceof Error ? error.message : 'Unknown error'
  } finally {
    configState.isLoading = false
  }

  return configState.routeConfig || { routes: [] }
}

/**
 * 加载图标配置。
 * @param force 是否强制刷新
 * @returns 图标配置对象
 */
export async function loadIconConfig(force = false): Promise<IconConfigYaml> {
  if (configState.iconConfig && !force) {
    return configState.iconConfig
  }

  try {
    configState.isLoading = true
    configState.error = null

    const preloadedIconConfig = getPreloadedConfigSection<IconConfigYaml>('icons')
    if (preloadedIconConfig) {
      configState.iconConfig = preloadedIconConfig
      notifyListeners('icons')
      return preloadedIconConfig
    }

    if (isPreviewMode()) {
      return assertPreviewConfigExists('icons')
    }

    const configUrl = buildConfigUrl('icons')
    configState.iconConfig = await loadYamlFromUrl<IconConfigYaml>(configUrl, !force)
    notifyListeners('icons')
  } catch (error) {
    if (hasExternalConfigSource() || isPreviewMode()) {
      configState.error = error instanceof Error ? error.message : 'Unknown error'
      throw error
    }

    console.warn('加载图标配置失败，回退到默认图标配置：', error)
    configState.iconConfig = { ...defaultIconConfig }
    configState.error = error instanceof Error ? error.message : 'Unknown error'
  } finally {
    configState.isLoading = false
  }

  return configState.iconConfig || defaultIconConfig
}

/**
 * 计算默认重定向路径。
 * @returns 默认首页路由
 */
function getDefaultRedirectPath(): string {
  if (!configState.routeConfig?.routes) {
    return 'home'
  }

  const sortedRoutes = [...configState.routeConfig.routes]
    .filter(route => !route.meta.hidden)
    .sort((a, b) => a.meta.order - b.meta.order)

  return sortedRoutes[0]?.route || 'home'
}

/**
 * 生成默认路由记录。
 * @returns 默认路由列表
 */
function getDefaultRouteRecords(): RouteRecordRaw[] {
  return [
    {
      path: '',
      redirect: getDefaultRedirectPath()
    } as RouteRecordRaw,
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: createViewModuleLoader('@/views/defaultpage/NotFoundPage.vue'),
      meta: {
        title: '页面未找到',
        hidden: true
      }
    } as RouteRecordRaw
  ]
}

/**
 * 计算并分配页码。
 * @param yamlRoutes YAML 路由配置
 * @returns 带页码的路由配置副本
 */
function calculatePageNumbers(yamlRoutes: RouteConfigYaml['routes']): RouteConfigYaml['routes'] {
  const routes = JSON.parse(JSON.stringify(yamlRoutes))
  routes.sort((a: any, b: any) => (a.meta.order || 0) - (b.meta.order || 0))

  let currentPageNumber = 1
  routes.forEach((route: any) => {
    const hasChildren = route.children && route.children.length > 0

    if (!hasChildren && !route.meta?.hidden) {
      route.meta.pageNumber = currentPageNumber
      currentPageNumber += 1
    }

    if (hasChildren) {
      route.children.sort((a: any, b: any) => (a.meta.order || 0) - (b.meta.order || 0))
      route.children.forEach((child: any) => {
        if (!child.meta?.hidden) {
          child.meta.pageNumber = currentPageNumber
          currentPageNumber += 1
        }
      })
    }
  })

  return routes
}

/**
 * 将 YAML 路由配置转换为运行时路由配置。
 * @param yamlRoutes YAML 路由配置
 * @returns RouteConfig 数组
 */
function convertYamlRoutesToRouteConfig(yamlRoutes: RouteConfigYaml['routes']): RouteConfig[] {
  const routesWithPageNumbers = calculatePageNumbers(yamlRoutes)

  return routesWithPageNumbers.map(route => {
    const hasChildren = route.children && route.children.length > 0

    const routeConfig: RouteConfig = {
      path: route.route,
      title: route.meta.title,
      name: route.route,
      order: route.meta.order,
      pageNumber: route.meta.pageNumber,
      component: createViewModuleLoader(route.component || '@/views/defaultpage/NotFoundPage.vue'),
      meta: {
        ...route.meta,
        componentPath: route.component
      }
    }

    if (hasChildren) {
      routeConfig.children = route.children!.map(child => ({
        path: child.route,
        title: child.meta?.title || child.route,
        name: `${route.route}-${child.route}`,
        order: child.meta.order,
        pageNumber: child.meta.pageNumber,
        component: createViewModuleLoader(child.component || '@/views/defaultpage/NotFoundPage.vue'),
        meta: {
          ...child.meta,
          parent: route.route,
          componentPath: child.component
        }
      }))
    }

    return routeConfig
  })
}

/**
 * 获取当前已转换的路由配置。
 * @returns RouteConfig 数组
 */
function getCurrentRouteConfigs(): RouteConfig[] {
  if (!configState.routeConfig?.routes) {
    console.warn('路由配置尚未加载，返回空路由列表。')
    return []
  }

  return convertYamlRoutesToRouteConfig(configState.routeConfig.routes)
}

/**
 * 响应式应用配置。
 */
export const appConfig = computed(() => configState.appConfig || defaultAppConfig)

/**
 * 响应式路由配置数组。
 */
export const routeConfigs = computed(() => getCurrentRouteConfigs())

/**
 * 响应式默认路由配置。
 */
export const defaultRouteConfig = computed(() => getDefaultRouteRecords())

/**
 * 响应式图标配置。
 */
export const iconConfig = computed(() => configState.iconConfig || defaultIconConfig)

/**
 * 添加配置变化监听器。
 * @param listener 监听器函数
 */
export function addChangeListener(listener: ConfigChangeListener): void {
  listeners.push(listener)
}

/**
 * 移除配置变化监听器。
 * @param listener 监听器函数
 */
export function removeChangeListener(listener: ConfigChangeListener): void {
  const index = listeners.indexOf(listener)
  if (index >= 0) {
    listeners.splice(index, 1)
  }
}

/**
 * 通知配置监听器。
 * @param configType 变更的配置分段
 */
function notifyListeners(configType: 'app' | 'routes' | 'icons'): void {
  listeners.forEach(listener => {
    try {
      listener(configType)
    } catch (error) {
      console.error('配置监听器执行失败：', error)
    }
  })
}

/**
 * 异步获取路由配置数组。
 * @returns RouteConfig 数组
 */
export async function getRouteConfigsAsync(): Promise<RouteConfig[]> {
  await loadRouteConfig()
  return getCurrentRouteConfigs()
}

/**
 * 异步获取默认路由记录。
 * @returns RouteRecordRaw 数组
 */
export async function getDefaultRouteConfigAsync(): Promise<RouteRecordRaw[]> {
  await loadRouteConfig()
  return getDefaultRouteRecords()
}

/**
 * 初始化配置系统。
 */
export async function initializeConfig(): Promise<void> {
  await Promise.all([
    loadAppConfig(),
    loadRouteConfig(),
    loadIconConfig()
  ])
}

/**
 * 重新加载全部配置。
 */
export async function reloadAllConfigs(): Promise<void> {
  clearConfigCache()
  configState.appConfig = null
  configState.routeConfig = null
  configState.iconConfig = null

  await Promise.all([
    loadAppConfig(true),
    loadRouteConfig(true),
    loadIconConfig(true)
  ])
}

/**
 * 异步获取图标配置。
 * @returns 图标配置对象
 */
export async function getIconConfigAsync(): Promise<IconConfigYaml> {
  return loadIconConfig()
}
