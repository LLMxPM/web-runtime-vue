<!--
  组件用途：功能展示-页面简单编辑页面
  展示当前页面编辑能力与精简后的开发态说明
-->
<template>
    <DefaultContentPage title="页面简单编辑" subtitle="保留当前页面编辑能力，移除本地资源管理入口">
        <template #content>
            <div class="space-y-8 p-6">
                <div class="flex items-center mb-4">
                    <Icon name="Edit" :size="24" class="text-primary mr-2" />
                    <h2 class="font-heading text-2xl font-semibold text-primary">页面编辑</h2>
                </div>
                <img :src="resolveResourcePath('img/illus/插图/页面编辑.png')" alt="页面编辑"
                    class="rounded-lg shadow-theme-md border border-border-default max-w-full h-auto" />



                <div class="flex items-center mb-4 mt-8">
                    <Icon name="Info" :size="24" class="text-primary mr-2" />
                    <h2 class="font-heading text-2xl font-semibold text-primary">当前策略</h2>
                </div>
                <div class="rounded-lg border border-border-default bg-default p-6 shadow-theme-sm">
                    <ul class="space-y-3">
                        <li class="flex items-start">
                            <Icon name="CheckCircle" :size="18" class="mt-0.5 mr-2 text-accent1" />
                            <span class="font-body text-secondary">开发态保留“编辑当前页面”能力，方便直接修改页面内容与排版。</span>
                        </li>
                        <li class="flex items-start">
                            <Icon name="CheckCircle" :size="18" class="mt-0.5 mr-2 text-accent2" />
                            <span class="font-body text-secondary">本地 YAML 配置面板与资源管理入口已经下线，运行时配置统一改为只读加载。</span>
                        </li>
                        <li class="flex items-start">
                            <Icon name="CheckCircle" :size="18" class="mt-0.5 mr-2 text-accent3" />
                            <span class="font-body text-secondary">页面结构继续通过 `routes.config.yaml` 维护，资源路径建议使用相对路径或远程绝对 URL。</span>
                        </li>
                    </ul>
                </div>
            </div>
        </template>
    </DefaultContentPage>
</template>

<script setup lang="ts">
import DefaultContentPage from '@/components/layout/pagecontainer/DefaultContentPage.vue'
import Icon from '@/components/layout/contentcommon/Icon.vue'
import { resolveResourcePath } from '@/core/utils/path'

defineOptions({
    name: 'SimplePageEdit'
})
</script>
