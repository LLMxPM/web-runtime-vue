<!--
  文件用途：LaTeX 公式渲染器，负责使用 MathJax 将公式源码排版为 SVG HTML。
-->
<template>
  <section class="latex-viewer" :style="surfaceStyle" v-bind="$attrs">
    <!-- eslint-disable-next-line vue/no-v-html -- MathJax 输出由 renderer 生成，组件只渲染受控 SVG HTML。 -->
    <div v-if="renderedHtml" class="latex-viewer__content" v-html="renderedHtml" />
    <span v-else-if="error" class="latex-viewer__state latex-viewer__state--error">{{ error }}</span>
    <span v-else class="latex-viewer__state">公式内容为空</span>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useViewerSurfaceStyle, type ViewerSurfaceProps } from '@runtime-kit/internal/utils/viewer-style'
import { renderLatexToString, type MathStrictMode } from '@runtime-kit/internal/renderers/latex'

interface Props extends ViewerSurfaceProps {
  /** LaTeX 源码内容 */
  content?: string
  /** 是否使用块级公式模式 */
  displayMode?: boolean
  /** 解析错误时是否抛出异常，保留为兼容旧组件参数 */
  throwOnError?: boolean
  /** 严格模式，保留为兼容旧组件参数 */
  strict?: MathStrictMode
  /** 是否允许受信任命令，保留为兼容旧组件参数 */
  trust?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  width: 'fit-content',
  height: 'auto',
  minHeight: '40px',
  backgroundColor: '#ffffff',
  showBorder: true,
  borderColor: '#e5e7eb',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderRadius: '8px',
  padding: '10px 12px',
  displayMode: false,
  throwOnError: false,
  strict: 'warn',
  trust: false,
})

const surfaceStyle = useViewerSurfaceStyle(props)
const renderedHtml = ref('')
const error = ref('')
let renderVersion = 0

/**
 * 将 unknown 错误统一转为可展示文案。
 *
 * @param reason 捕获到的错误对象
 * @returns 错误消息
 */
function getErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason || '未知错误')
}

/**
 * 使用 MathJax 渲染当前公式内容。
 */
async function renderFormula(): Promise<void> {
  const currentVersion = ++renderVersion
  renderedHtml.value = ''
  error.value = ''

  const source = props.content.trim()
  if (!source) {
    return
  }

  try {
    const html = await renderLatexToString(source, {
      displayMode: props.displayMode,
      throwOnError: props.throwOnError,
      strict: props.strict,
      trust: props.trust,
    })
    if (currentVersion === renderVersion) {
      renderedHtml.value = html
    }
  } catch (reason) {
    if (currentVersion === renderVersion) {
      error.value = `LaTeX 渲染失败：${getErrorMessage(reason)}`
    }
  }
}

watch(
  () => [props.content, props.displayMode, props.throwOnError, props.strict, props.trust],
  () => {
    void renderFormula()
  },
)

onMounted(() => {
  void renderFormula()
})

defineExpose({
  reload: renderFormula,
})
</script>

<style scoped>
.latex-viewer {
  box-sizing: border-box;
  display: flex;
  max-width: 100%;
  margin-inline: auto;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.latex-viewer__content {
  display: flex;
  width: 100%;
  max-width: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.65em;
  color: #334155;
  text-align: center;
}

.latex-viewer__content :deep(mjx-container) {
  align-self: center;
  max-width: 100%;
  margin: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.latex-viewer__content :deep(mjx-container[display='true']) {
  display: block;
  width: 100%;
  text-align: center;
}

.latex-viewer__content :deep(mjx-container > svg) {
  display: block;
  margin-inline: auto;
}

.latex-viewer__state {
  color: #94a3b8;
  font-size: 14px;
}

.latex-viewer__state--error {
  color: #dc2626;
}
</style>
