<!-- 文件用途：演示工作空间共享组件在预览场景中如何消费 props、slots 与 mock 数据。 -->
<template>
  <section class="demo-card" :class="toneClass">
    <header class="demo-card__header">
      <div>
        <p class="demo-card__eyebrow">{{ badgeText }}</p>
        <h2 class="demo-card__title">{{ title }}</h2>
        <p v-if="subtitle" class="demo-card__subtitle">{{ subtitle }}</p>
      </div>
      <div class="demo-card__actions">
        <slot name="actions">
          <button class="demo-card__action-button" type="button">默认操作</button>
        </slot>
      </div>
    </header>

    <div v-if="showDivider" class="demo-card__divider"></div>

    <section class="demo-card__metrics">
      <article v-for="item in stats" :key="item.label" class="demo-card__metric">
        <span class="demo-card__metric-label">{{ item.label }}</span>
        <strong class="demo-card__metric-value">{{ item.value }}</strong>
        <span v-if="item.trend" class="demo-card__metric-trend">{{ item.trend }}</span>
      </article>
    </section>

    <section v-if="$slots.default" class="demo-card__body">
      <slot />
    </section>

    <footer v-if="$slots.footer" class="demo-card__footer">
      <slot name="footer" />
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useComponentPreviewMock } from '@/core/composables/useComponentPreviewMock'

interface MetricItem {
  label: string
  value: string | number
  trend?: string
}

const props = withDefaults(defineProps<{
  title?: string
  subtitle?: string
  badgeText?: string
  tone?: 'primary' | 'success' | 'warning'
  showDivider?: boolean
}>(), {
  title: '季度经营看板',
  subtitle: '',
  badgeText: '业务快照',
  tone: 'primary',
  showDivider: true,
})

const stats = useComponentPreviewMock<MetricItem[]>('stats', [
  { label: '新增客户', value: 0, trend: '0%' },
  { label: '续费率', value: '0%', trend: '0%' },
])

const toneClass = computed(() => ({
  'demo-card--success': props.tone === 'success',
  'demo-card--warning': props.tone === 'warning',
}))
</script>

<style scoped>
.demo-card {
  width: 100%;
  padding: 28px;
  border-radius: 24px;
  background: linear-gradient(135deg, #ffffff 0%, #eff6ff 100%);
  border: 1px solid #dbeafe;
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.08);
  color: #0f172a;
  box-sizing: border-box;
}

.demo-card--success {
  background: linear-gradient(135deg, #ffffff 0%, #ecfdf5 100%);
  border-color: #bbf7d0;
}

.demo-card--warning {
  background: linear-gradient(135deg, #ffffff 0%, #fff7ed 100%);
  border-color: #fed7aa;
}

.demo-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.demo-card__eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
}

.demo-card__title {
  margin: 0;
  font-size: 32px;
  line-height: 1.2;
}

.demo-card__subtitle {
  margin: 10px 0 0;
  font-size: 15px;
  line-height: 1.7;
  color: #475569;
}

.demo-card__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 36px;
}

.demo-card__action-button {
  border: none;
  border-radius: 999px;
  padding: 10px 16px;
  background: #0f172a;
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.demo-card__divider {
  margin: 20px 0 18px;
  height: 1px;
  background: rgba(148, 163, 184, 0.28);
}

.demo-card__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.demo-card__metric {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.demo-card__metric-label {
  font-size: 12px;
  color: #64748b;
}

.demo-card__metric-value {
  font-size: 26px;
  line-height: 1.1;
}

.demo-card__metric-trend {
  font-size: 12px;
  font-weight: 700;
  color: #2563eb;
}

.demo-card__body {
  margin-top: 18px;
  font-size: 15px;
  line-height: 1.8;
  color: #334155;
}

.demo-card__footer {
  margin-top: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: #475569;
}
</style>
