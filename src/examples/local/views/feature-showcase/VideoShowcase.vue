<!--
  文件用途：本地示例页，用于展示 VideoViewer 的视频播放与统一渲染区域参数。
-->
<template>
  <DefaultContentPage title="Video 视频展示" subtitle="展示 VideoViewer 的本地视频渲染能力">
    <template #content>
      <div class="grid grid-cols-[2fr_1fr] gap-6">
        <section class="rounded-lg border border-border bg-background p-4">
          <VideoViewer
            :src="videoUrl"
            :poster="posterUrl"
            :fit="fitMode"
            :controls="controls"
            :autoplay="autoplay"
            :loop="loop"
            :muted="muted"
            preload="auto"
            width="100%"
            height="560px"
            min-height="360px"
            background-color="#020617"
            :show-border="showBorder"
            border-color="#334155"
            border-radius="16px"
          />
        </section>

        <aside class="space-y-6">
          <section class="rounded-lg border border-border bg-background-subtle p-5">
            <div class="mb-4 flex items-center gap-3">
              <Icon name="全屏" class="size-4" color="primary" />
              <h2 class="font-heading text-xl font-semibold text-primary">播放参数</h2>
            </div>

            <div class="space-y-4 text-sm">
              <label class="block space-y-2">
                <span class="font-medium text-secondary">填充方式</span>
                <select v-model="fitMode" class="video-select">
                  <option value="contain">contain</option>
                  <option value="cover">cover</option>
                  <option value="fill">fill</option>
                </select>
              </label>

              <label v-for="item in toggles" :key="item.key" class="flex items-center gap-3">
                <input v-model="item.model.value" type="checkbox" class="h-4 w-4 accent-primary" />
                <span>{{ item.label }}</span>
              </label>
            </div>
          </section>

          <section class="rounded-lg border border-border bg-background-subtle p-5">
            <div class="mb-4 flex items-center gap-3">
              <Icon name="刷新" class="size-4" color="primary" />
              <h2 class="font-heading text-xl font-semibold text-primary">视频状态</h2>
            </div>

            <p class="mb-4 text-sm leading-6 text-secondary">{{ generationStatus }}</p>
            <button type="button" class="regenerate-button" @click="generateCanvasVideo">
              重新生成示例视频
            </button>
          </section>
        </aside>
      </div>
    </template>
  </DefaultContentPage>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import DefaultContentPage from '@runtime-kit/public/components/page/templates/DefaultContentPage.vue'
import Icon from '@runtime-kit/public/components/primitives/Icon.vue'
import VideoViewer from '@runtime-kit/internal/renderers/VideoViewer.vue'

type ObjectFitMode = 'contain' | 'cover' | 'fill'

interface ToggleOption {
  key: string
  label: string
  model: Ref<boolean>
}

defineOptions({
  name: 'VideoShowcase',
})

const videoUrl = ref('')
const generationStatus = ref('正在生成本地示例视频...')
const fitMode = ref<ObjectFitMode>('contain')
const controls = ref(true)
const autoplay = ref(true)
const loop = ref(true)
const muted = ref(true)
const showBorder = ref(true)

const toggles: ToggleOption[] = [
  { key: 'controls', label: '显示播放控件', model: controls },
  { key: 'autoplay', label: '自动播放', model: autoplay },
  { key: 'loop', label: '循环播放', model: loop },
  { key: 'muted', label: '静音播放', model: muted },
  { key: 'border', label: '显示边框', model: showBorder },
]

/**
 * 用内联 SVG 生成视频封面，避免示例页依赖额外图片资源。
 * @returns data URL 格式封面图
 */
const posterUrl = computed(() => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="55%" stop-color="#155e75"/>
          <stop offset="100%" stop-color="#f97316"/>
        </linearGradient>
      </defs>
      <rect width="960" height="540" fill="url(#bg)"/>
      <circle cx="480" cy="270" r="74" fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.65)" stroke-width="4"/>
      <path d="M462 226 L462 314 L536 270 Z" fill="white"/>
      <text x="48" y="74" fill="white" font-family="Arial, sans-serif" font-size="34" font-weight="700">Runtime Video 示例</text>
    </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
})

/**
 * 选择当前浏览器支持的录制格式。
 * @returns MediaRecorder MIME 类型
 */
function resolveRecorderMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || ''
}

/**
 * 绘制示例视频的单帧画面。
 * @param context Canvas 2D 上下文
 * @param width 画布宽度
 * @param height 画布高度
 * @param progress 当前播放进度，范围 0-1
 */
function drawFrame(context: CanvasRenderingContext2D, width: number, height: number, progress: number): void {
  const hue = Math.round(200 + progress * 80)
  const orbitX = width * (0.22 + 0.56 * progress)
  const waveY = height * (0.52 + Math.sin(progress * Math.PI * 2) * 0.18)

  context.clearRect(0, 0, width, height)
  const gradient = context.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, `hsl(${hue}, 74%, 18%)`)
  gradient.addColorStop(0.58, '#0f766e')
  gradient.addColorStop(1, '#f97316')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)

  context.fillStyle = 'rgba(255,255,255,0.14)'
  for (let index = 0; index < 7; index += 1) {
    const x = width * (0.12 + index * 0.14)
    const y = height * (0.22 + Math.sin(progress * Math.PI * 2 + index) * 0.08)
    context.beginPath()
    context.arc(x, y, 26 + index * 3, 0, Math.PI * 2)
    context.fill()
  }

  context.fillStyle = 'rgba(255,255,255,0.92)'
  context.beginPath()
  context.arc(orbitX, waveY, 44, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = '#ffffff'
  context.font = '700 42px Arial, sans-serif'
  context.fillText('VideoViewer', 54, 88)
  context.font = '400 24px Arial, sans-serif'
  context.fillText('Canvas + MediaRecorder 本地生成示例视频', 54, 130)

  context.fillStyle = 'rgba(255,255,255,0.34)'
  context.fillRect(54, height - 74, width - 108, 12)
  context.fillStyle = '#ffffff'
  context.fillRect(54, height - 74, (width - 108) * progress, 12)
}

/**
 * 通过 Canvas 和 MediaRecorder 在浏览器中生成一段本地 WebM 视频。
 */
async function generateCanvasVideo(): Promise<void> {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
    videoUrl.value = ''
  }

  generationStatus.value = '正在生成本地示例视频...'

  if (typeof MediaRecorder === 'undefined') {
    generationStatus.value = '当前浏览器不支持 MediaRecorder，无法生成本地视频。'
    return
  }

  const canvas = document.createElement('canvas')
  canvas.width = 960
  canvas.height = 540
  const context = canvas.getContext('2d')
  if (!context) {
    generationStatus.value = 'Canvas 初始化失败，无法生成视频。'
    return
  }

  const stream = canvas.captureStream(30)
  const mimeType = resolveRecorderMimeType()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: BlobPart[] = []

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve()
    recorder.onerror = () => reject(new Error('视频录制失败'))
  })

  recorder.start()

  const duration = 3200
  const startedAt = performance.now()
  await new Promise<void>((resolve) => {
    const render = (now: number) => {
      const elapsed = now - startedAt
      const progress = Math.min(1, elapsed / duration)
      drawFrame(context, canvas.width, canvas.height, progress)
      if (progress < 1) {
        requestAnimationFrame(render)
        return
      }
      resolve()
    }
    requestAnimationFrame(render)
  })

  recorder.stop()
  await stopped
  stream.getTracks().forEach(track => track.stop())

  const blob = new Blob(chunks, { type: mimeType || 'video/webm' })
  videoUrl.value = URL.createObjectURL(blob)
  generationStatus.value = '本地示例视频已生成，可直接测试播放、循环、填充和边框参数。'
}

onMounted(() => {
  generateCanvasVideo()
})

onBeforeUnmount(() => {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
  }
})
</script>

<style scoped>
.video-select {
  width: 100%;
  border-radius: 8px;
  border: 1px solid var(--tw-color-border-default);
  background: var(--tw-color-bg-default);
  padding: 10px 12px;
  color: var(--tw-color-text-primary);
  outline: none;
}

.video-select:focus {
  border-color: var(--tw-color-text-primary);
}

.regenerate-button {
  width: 100%;
  border-radius: 8px;
  background: var(--tw-color-text-primary);
  padding: 10px 14px;
  color: var(--tw-color-bg-default);
  font-weight: 700;
}
</style>
