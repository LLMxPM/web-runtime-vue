<!--
  文件用途：AssetImage — 基于 manifest 资源名称渲染 Backend 托管图片。
  传入 name（asset.name）即可，workspaceId 和路径解析由内部自动完成。
-->
<template>
  <ImageViewer
    :src="src"
    :alt="alt"
    :class="props.class"
    :style="props.style"
    :show-fallback-placeholder="showFallbackPlaceholder"
    v-bind="$attrs"
  >
    <template #fallback>
      <slot v-if="$slots.fallback" name="fallback" />
      <span v-else-if="showFallbackPlaceholder" :class="props.class" :style="props.style" class="asset-image--placeholder"
        aria-hidden="true" />
    </template>
  </ImageViewer>
</template>

<script setup lang="ts">
/**
 * AssetImage
 *
 * 使用示例：
 *   <AssetImage name="background" alt="背景图" class="w-full" />
 *
 * Props:
 *   name     — 资源的逻辑名 `asset.name`（必传）
 *   alt      — img 的 alt 属性
 *   fallback — 未命中 manifest 时的兜底图 URL（可选）
 *   class    — 传递给 img 的 class
 *   style    — 传递给 img 的 style
 *   showFallbackPlaceholder — 未解析时是否渲染占位 span，默认 true
 *
 * 关于 name：
 *   manifest.assets 中的 key 为资源逻辑名 `asset.name`，
 *   例：上传 "background.png" 后，默认 name 为 "background"。
 */
import { useAssetSrc } from '@runtime-kit/public/composables/assets/useAsset'
import ImageViewer from '@runtime-kit/internal/renderers/ImageViewer.vue'

interface Props {
  /** 资源的逻辑名 `asset.name` */
  name: string
  /** img alt 属性 */
  alt?: string
  /** 未命中 manifest 时的兜底图 URL */
  fallback?: string
  /** 传给 img 的 class */
  class?: string | string[] | Record<string, boolean>
  /** 传给 img 的 style */
  style?: string | Record<string, string>
  /** 解析失败时是否渲染占位 span，默认 true */
  showFallbackPlaceholder?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  alt: '',
  fallback: '',
  showFallbackPlaceholder: true,
})

const src = useAssetSrc(() => props.name, props.fallback)
</script>

<style scoped>
.asset-image--placeholder {
  display: block;
  background-color: #f1f5f9;
  border-radius: 4px;
}
</style>
