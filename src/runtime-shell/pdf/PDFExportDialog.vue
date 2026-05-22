<!--
  文件用途：PDF 导出弹窗，负责选择导出方式、导出范围并展示导出或打印进度。
-->

<template>
  <div v-if="isVisible"
    class="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
    role="dialog" aria-modal="true" aria-labelledby="pdf-export-title" @click.self="closeDialog">
    <div
      class="flex max-h-[min(760px,calc(100vh-48px))] w-full max-w-[560px] flex-col overflow-hidden rounded-[10px] bg-white shadow-2xl ring-1 ring-slate-900/10">
      <header class="flex items-center justify-between border-b border-slate-200 px-7 py-5">
        <div class="min-w-0">
          <h3 id="pdf-export-title" class="text-xl font-semibold tracking-tight text-slate-950">
            导出 PDF
          </h3>
          <p class="mt-1 text-sm text-slate-500">
            选择生成方式和页面范围
          </p>
        </div>
        <button type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="isExporting" aria-label="关闭导出弹窗" @click="closeDialog">
          <X :size="20" />
        </button>
      </header>

      <main class="flex-1 overflow-y-auto px-7 py-6">
        <form v-if="!isExporting && !exportResult" class="space-y-6" @submit.prevent="startExport">
          <section class="space-y-3">
            <div class="flex items-center justify-between gap-4">
              <h4 class="text-sm font-semibold text-slate-800">
                生成方式
              </h4>
              <span class="text-xs text-slate-400">默认使用当前导出</span>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <label v-for="option in methodOptions" :key="option.value"
                class="group cursor-pointer rounded-lg border p-4 transition-all hover:border-blue-300 hover:bg-blue-50/40"
                :class="exportMethod === option.value ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500/20' : 'border-slate-200 bg-white'">
                <input v-model="exportMethod" type="radio" :value="option.value" class="sr-only">
                <span class="flex items-start gap-3">
                  <span class="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                    :class="exportMethod === option.value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-700'">
                    <component :is="option.icon" :size="18" />
                  </span>
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold text-slate-900">{{ option.label }}</span>
                    <span class="mt-1 block text-xs leading-5 text-slate-500">{{ option.description }}</span>
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section class="space-y-3">
            <h4 class="text-sm font-semibold text-slate-800">
              导出范围
            </h4>
            <div class="grid grid-cols-2 gap-3">
              <label v-for="option in rangeOptions" :key="option.value"
                class="cursor-pointer rounded-lg border px-4 py-3 transition-all hover:border-blue-300 hover:bg-blue-50/40"
                :class="exportMode === option.value ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/20' : 'border-slate-200 bg-white'">
                <input v-model="exportMode" type="radio" :value="option.value" class="sr-only">
                <span class="flex items-center gap-2 text-sm font-medium"
                  :class="exportMode === option.value ? 'text-blue-700' : 'text-slate-700'">
                  <component :is="option.icon" :size="17" />
                  {{ option.label }}
                </span>
              </label>
            </div>
          </section>

          <section class="space-y-2">
            <label v-if="!isBrowserPrint" for="filename" class="block text-sm font-semibold text-slate-800">
              文件名（可选）
            </label>
            <input v-if="!isBrowserPrint" id="filename" v-model="filename" type="text" :placeholder="filenamePlaceholder"
              class="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100">
            <div v-else
              class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              浏览器打印模式会打开系统打印对话框，文件名由打印对话框决定。
            </div>
          </section>
        </form>

        <div v-else-if="isExporting" class="space-y-6 py-2">
          <div class="text-center">
            <div
              class="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Loader2 class="animate-spin" :size="28" />
            </div>
            <h4 class="text-lg font-semibold text-slate-950">
              {{ exportingTitle }}
            </h4>
            <p class="mt-2 text-sm text-slate-500">
              {{ progressText }}
            </p>
          </div>

          <div class="space-y-2">
            <div class="h-2 overflow-hidden rounded-full bg-slate-100">
              <div class="h-full rounded-full bg-blue-600 transition-all duration-300"
                :style="{ width: `${progress.percentage}%` }"></div>
            </div>
            <div v-if="progress.total > 0" class="flex items-center justify-between text-xs text-slate-500">
              <span>{{ progress.current }} / {{ progress.total }}</span>
              <span v-if="progress.currentPageTitle" class="max-w-[320px] truncate">{{ progress.currentPageTitle
                }}</span>
            </div>
          </div>

          <div class="text-center">
            <button type="button"
              class="rounded-md px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              @click="cancelExport">
              取消导出
            </button>
          </div>
        </div>

        <div v-else-if="exportResult" class="py-4 text-center">
          <div class="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full"
            :class="exportResult.success ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'">
            <CheckCircle2 v-if="exportResult.success" :size="30" />
            <AlertCircle v-else :size="30" />
          </div>

          <h4 class="text-lg font-semibold text-slate-950">
            {{ exportResult.success ? successTitle : '导出失败' }}
          </h4>
          <p class="mx-auto mt-2 max-w-sm text-sm leading-6"
            :class="exportResult.success ? 'text-slate-500' : 'text-red-600'">
            {{ exportResult.success ? successMessage : (exportResult.error || '未知错误') }}
          </p>

          <div v-if="exportResult.success"
            class="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-left text-xs leading-6 text-slate-500">
            <p v-if="exportResult.filename">
              文件名：{{ exportResult.filename }}
            </p>
            <p>页面数：{{ exportResult.pageCount || 0 }}</p>
            <p>耗时：{{ Math.round((exportResult.duration || 0) / 1000) }} 秒</p>
          </div>
        </div>
      </main>

      <footer class="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-7 py-5">
        <button v-if="!isExporting && !exportResult" type="button"
          class="h-11 rounded-lg bg-white px-5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
          @click="closeDialog">
          取消
        </button>
        <button v-if="!isExporting && !exportResult" type="button"
          class="inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          @click="startExport">
          <Printer v-if="isBrowserPrint" :size="17" />
          <FileDown v-else :size="17" />
          {{ primaryActionLabel }}
        </button>
        <button v-if="exportResult" type="button"
          class="inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          @click="resetDialog">
          <RotateCcw :size="17" />
          重新导出
        </button>
        <button v-if="exportResult" type="button"
          class="h-11 rounded-lg bg-white px-5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
          @click="closeDialog">
          关闭
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  CheckCircle2,
  File as FileIcon,
  FileDown,
  FileText,
  Files,
  Loader2,
  Printer,
  RotateCcw,
  X,
} from 'lucide-vue-next'
import { pdfExportService } from '@/core/services/PDFExportService'
import { browserPrintService } from '@/core/services/BrowserPrintService'
import type {
  ExportMethod,
  ExportProgress,
  ExportResult,
} from '@/core/types/pdf-export'

// Props
interface Props {
  visible?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  visible: false
})

// Emits
interface Emits {
  (e: 'update:visible', value: boolean): void
  (e: 'export-start'): void
  (e: 'export-complete', result: ExportResult): void
  (e: 'export-error', error: Error): void
}

const emit = defineEmits<Emits>()

const methodOptions = [
  {
    value: 'canvas-pdf' as ExportMethod,
    label: '截图拼接',
    description: '使用截图生成 PDF 文件',
    icon: FileText,
  },
  {
    value: 'browser-print' as ExportMethod,
    label: '浏览器打印',
    description: '通过打印对话框保存为 PDF',
    icon: Printer,
  },
]

const rangeOptions = [
  {
    value: 'current' as const,
    label: '当前页面',
    icon: FileIcon,
  },
  {
    value: 'all' as const,
    label: '所有页面',
    icon: Files,
  },
]

// 响应式数据
const router = useRouter()
const isVisible = ref(props.visible)
const exportMode = ref<'current' | 'all'>('current')
const exportMethod = ref<ExportMethod>('canvas-pdf')
const filename = ref('')
const isExporting = ref(false)
const exportResult = ref<ExportResult | null>(null)
const progress = ref<ExportProgress>({
  current: 0,
  total: 0,
  percentage: 0,
  currentPageTitle: '',
  currentPageRoute: ''
})

// 计算属性
const isBrowserPrint = computed(() => exportMethod.value === 'browser-print')

const primaryActionLabel = computed(() => {
  return isBrowserPrint.value ? '打开打印' : '开始导出'
})

const filenamePlaceholder = computed(() => {
  return exportMode.value === 'all'
    ? '留空使用项目标题 + 本地时间'
    : '留空使用页面标题 + 本地时间'
})

const exportingTitle = computed(() => {
  return isBrowserPrint.value ? '正在准备打印' : '正在导出 PDF'
})

const progressText = computed(() => {
  if (isBrowserPrint.value) {
    if (exportMode.value === 'current') {
      return '正在准备当前页面打印...'
    }

    if (progress.value.currentPageTitle) {
      return `正在准备打印: ${progress.value.currentPageTitle}`
    }

    return '正在准备打印文档...'
  }

  if (exportMode.value === 'current') {
    return '正在捕获当前页面...'
  }

  if (progress.value.currentPageTitle) {
    return `正在处理: ${progress.value.currentPageTitle}`
  }

  return '正在准备导出...'
})

const successTitle = computed(() => {
  return exportResult.value?.method === 'browser-print' ? '已打开打印对话框' : '导出成功'
})

const successMessage = computed(() => {
  if (!exportResult.value) {
    return ''
  }

  if (exportResult.value.method === 'browser-print') {
    return exportResult.value.message || `已准备 ${exportResult.value.pageCount || 0} 个页面`
  }

  return `已成功导出 ${exportResult.value.pageCount || 0} 个页面`
})

// 监听 props 变化
watch(() => props.visible, (newValue) => {
  isVisible.value = newValue
})

watch(isVisible, (newValue) => {
  emit('update:visible', newValue)
})

/**
 * 关闭对话框。
 */
function closeDialog(): void {
  if (isExporting.value) {
    return
  }

  isVisible.value = false
  resetDialog()
}

/**
 * 重置对话框状态。
 */
function resetDialog(): void {
  exportResult.value = null
  progress.value = {
    current: 0,
    total: 0,
    percentage: 0,
    currentPageTitle: '',
    currentPageRoute: ''
  }
}

/**
 * 开始导出或打开浏览器打印。
 */
async function startExport(): Promise<void> {
  if (isExporting.value) {
    return
  }

  try {
    isExporting.value = true
    exportResult.value = null
    emit('export-start')

    const options = {
      filename: filename.value.trim() || undefined,
      mode: exportMode.value,
      method: exportMethod.value
    }

    let result: ExportResult

    if (isBrowserPrint.value) {
      if (exportMode.value === 'current') {
        result = await browserPrintService.printCurrentPage(options)
      } else {
        result = await browserPrintService.printAllPages(options, (progressData) => {
          progress.value = progressData
        })
      }
    } else {
      if (exportMode.value === 'current') {
        result = await pdfExportService.exportCurrentPage(options)
      } else {
        result = await pdfExportService.exportAllPages(options, (progressData) => {
          progress.value = progressData
        })
      }
    }

    exportResult.value = result
    emit('export-complete', result)
  } catch (error) {
    const errorResult: ExportResult = {
      success: false,
      taskId: '',
      method: exportMethod.value,
      filename: '',
      pageCount: 0,
      duration: 0,
      error: error instanceof Error ? error.message : '导出失败'
    }

    exportResult.value = errorResult
    emit('export-error', error instanceof Error ? error : new Error('导出失败'))
  } finally {
    isExporting.value = false
  }
}

/**
 * 取消当前导出任务。
 */
function cancelExport(): void {
  if (isExporting.value) {
    if (isBrowserPrint.value) {
      browserPrintService.cancelPrint()
    } else {
      pdfExportService.cancelExport()
    }
    isExporting.value = false

    const cancelResult: ExportResult = {
      success: false,
      taskId: '',
      method: exportMethod.value,
      filename: '',
      pageCount: 0,
      duration: 0,
      error: '用户取消导出'
    }

    exportResult.value = cancelResult
  }
}

/**
 * 处理键盘事件。
 * @param event 键盘事件
 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !isExporting.value) {
    closeDialog()
  }
}

onMounted(() => {
  // 设置路由实例
  pdfExportService.setRouter(router)
  browserPrintService.setRouter(router)

  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})

// 暴露给父组件的方法
defineExpose({
  show: () => {
    isVisible.value = true
  },
  hide: () => {
    closeDialog()
  },
  reset: () => {
    resetDialog()
  }
})
</script>
