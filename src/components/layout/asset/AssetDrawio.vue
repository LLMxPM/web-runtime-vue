<!--
  文件用途：AssetDrawio — 基于 manifest 资源名称渲染 Backend 托管的 Draw.io 图表。
  传入 name（asset.name）即可，workspaceId 和路径解析由内部自动完成。
-->
<template>
  <DrawioViewer v-if="src" :src="src" v-bind="$attrs" />
</template>

<script setup lang="ts">
/**
 * AssetDrawio
 *
 * 使用示例：
 *   <AssetDrawio name="architecture" />
 *
 * Props:
 *   name     — 资源的逻辑名 `asset.name`（必传）
 *   fallback — 未命中 manifest 时的兜底 URL（可选）
 */
import { useAssetSrc } from '@/core/composables/useAsset'
import DrawioViewer from '@/components/common/DrawioViewer.vue'

interface Props {
  /** 资源的逻辑名 `asset.name` */
  name: string
  /** 未命中 manifest 时的兜底 URL */
  fallback?: string
}

const props = withDefaults(defineProps<Props>(), {
  fallback: '',
})

const src = useAssetSrc(() => props.name, props.fallback)
</script>
