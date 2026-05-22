<!--
  文件用途：AssetVideo — 基于 manifest 资源名称渲染 Backend 托管视频。
-->
<template>
  <VideoViewer :src="src" :poster="posterSrc" v-bind="$attrs">
    <template v-if="$slots.fallback" #fallback>
      <slot name="fallback" />
    </template>
  </VideoViewer>
</template>

<script setup lang="ts">
/**
 * AssetVideo
 *
 * 使用示例：
 *   <AssetVideo name="demo-video" controls />
 *
 * Props:
 *   name           — 视频资源的逻辑名 `asset.name`（必传）
 *   fallback       — 未命中 manifest 时的视频兜底 URL（可选）
 *   poster         — 视频封面兜底 URL（可选）
 *   posterName     — 视频封面资源的逻辑名 `asset.name`（可选）
 *   posterFallback — 未命中 posterName 时的封面兜底 URL（可选）
 */
import { useAssetSrc } from '@runtime-kit/public/composables/assets/useAsset'
import VideoViewer from '@runtime-kit/internal/renderers/VideoViewer.vue'

interface Props {
  /** 视频资源的逻辑名 `asset.name` */
  name: string
  /** 未命中 manifest 时的视频兜底 URL */
  fallback?: string
  /** 视频封面兜底 URL */
  poster?: string
  /** 视频封面资源的逻辑名 `asset.name` */
  posterName?: string
  /** 未命中 posterName 时的封面兜底 URL */
  posterFallback?: string
}

const props = withDefaults(defineProps<Props>(), {
  fallback: '',
  poster: '',
  posterName: '',
  posterFallback: '',
})

const src = useAssetSrc(() => props.name, props.fallback)
const posterSrc = useAssetSrc(() => props.posterName, props.poster || props.posterFallback)
</script>
