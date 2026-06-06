<!--
  文件用途：Draw.io XML 图表渲染器，负责加载 diagrams.net viewer 并适配容器缩放。
-->

<template>
  <div
    ref="viewerRoot"
    class="drawio-viewer"
    :class="[
      props.class,
      {
        'drawio-viewer--loading': loading,
        'drawio-viewer--error': error,
      },
    ]"
    :style="containerStyle"
  >
    <!-- 加载状态 -->
    <div v-if="loading" class="drawio-viewer__loading layout-center">
      <div class="animate-spin">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-8 h-8">
          <circle
cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-dasharray="31.416" stroke-dashoffset="31.416">
            <animate
attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416"
              repeatCount="indefinite" />
            <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
      <span class="ml-2 text-sm text-secondary">加载中...</span>
    </div>

    <!-- 错误状态 -->
    <div v-if="error" class="flex flex-col items-center justify-center text-red-500">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 mb-2">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
        <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2" />
        <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2" />
      </svg>
      <span class="text-sm">{{ error }}</span>
    </div>

    <!-- Draw.io 图表容器 -->
    <div ref="diagramContainer" class="drawio-viewer__container" :class="{ 'hidden': loading || error }"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { resolveResourcePath } from '@runtime-kit/public/utils/assets.v1'
import { buildViewerSurfaceStyle, type ViewerSurfaceProps } from '@runtime-kit/internal/utils/viewer-style'

interface Props extends ViewerSurfaceProps {
  src?: string
  content?: string
  class?: string
  highlightColor?: string
}

const props = withDefaults(defineProps<Props>(), {
  src: '',
  content: '',
  class: '',
  highlightColor: 'var(--tw-color-accent1)',
})

// 响应式状态
const loading = ref(false)
const error = ref<string | null>(null)
const viewerRoot = ref<HTMLElement | null>(null)
const diagramContainer = ref<HTMLElement | null>(null)
const intrinsicHeight = ref<string | null>(null)

// 引用当前 SVG 和 G 元素
let currentSvg: SVGSVGElement | null = null
let currentG: SVGGElement | null = null
let resizeObserver: ResizeObserver | null = null
let zoomTimer: number | null = null

// CDN 配置
const GRAPH_VIEWER_CDN = 'https://viewer.diagrams.net/js/viewer.min.js'
const MIN_RENDER_SIZE = 24
const MIN_INTRINSIC_HEIGHT = 200
const MAX_INTRINSIC_HEIGHT = 960
const MAX_ZOOM_RETRIES = 30
const INTRINSIC_HEIGHT_RELEASE_RATIO = 1.25

/**
 * 动态加载 GraphViewer 脚本
 */
const loadGraphViewerScript = async (): Promise<void> => {
  if (typeof window !== 'undefined' && window.GraphViewer) {
    return
  }

  const existing = document.querySelector(`script[src="${GRAPH_VIEWER_CDN}"]`)
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('CDN viewer.min.js 加载失败')))
      if (window.GraphViewer) resolve()
    })
    return
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GRAPH_VIEWER_CDN
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('CDN viewer.min.js 加载失败'))
    document.head.appendChild(script)
  })
}

// 样式计算
const containerStyle = computed(() => ({
  ...buildViewerSurfaceStyle(props),
  ...(intrinsicHeight.value
    ? {
      height: intrinsicHeight.value,
      minHeight: intrinsicHeight.value,
    }
    : {}),
}))

/**
 * 预处理 Draw.io XML 内容
 * 确保 XML 格式符合 GraphViewer 的要求
 */
const preprocessDrawioXml = (xmlContent: string): string => {
  let processedXml = xmlContent.trim()
  
  // 如果没有 XML 声明头，添加一个
  if (!processedXml.startsWith('<?xml')) {
    processedXml = '<?xml version="1.0" encoding="UTF-8"?>\n' + processedXml
  }
  
  // 确保根元素是 mxfile
  if (!processedXml.includes('<mxfile')) {
    throw new Error('不是有效的 Draw.io 文件')
  }
    
  return processedXml
}

/**
 * 处理图片路径
 */
const processImagePath = (src: string): string => {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src
  }
  return resolveResourcePath(src)
}

/**
 * 判断高度是否需要从图表自身比例兜底。
 *
 * @returns 高度依赖外层布局时返回 true
 */
const shouldUseIntrinsicHeight = (): boolean => {
  const height = props.height
  return height === undefined
    || height === null
    || height === ''
    || height === 'auto'
    || (typeof height === 'string' && height.trim().endsWith('%'))
}

/**
 * 在外层没有可用高度时，根据 Draw.io 自身宽高比补一个稳定高度。
 *
 * @param bbox 图表内容原始边界
 * @returns 是否更新了兜底高度
 */
const updateIntrinsicHeight = (bbox: DOMRect): boolean => {
  if (!shouldUseIntrinsicHeight()) {
    if (intrinsicHeight.value) intrinsicHeight.value = null
    return false
  }

  const root = viewerRoot.value
  const container = diagramContainer.value
  const parent = root?.parentElement ?? null
  const rootHeight = root?.clientHeight ?? 0
  const parentHeight = parent?.clientHeight ?? 0
  const currentIntrinsicHeight = parseFloat(intrinsicHeight.value || '0')

  if (intrinsicHeight.value && parentHeight >= MIN_RENDER_SIZE) {
    const parentHasIndependentHeight = currentIntrinsicHeight > 0
      && parentHeight > currentIntrinsicHeight * INTRINSIC_HEIGHT_RELEASE_RATIO
    if (parentHasIndependentHeight) {
      intrinsicHeight.value = null
      return true
    }
  }

  if (rootHeight >= MIN_RENDER_SIZE) {
    return false
  }

  const availableWidth = root?.clientWidth || container?.clientWidth || parent?.clientWidth || bbox.width
  if (!availableWidth || !bbox.width || !bbox.height) return false

  const nextHeight = Math.ceil(
    Math.min(
      Math.max((availableWidth * bbox.height) / bbox.width, MIN_INTRINSIC_HEIGHT),
      MAX_INTRINSIC_HEIGHT,
    ),
  )
  const nextValue = `${nextHeight}px`
  if (intrinsicHeight.value === nextValue) return false

  intrinsicHeight.value = nextValue
  return true
}

/**
 * 手动应用缩放和居中，兼容父级未显式声明高度的场景。
 *
 * @returns 是否已成功完成缩放
 */
const applyManualZoom = (): boolean => {
  const svgElement = diagramContainer.value?.querySelector('svg') as SVGSVGElement | null
  if (!svgElement) return false

  const gElement = svgElement.querySelector('g') as SVGGElement | null
  if (!gElement) return false

  currentSvg = svgElement
  currentG = gElement

  // 获取 g 元素的原始边界框（SVG 逻辑坐标）
  const bbox = gElement.getBBox()
  if (!bbox.width || !bbox.height) return false

  if (updateIntrinsicHeight(bbox)) {
    nextTick(() => scheduleManualZoom(0))
    return false
  }

  // 获取容器的 client 尺寸（不包括 border/padding）
  const container = diagramContainer.value!
  const containerWidth = container.clientWidth
  const containerHeight = container.clientHeight

  if (containerWidth < MIN_RENDER_SIZE || containerHeight < MIN_RENDER_SIZE) return false

  // 计算缩放比例（保持宽高比，完整显示）
  const scaleX = containerWidth / bbox.width
  const scaleY = containerHeight / bbox.height
  const scale = Math.min(scaleX, scaleY)

  // 计算缩放后的图像尺寸
  const scaledWidth = bbox.width * scale
  const scaledHeight = bbox.height * scale

  // 计算居中偏移量（使图像在容器中居中）
  const offsetX = (containerWidth - scaledWidth) / 2
  const offsetY = (containerHeight - scaledHeight) / 2

  // 应用变换：先平移到居中位置，再缩放
  // bbox.x / bbox.y 可能不是 0，需要扣除原始坐标偏移。
  gElement.setAttribute(
    'transform',
    `translate(${offsetX - bbox.x * scale}, ${offsetY - bbox.y * scale}) scale(${scale})`
  )

  // 设置 SVG 基础样式
  svgElement.style.width = '100%'
  svgElement.style.height = '100%'
  svgElement.style.overflow = 'visible'
  svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  return true
}

/**
 * 延迟并重试缩放，兼容 GraphViewer 异步插入 SVG 和父级延迟布局。
 *
 * @param delay 延迟毫秒数
 * @param retryCount 当前重试次数
 */
const scheduleManualZoom = (delay = 80, retryCount = 0) => {
  if (zoomTimer !== null) {
    window.clearTimeout(zoomTimer)
    zoomTimer = null
  }

  zoomTimer = window.setTimeout(() => {
    zoomTimer = null
    const applied = applyManualZoom()
    if (!applied && retryCount < MAX_ZOOM_RETRIES) {
      scheduleManualZoom(100, retryCount + 1)
    }
  }, delay)
}

/**
 * 窗口大小变化时重新缩放
 */
const handleResize = () => {
  if (currentSvg && currentG) scheduleManualZoom(0)
}

/**
 * 渲染 Draw.io XML 内容。
 *
 * @param xmlContent Draw.io XML 源码
 */
const renderDiagramContent = async (xmlContent: string) => {
  if (!xmlContent.trim()) return
  loading.value = true
  error.value = null

  try {
    await loadGraphViewerScript()
    await nextTick()

    // 确保容器存在
    let retryCount = 0
    const maxRetries = 10
    while (!diagramContainer.value && retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 50))
      retryCount++
    }
    if (!diagramContainer.value) {
      throw new Error('Diagram container is not available')
    }

    diagramContainer.value.innerHTML = ''
    const xml = preprocessDrawioXml(xmlContent)

    // 配置：禁用工具栏，不依赖 viewer 的 zoom
    const data: Record<string, string> = {
      xml: xml,
      lightbox: 'false' // 关键：禁用灯箱/工具栏
    }

    if (props.highlightColor) data.highlight = props.highlightColor

    const div = document.createElement('div')
    div.className = 'mxgraph'
    div.style.maxWidth = '100%'
    div.style.border = '1px solid transparent'
    div.setAttribute('data-mxgraph', JSON.stringify(data))
    diagramContainer.value.appendChild(div)

    if (window.GraphViewer) {
      window.GraphViewer.processElements()
      // GraphViewer 会异步插入 SVG，需等待实际输出后再适配容器。
      scheduleManualZoom(100)
    } else {
      throw new Error('GraphViewer not initialized')
    }

    loading.value = false
  } catch (err) {
    loading.value = false
    error.value = err instanceof Error ? err.message : 'Unknown error'
    console.error('DrawioViewer: Failed to load diagram', err)
  }
}

/**
 * 从 URL 加载图表内容。
 *
 * @param src Draw.io XML 文件地址
 */
const loadDiagram = async (src: string) => {
  if (!src) return

  loading.value = true
  error.value = null
  try {
    const processedSrc = processImagePath(src)
    const response = await fetch(processedSrc)
    if (!response.ok) {
      throw new Error(`Failed to load diagram: ${response.status} ${response.statusText}`)
    }
    await renderDiagramContent(await response.text())
  } catch (err) {
    loading.value = false
    error.value = err instanceof Error ? err.message : 'Unknown error'
    console.error('DrawioViewer: Failed to load diagram', err)
  }
}

/**
 * 按 content 优先、src 兜底的顺序刷新图表。
 */
const reloadDiagram = async () => {
  const directContent = props.content.trim()
  if (directContent) {
    await nextTick()
    await renderDiagramContent(directContent)
    return
  }
  if (props.src) {
    await nextTick()
    await loadDiagram(props.src)
    return
  }
  clearDiagram()
}

/**
 * 清空当前图表 DOM 和状态。
 */
const clearDiagram = () => {
  if (diagramContainer.value) diagramContainer.value.innerHTML = ''
  error.value = null
  loading.value = false
}

// 监听内容来源变化
watch(() => [props.src, props.content], reloadDiagram, { immediate: false })

// 监听其他配置变化
watch(() => [props.highlightColor], async () => {
  await reloadDiagram()
})

// 组件挂载
onMounted(async () => {
  await nextTick()
  if (viewerRoot.value) {
    resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(viewerRoot.value)
    if (diagramContainer.value) resizeObserver.observe(diagramContainer.value)
    if (viewerRoot.value.parentElement) resizeObserver.observe(viewerRoot.value.parentElement)
  }
  window.addEventListener('resize', handleResize)

  try {
    await loadGraphViewerScript()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'CDN viewer.min.js 加载失败'
  }

  await reloadDiagram()
})

// 组件卸载前清理
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (zoomTimer !== null) {
    window.clearTimeout(zoomTimer)
    zoomTimer = null
  }
})

// 暴露方法
defineExpose({
  reload: reloadDiagram,
  clear: clearDiagram,
})

// 全局类型声明
declare global {
  interface Window {
    GraphViewer?: {
      processElements(): void
    }
  }
}
</script>

<style scoped>
.drawio-viewer {
  position: relative;
  box-sizing: border-box;
  display: flex;
  overflow: hidden;
}

.drawio-viewer__container {
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  /* 确保没有 padding/border 干扰 */
  padding: 0;
  margin: 0;
  box-sizing: border-box;
}

.drawio-viewer__loading {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.8);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hidden {
  display: none !important;
}
</style>

<style>
/* 确保 SVG 正确渲染 */
/* 确保 SVG 不被干扰 */
.mxgraph svg {
  width: 100% !important;
  height: 100% !important;
  display: block !important;
  overflow: visible !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
}

.mxgraph {
  width: 100% !important;
  height: 100% !important;
  border: none !important;
  padding: 0 !important;
  margin: 0 !important;
}

/* 提升 Draw.io 遮罩层与图表容器的层级，确保在最上层显示 */
.mx-overlay,
.geDiagramContainer {
  z-index: 9999 !important;
}

div[style*="position: fixed; inset: 0px; z-index: 999; background-color: rgb(0, 0, 0); opacity: 0.7;"] {
  z-index: 9999 !important;
}

/* 针对 Draw.io 灯箱工具栏（通过内联样式 transform 识别）进行定位覆盖 */
div[style*="transform: translate(-50%, 0px);"] {
  /* 将工具栏从默认的底部居中改为右上角定位 */
  left: auto !important;
  right: 45px !important;
  top: 45px !important;
  bottom: auto !important;
  /* 取消原有 bottom: 60px */
  z-index: 9999 !important;

  /* 移除原有的水平居中 transform，避免偏移 */
  transform: none !important;
  -webkit-transform: none !important;
}
</style>
