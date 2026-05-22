<!--
  文件用途：提供工作空间组件的纯沙箱预览宿主页，负责读取后端下发的 previewSchema、接收父窗口状态更新并按单层页面舞台渲染目标组件。
-->
<template>
  <main class="component-preview-view">
    <section class="component-preview-page" :style="previewContentStyles">
      <div v-if="loading" class="component-preview-state component-preview-state--loading">
        正在加载组件预览...
      </div>
      <div v-else-if="errorMessage" class="component-preview-state component-preview-state--error">
        <h1>组件预览启动失败</h1>
        <p>{{ errorMessage }}</p>
      </div>
      <div v-else class="component-preview-placement" :style="placementContainerStyle">
        <div class="component-preview-placement__frame" :style="placementFrameStyle">
          <PreviewContentRenderer
            v-if="componentDefinition"
            :component-definition="componentDefinition"
            :state="previewState"
          />
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, readonly, ref, shallowRef } from 'vue'

import { COMPONENT_PREVIEW_MOCKS_KEY } from '@/core/composables/useComponentPreviewMock'
import {
  COMPONENT_PREVIEW_ERROR_EVENT,
  COMPONENT_PREVIEW_READY_EVENT,
  COMPONENT_PREVIEW_UPDATE_PLACEMENT_EVENT,
  COMPONENT_PREVIEW_UPDATE_STATE_EVENT,
  buildInitialComponentPreviewState,
  clonePreviewValue,
  normalizeComponentPreviewSchema,
  normalizeComponentPreviewState,
  type ComponentPreviewErrorMessage,
  type ComponentPreviewReadyMessage,
  type ComponentPreviewState,
  type ComponentPreviewUpdatePlacementMessage,
  type ComponentPreviewUpdateStateMessage,
} from '@/core/shared/component-preview'
import type { ComponentPreviewSchema, RuntimeComponentPreviewPlacementOptions } from '@/core/shared/runtime-preview'
import { buildPageSpacingScaleStyles } from '@/core/utils/page-scale'
import { getRuntimePreloadedConfig, getRuntimePreviewContext } from '@/core/utils/path'
import { importPreviewModule } from '@/core/utils/preview-module'
import {
  buildPlacementContainerStyle,
  buildPlacementFrameStyle,
  normalizeComponentPreviewPlacement,
} from './placement'
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
const placementOptions = ref<Required<RuntimeComponentPreviewPlacementOptions>>(
  normalizeComponentPreviewPlacement(componentPreviewConfig.value?.placement),
)
const previewContentStyles = computed(() => buildPageSpacingScaleStyles())
const placementContainerStyle = computed(() => buildPlacementContainerStyle(placementOptions.value))
const placementFrameStyle = computed(() => buildPlacementFrameStyle(placementOptions.value))

/**
 * 加载组件模块、读取后端下发 schema 并向父窗口回传 ready 事件。
 */
async function bootstrapComponentPreview(): Promise<void> {
  const previewConfig = componentPreviewConfig.value
  const artifactId = previewContext.value?.artifactId
  if (!previewConfig || !previewConfig.component_import_path || !artifactId) {
    const message = '缺少组件预览上下文或目标组件路径。'
    errorMessage.value = message
    notifyParentError(message)
    loading.value = false
    return
  }

  try {
    loading.value = true
    placementOptions.value = normalizeComponentPreviewPlacement(previewConfig.placement)
    const importedModule = await importPreviewModule(previewConfig.component_import_path)
    componentDefinition.value = importedModule?.default || importedModule
    previewSchema.value = normalizeComponentPreviewSchema(previewConfig.schema)
    previewState.value = buildInitialComponentPreviewState(previewSchema.value)
    await nextTick()
    notifyParentReady()
  } catch (error) {
    const message = resolvePreviewErrorMessage(error)
    errorMessage.value = message
    notifyParentError(message)
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
        code: previewConfig.runtime_kit_component_name || previewConfig.component_code || previewConfig.component_import_path,
        versionNo: previewConfig.component_version_no,
        displayName: previewConfig.display_name
          || previewConfig.runtime_kit_component_name
          || previewConfig.component_code
          || previewConfig.component_import_path,
        source: previewConfig.component_source,
        runtimeKitComponentName: previewConfig.runtime_kit_component_name,
        runtimeKitManifestVersion: previewConfig.runtime_kit_manifest_version,
      },
    },
  }
  // 编辑器开发环境常通过不同 origin 加载预览 iframe，且 iframe 配置了 same-origin referrer policy，
  // 此时子窗口无法通过 document.referrer 推断父窗口 origin。这里退回 "*"，由父窗口继续按 event.origin
  // 校验消息来源，避免 previewSchema ready 事件被静默丢弃。
  window.parent.postMessage(readyMessage, parentOrigin || '*')
}

/**
 * 向父窗口发送组件预览失败事件，避免 Editor 参数栏长期停留在读取 schema 状态。
 * @param message 预览启动失败原因
 */
function notifyParentError(message: string): void {
  const artifactId = previewContext.value?.artifactId
  if (!artifactId || typeof window === 'undefined' || !window.parent) {
    return
  }

  const errorPayload: ComponentPreviewErrorMessage = {
    type: COMPONENT_PREVIEW_ERROR_EVENT,
    payload: {
      version: 1,
      artifactId,
      message,
    },
  }
  window.parent.postMessage(errorPayload, parentOrigin || '*')
}

/**
 * 归一化动态导入或渲染启动阶段抛出的错误信息。
 * @param error 原始错误
 * @returns 用户可读的错误摘要
 */
function resolvePreviewErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '未知组件预览错误。'
}

/**
 * 监听父窗口发来的预览状态或占位更新消息。
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

  const statePayload = event.data as Partial<ComponentPreviewUpdateStateMessage>
  if (statePayload.type === COMPONENT_PREVIEW_UPDATE_STATE_EVENT) {
    if (statePayload.payload?.version !== 1 || statePayload.payload?.artifactId !== artifactId) {
      return
    }

    previewState.value = normalizeComponentPreviewState(statePayload.payload.state)
    return
  }

  const placementPayload = event.data as Partial<ComponentPreviewUpdatePlacementMessage>
  if (placementPayload.type !== COMPONENT_PREVIEW_UPDATE_PLACEMENT_EVENT) {
    return
  }
  if (placementPayload.payload?.version !== 1 || placementPayload.payload?.artifactId !== artifactId) {
    return
  }

  placementOptions.value = normalizeComponentPreviewPlacement(placementPayload.payload.placement)
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
  void bootstrapComponentPreview()
})

onUnmounted(() => {
  window.removeEventListener('message', handleWindowMessage)
})
</script>

<style scoped>
.component-preview-view {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #ffffff;
}

.component-preview-page {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: #ffffff;
}

.component-preview-placement {
  min-width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
}

.component-preview-placement__frame {
  box-sizing: border-box;
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
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
