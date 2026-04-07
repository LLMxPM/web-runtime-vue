<!--
  文件功能：Editor 推送页面专用预览应用，按当天目录过滤候选页面文件并以 16:9 比例渲染。
-->

<template>
  <div class="w-full h-full flex items-center justify-center overflow-hidden bg-slate-100" :ref="setContainerRef">
    <FixedRatioContainer :isFullscreen="false" :scale="scale">
      <component
        v-if="previewComponent"
        :is="previewComponent"
        :key="refreshKey"
        @vue:mounted="handlePreviewMounted"
      />
      <div v-else class="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-500 bg-white">
        <div class="text-lg font-semibold">页面预览暂不可用</div>
        <div class="max-w-[720px] text-center text-sm leading-6 px-8">{{ errorMessage }}</div>
      </div>
    </FixedRatioContainer>
  </div>
</template>

<script setup lang="ts">
import {
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue'

import FixedRatioContainer from '@/layouts/FixedRatioContainer.vue'
import { useTheme } from '@/core/composables/useTheme'

interface Props {
  /** 当前要预览的 Runtime 页面文件路径。 */
  filePath: string
  /** 当前预览允许访问的日期片段，格式为 yyyy-mm-dd。 */
  currentDateSegment: string
  /** 设计稿宽度。 */
  designWidth?: number
  /** 设计稿高度。 */
  designHeight?: number
  /** 最大缩放倍率。 */
  scaleLimit?: number
}

const props = withDefaults(defineProps<Props>(), {
  designWidth: 1920,
  designHeight: 1080,
  scaleLimit: 3,
})

const containerRef = ref<HTMLElement | null>(null)
const scale = ref<number>(1)
const refreshKey = ref<number>(0)
const previewComponent = shallowRef<any | null>(null)
const errorMessage = ref<string>('正在准备预览页面...')
let resizeObserver: ResizeObserver | null = null

const { themeStyles } = useTheme()

/**
 * 将主题样式同步到根节点，尽量保持与主应用一致的视觉表现。
 */
function applyThemeToRoot(): void {
  const styles = themeStyles.value
  if (!styles || !document.documentElement) {
    return
  }

  Object.entries(styles).forEach(([key, value]) => {
    if (key.startsWith('--theme-')) {
      document.documentElement.style.setProperty(key, String(value))
    }
  })
}

/**
 * 向窗口广播预览是否已完成首次稳定渲染，供无头浏览器截图链路等待。
 */
function markPreviewReady(ready: boolean): void {
  window.__EDITOR_RUNTIME_PREVIEW_READY__ = ready
  window.dispatchEvent(new CustomEvent('editor-runtime-preview-ready', { detail: { ready } }))
}

/**
 * 规范化预览文件路径，统一转换为 `/src/views/...` 形式。
 */
function normalizePreviewFilePath(filePath: string): string {
  const normalized = String(filePath || '').trim().replace(/\\/g, '/')
  if (!normalized) {
    return ''
  }
  if (normalized.startsWith('/src/views/')) {
    return normalized
  }
  if (normalized.startsWith('src/views/')) {
    return `/${normalized}`
  }
  if (normalized.startsWith('@/views/')) {
    return `/src/views/${normalized.slice('@/views/'.length)}`
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

/**
 * 根据当天目录过滤候选模块，只允许命中 `src/views/当前日期/` 下的页面文件。
 */
function resolveTodayScopedLoader(filePath: string): (() => Promise<unknown>) | null {
  const normalizedFilePath = normalizePreviewFilePath(filePath)
  const allowedPrefix = `/src/views/${props.currentDateSegment}/`
  const modules = import.meta.glob('/src/views/**/*.vue')
  const scopedEntries = Object.entries(modules).filter(([key]) => key.startsWith(allowedPrefix))
  const matched = scopedEntries.find(([key]) => key === normalizedFilePath)
  return matched?.[1] ?? null
}

/**
 * 重新加载预览组件。
 */
function reloadPreviewComponent(): void {
  markPreviewReady(false)
  const loader = resolveTodayScopedLoader(props.filePath)
  if (!loader) {
    previewComponent.value = null
    errorMessage.value = `未找到可预览组件：${props.filePath}。当前预览仅允许访问 ${props.currentDateSegment} 目录下的页面文件。`
    refreshKey.value++
    return
  }

  errorMessage.value = ''
  previewComponent.value = defineAsyncComponent(async () => {
    try {
      return await loader()
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '页面预览加载失败。'
      markPreviewReady(false)
      throw error
    }
  })
  refreshKey.value++
  void nextTick(() => computeScale())
}

/**
 * 预览组件挂载完成后，等待字体资源稳定，再发出可截图信号。
 */
async function handlePreviewMounted(): Promise<void> {
  await nextTick()
  if (document.fonts?.ready) {
    await document.fonts.ready
  }
  requestAnimationFrame(() => markPreviewReady(true))
}

/**
 * 计算当前容器下的最佳缩放比例。
 */
function computeScale(): void {
  const element = containerRef.value
  if (!element) {
    return
  }

  const scaleX = element.clientWidth / props.designWidth
  const scaleY = element.clientHeight / props.designHeight
  scale.value = Math.min(scaleX, scaleY, props.scaleLimit)
}

/**
 * 记录容器引用，并监听容器尺寸变化。
 */
function setContainerRef(element: Element | null): void {
  const dom = element instanceof HTMLElement ? element : null
  containerRef.value = dom
  resizeObserver?.disconnect()
  if (dom) {
    resizeObserver = new ResizeObserver(() => computeScale())
    resizeObserver.observe(dom)
  }
  computeScale()
}

watch(() => props.filePath, () => reloadPreviewComponent(), { immediate: true })
watch(() => props.currentDateSegment, () => reloadPreviewComponent())
watch(themeStyles, () => applyThemeToRoot(), { immediate: true, deep: true })

onMounted(() => {
  applyThemeToRoot()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  markPreviewReady(false)
})
</script>
