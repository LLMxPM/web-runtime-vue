<!--
  文件用途：提供工作空间组件的纯沙箱预览宿主页，负责读取后端下发的 previewSchema、接收父窗口状态更新并渲染目标组件。
-->
<template>
  <main class="component-preview-view" :style="{ background: canvasBackground }">
    <div ref="viewportRef" class="component-preview-viewport">
      <FixedRatioContainer
        :is-fullscreen="false"
        :scale="scale"
        :design-width="canvasWidth"
        :design-height="canvasHeight"
      >
        <section class="component-preview-canvas" :style="canvasStyle">
          <div v-if="loading" class="component-preview-state component-preview-state--loading">
            正在加载组件预览...
          </div>
          <div v-else-if="errorMessage" class="component-preview-state component-preview-state--error">
            <h1>组件预览启动失败</h1>
            <p>{{ errorMessage }}</p>
          </div>
          <PreviewContentRenderer
            v-else-if="componentDefinition"
            :component-definition="componentDefinition"
            :state="previewState"
          />
        </section>
      </FixedRatioContainer>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, readonly, ref, shallowRef, type CSSProperties } from 'vue'

import FixedRatioContainer from '@/layouts/FixedRatioContainer.vue'
import {
  COMPONENT_PREVIEW_READY_EVENT,
  COMPONENT_PREVIEW_UPDATE_CANVAS_EVENT,
  COMPONENT_PREVIEW_UPDATE_STATE_EVENT,
  buildInitialComponentPreviewState,
  clonePreviewValue,
  normalizeComponentPreviewSchema,
  normalizeComponentPreviewState,
  type ComponentPreviewUpdateCanvasMessage,
  type ComponentPreviewReadyMessage,
  type ComponentPreviewState,
  type ComponentPreviewUpdateStateMessage,
} from '@/core/shared/component-preview'
import type { ComponentPreviewSchema, RuntimeComponentPreviewCanvasConfig } from '@/core/shared/runtime-preview'
import { COMPONENT_PREVIEW_MOCKS_KEY } from '@/core/composables/useComponentPreviewMock'
import { getRuntimePreloadedConfig, getRuntimePreviewContext } from '@/core/utils/path'
import { importPreviewModule } from '@/core/utils/preview-module'
import {
  computeComponentPreviewScale,
  normalizeComponentPreviewCanvasConfig,
  resolveComponentPreviewCanvasOverrides,
} from './canvas'
import PreviewContentRenderer from './PreviewContentRenderer'

const componentDefinition = shallowRef<any>(null)
const previewSchema = ref<ComponentPreviewSchema | null>(null)
const previewState = ref<ComponentPreviewState>(buildInitialComponentPreviewState(null))
const loading = ref(true)
const errorMessage = ref('')
const mockStateRef = computed(() => previewState.value.mocks)

provide(COMPONENT_PREVIEW_MOCKS_KEY, readonly(mockStateRef))

const previewContext = computed(() => getRuntimePreviewContext())
const componentPreviewConfig = computed(() => getRuntimePreloadedConfig()?.component_preview)
const parentOrigin = resolveParentOrigin()
const viewportRef = ref<HTMLElement | null>(null)
const canvasConfig = ref<Required<RuntimeComponentPreviewCanvasConfig>>(
  normalizeComponentPreviewCanvasConfig(componentPreviewConfig.value?.canvas),
)
const canvasWidth = computed(() => canvasConfig.value.width)
const canvasHeight = computed(() => canvasConfig.value.height)
const canvasPadding = computed(() => canvasConfig.value.padding)
const canvasBackground = computed(() => canvasConfig.value.background)
const canvasStyle = computed<CSSProperties>(() => ({
  padding: `${canvasPadding.value}px`,
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  background: '#ffffff',
}))
const scale = ref(1)
let resizeObserver: ResizeObserver | null = null

/**
 * 根据宿主页容器大小计算画布缩放比例，避免大尺寸组件把页面整体撑开。
 */
function computeScale(): void {
  if (!viewportRef.value) {
    return
  }

  const availableWidth = Math.max(viewportRef.value.clientWidth, 320)
  const availableHeight = Math.max(viewportRef.value.clientHeight, 220)
  scale.value = computeComponentPreviewScale(
    availableWidth,
    availableHeight,
    canvasWidth.value,
    canvasHeight.value,
  )
}

/**
 * 绑定预览容器尺寸监听，确保宿主页在 iframe 尺寸变化时仍能稳定缩放。
 */
function bindResizeObserver(): void {
  resizeObserver?.disconnect()
  computeScale()
  if (!viewportRef.value) {
    return
  }

  resizeObserver = new ResizeObserver(() => computeScale())
  resizeObserver.observe(viewportRef.value)
}

/**
 * 加载组件模块、读取后端下发 schema 并向父窗口回传 ready 事件。
 */
async function bootstrapComponentPreview(): Promise<void> {
  const previewConfig = componentPreviewConfig.value
  const artifactId = previewContext.value?.artifactId
  if (!previewConfig || !previewConfig.component_import_path || !artifactId) {
    errorMessage.value = '缺少组件预览上下文或目标组件路径。'
    loading.value = false
    return
  }

  try {
    loading.value = true
    canvasConfig.value = normalizeComponentPreviewCanvasConfig(
      previewConfig.canvas,
      resolveComponentPreviewCanvasOverrides(typeof window === 'undefined' ? '' : window.location.search),
    )
    const importedModule = await importPreviewModule(previewConfig.component_import_path)
    componentDefinition.value = importedModule?.default || importedModule
    previewSchema.value = normalizeComponentPreviewSchema(previewConfig.schema)
    previewState.value = buildInitialComponentPreviewState(previewSchema.value)
    await nextTick()
    computeScale()
    notifyParentReady()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '未知组件预览错误。'
  } finally {
    loading.value = false
  }
}

/**
 * 向父窗口发送组件预览就绪事件。
 */
function notifyParentReady(): void {
  const artifactId = previewContext.value?.artifactId
  const previewConfig = componentPreviewConfig.value
  if (!artifactId || !previewConfig || typeof window === 'undefined' || !window.parent) {
    return
  }

  const readyMessage: ComponentPreviewReadyMessage = {
    type: COMPONENT_PREVIEW_READY_EVENT,
    payload: {
      version: 1,
      artifactId,
      schema: clonePreviewValue(previewSchema.value),
      defaultState: clonePreviewValue(previewState.value),
      componentMeta: {
        code: previewConfig.component_code,
        versionNo: previewConfig.component_version_no,
        displayName: previewConfig.display_name || previewConfig.component_code,
      },
    },
  }
  // 编辑器开发环境常通过不同 origin 加载预览 iframe，且 iframe 配置了 same-origin referrer policy，
  // 此时子窗口无法通过 document.referrer 推断父窗口 origin。这里退回 "*"，由父窗口继续按 event.origin
  // 校验消息来源，避免 previewSchema ready 事件被静默丢弃。
  window.parent.postMessage(readyMessage, parentOrigin || '*')
}

/**
 * 监听父窗口发来的预览状态更新消息。
 * @param event postMessage 事件
 */
function handleWindowMessage(event: MessageEvent<unknown>): void {
  const artifactId = previewContext.value?.artifactId
  if (!artifactId || !event.data || typeof event.data !== 'object') {
    return
  }
  if (parentOrigin && event.origin !== parentOrigin) {
    return
  }

  const payload = event.data as Partial<ComponentPreviewUpdateStateMessage>
  if (payload.type === COMPONENT_PREVIEW_UPDATE_STATE_EVENT) {
    if (payload.payload?.version !== 1 || payload.payload?.artifactId !== artifactId) {
      return
    }

    previewState.value = normalizeComponentPreviewState(payload.payload.state)
    return
  }

  const canvasPayload = event.data as Partial<ComponentPreviewUpdateCanvasMessage>
  if (canvasPayload.type !== COMPONENT_PREVIEW_UPDATE_CANVAS_EVENT) {
    return
  }
  if (canvasPayload.payload?.version !== 1 || canvasPayload.payload?.artifactId !== artifactId) {
    return
  }

  canvasConfig.value = normalizeComponentPreviewCanvasConfig(canvasPayload.payload.canvas)
  computeScale()
}

/**
 * 解析父窗口来源，用于限制 postMessage 的发送和接收域。
 * @returns 父窗口 origin；无法解析时返回空串
 */
function resolveParentOrigin(): string {
  if (typeof document === 'undefined') {
    return ''
  }
  try {
    return document.referrer ? new URL(document.referrer).origin : ''
  } catch {
    return ''
  }
}

onMounted(() => {
  window.addEventListener('message', handleWindowMessage)
  bindResizeObserver()
  void bootstrapComponentPreview()
})

onUnmounted(() => {
  window.removeEventListener('message', handleWindowMessage)
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<style scoped>
.component-preview-view {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  box-sizing: border-box;
}

.component-preview-viewport {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.component-preview-canvas {
  width: 100%;
  height: 100%;
  overflow: auto;
}

.component-preview-state {
  width: 100%;
  height: 100%;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #475569;
}

.component-preview-state--loading {
  font-size: 16px;
  font-weight: 600;
}

.component-preview-state--error h1 {
  margin: 0 0 12px;
  font-size: 28px;
  color: #b91c1c;
}

.component-preview-state--error p {
  max-width: 720px;
  margin: 0;
  line-height: 1.8;
}
</style>
