<!--
  文件用途：AssetChart — 基于 manifest 资源名称加载并渲染 ECharts option 配置。
-->
<template>
  <EchartsViewer :content="content" v-bind="$attrs" />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAssetSrc } from '@runtime-kit/public/composables/assets/useAsset'
import EchartsViewer from '@runtime-kit/internal/renderers/EchartsViewer.vue'

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
const content = ref('')

watch(src, async (nextSrc) => {
  content.value = ''
  if (!nextSrc) return
  try {
    const response = await fetch(nextSrc)
    if (!response.ok) {
      content.value = ''
      return
    }
    content.value = await response.text()
  } catch {
    content.value = ''
  }
}, { immediate: true })
</script>
