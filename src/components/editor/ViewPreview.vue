<!--
  文件用途：只读页面缩略预览组件。
  主要职责：
  1. 根据页面逻辑路径加载本地内建页或远程发布页模块；
  2. 使用固定 1920x1080 画布按比例缩放；
  3. 供侧边栏缩略图与路由提示卡片复用。
-->

<template>
  <div class="w-full h-full flex items-center justify-center overflow-hidden" :ref="setContainerRef">
    <FixedRatioContainer :isFullscreen="false" :scale="scale">
      <component :is="previewComponent" :key="refreshKey" />
    </FixedRatioContainer>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'

import FixedRatioContainer from '@/layouts/FixedRatioContainer.vue'
import { importViewModule } from '@/core/utils/view-module'

interface Props {
  filePath: string
  designWidth?: number
  designHeight?: number
  scaleLimit?: number
  refreshToken?: number
}

const props = withDefaults(defineProps<Props>(), {
  designWidth: 1920,
  designHeight: 1080,
  scaleLimit: 3,
  refreshToken: 0
})

const previewComponent = shallowRef<any>(buildEmptyComponent('未找到可预览页面'))
const containerRef = ref<HTMLElement | null>(null)
const scale = ref(1)
const refreshKey = ref(0)
let resizeObserver: ResizeObserver | null = null

/**
 * 记录预览容器并监听尺寸变化。
 * @param element 容器 DOM 引用
 */
function setContainerRef(element: Element | null): void {
  containerRef.value = element instanceof HTMLElement ? element : null
  bindResizeObserver()
}

/**
 * 绑定尺寸监听器并立即计算一次缩放比例。
 */
function bindResizeObserver(): void {
  resizeObserver?.disconnect()
  computeScale()
  if (!containerRef.value) {
    return
  }

  resizeObserver = new ResizeObserver(() => computeScale())
  resizeObserver.observe(containerRef.value)
}

/**
 * 根据容器大小计算缩放比例。
 */
function computeScale(): void {
  if (!containerRef.value) {
    return
  }

  const availableWidth = containerRef.value.clientWidth
  const availableHeight = containerRef.value.clientHeight
  const scaleX = availableWidth / props.designWidth
  const scaleY = availableHeight / props.designHeight
  scale.value = Math.min(scaleX, scaleY, props.scaleLimit)
}

/**
 * 加载预览页面模块。
 */
async function loadPreviewComponent(): Promise<void> {
  if (!props.filePath) {
    previewComponent.value = buildEmptyComponent('未找到可预览页面')
    refreshKey.value += 1
    return
  }

  try {
    const module = await importViewModule(props.filePath)
    previewComponent.value = module?.default || buildEmptyComponent('页面模块缺少默认导出')
  } catch (error) {
    console.error('缩略预览加载失败：', error)
    previewComponent.value = buildEmptyComponent(`页面加载失败：${props.filePath}`)
  } finally {
    refreshKey.value += 1
    await nextTick()
    computeScale()
  }
}

/**
 * 构造简单占位组件。
 * @param text 占位文案
 * @returns Vue 组件
 */
function buildEmptyComponent(text: string) {
  return defineComponent({
    name: 'ViewPreviewPlaceholder',
    setup() {
      return () => h(
        'div',
        {
          class: 'w-full h-full flex items-center justify-center text-[12px] text-slate-500 bg-slate-50'
        },
        text
      )
    }
  })
}

watch(() => props.filePath, () => {
  loadPreviewComponent()
}, { immediate: true })

watch(() => props.refreshToken, () => {
  loadPreviewComponent()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>
