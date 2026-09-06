<!--
  文件用途：复用演讲者模式平铺布局，供演讲者控制台和卡片模式展示页面卡片。
-->

<template>
  <section class="presenter-console__grid" :style="gridStyles">
    <button
      v-for="page in pages"
      :key="page.path"
      class="presenter-console__tile"
      :class="{ 'presenter-console__tile--active': page.path === currentPath }"
      type="button"
      @click="handleNavigate(page.path)"
    >
      <div class="presenter-console__tile-preview">
        <div class="presenter-console__preview-shell">
          <div class="presenter-console__preview-content" inert aria-hidden="true">
            <ViewPreview :file-path="page.componentPath" />
          </div>
          <div class="presenter-console__preview-shield" aria-hidden="true"></div>
        </div>
      </div>
      <div class="presenter-console__tile-caption">
        <span>{{ page.pageNumber }}</span>
        <strong>{{ page.title }}</strong>
      </div>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import ViewPreview from '@/runtime-shell/preview/ViewPreview.vue'
import type { PresenterPage } from '@/runtime-shell/presenter/usePresenterController'

interface Props {
  pages: PresenterPage[]
  currentPath: string
  tileSize: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  navigate: [path: string]
}>()

const gridStyles = computed(() => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(${props.tileSize}px, 1fr))`,
}))

/**
 * 处理页面卡片点击，交由使用方决定导航方式。
 * @param path 页面路由路径
 */
function handleNavigate(path: string): void {
  emit('navigate', path)
}
</script>

<style>
.presenter-console__preview-shell,
.presenter-console__preview-content {
  position: relative;
  width: 100%;
  height: 100%;
}

.presenter-console__preview-content {
  pointer-events: none;
}

.presenter-console__preview-shield {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: transparent;
  cursor: inherit;
}

.presenter-console__grid {
  display: grid;
  gap: 1rem;
  align-items: start;
  max-height: 100%;
  overflow: auto;
  padding: 0.25rem;
}

.presenter-console__tile {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 0.75rem;
  background: white;
  text-align: left;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
  cursor: pointer;
}

.presenter-console__tile--active {
  border-color: #4f46e5;
  box-shadow: 0 14px 28px rgba(79, 70, 229, 0.2);
}

.presenter-console__tile-preview {
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #f8fafc;
}

.presenter-console__tile-caption {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.625rem 0.75rem;
  color: #334155;
  font-size: 0.75rem;
}

.presenter-console__tile-caption strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
