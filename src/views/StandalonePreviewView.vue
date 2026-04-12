<!--
  文件用途：为编辑器 iframe 提供通用单页预览壳层，按传入设计尺寸等比缩放页面组件。
-->

<template>
  <main class="standalone-preview-view">
    <ViewPreview
      :file-path="filePath"
      :design-width="designWidth"
      :design-height="designHeight"
    />
  </main>
</template>

<script setup lang="ts">
/**
 * 文件用途：承接 runtime 单页预览路由，避免直接渲染页面组件导致 iframe 中只显示局部区域。
 */

import ViewPreview from '@/components/editor/ViewPreview.vue'

withDefaults(defineProps<{
  /** 页面逻辑路径，例如 src/views/foo/bar.vue */
  filePath: string
  /** 设计稿宽度，未传时回退到默认值。 */
  designWidth?: number
  /** 设计稿高度，未传时回退到默认值。 */
  designHeight?: number
}>(), {
  designWidth: 1920,
  designHeight: 1080,
})
</script>

<style scoped>
.standalone-preview-view {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8fafc;
}
</style>
