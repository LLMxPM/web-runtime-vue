<!--
  组件用途：功能展示-配置UI页面
  展示远程配置、Hash 路由与相对资源路径的运行时能力
-->
<template>
    <DefaultContentPage title="配置运行时展示" subtitle="统一远程配置入口与轻量运行时能力">
        <template #content>
            <div class="space-y-8 p-6">
                <div class="flex items-center mb-4">
                    <Icon name="Settings" :size="24" class="text-primary mr-2" />
                    <h2 class="font-heading text-2xl font-semibold text-primary">运行时配置概览</h2>
                </div>
                <div class="grid grid-cols-2 gap-6">
                    <div class="rounded-lg border border-border-default bg-default p-6 shadow-theme-sm">
                        <div class="mb-4 flex items-center">
                            <Icon name="Globe" :size="20" class="mr-2 text-accent1" />
                            <h3 class="font-heading text-xl font-semibold text-primary">统一远程配置</h3>
                        </div>
                        <p class="font-body text-secondary leading-relaxed">
                            通过 `VITE_CONFIG_BASE_URL` 指向统一配置根地址，运行时按约定文件名加载四个 YAML。
                        </p>
                    </div>

                    <div class="rounded-lg border border-border-default bg-default p-6 shadow-theme-sm">
                        <div class="mb-4 flex items-center">
                            <Icon name="Route" :size="20" class="mr-2 text-accent2" />
                            <h3 class="font-heading text-xl font-semibold text-primary">Hash 路由</h3>
                        </div>
                        <p class="font-body text-secondary leading-relaxed">
                            页面切换使用 `#` 路由，子路径部署时不再依赖 `baseUrl` 或服务端重写规则。
                        </p>
                    </div>

                    <div class="rounded-lg border border-border-default bg-default p-6 shadow-theme-sm">
                        <div class="mb-4 flex items-center">
                            <Icon name="Image" :size="20" class="mr-2 text-accent3" />
                            <h3 class="font-heading text-xl font-semibold text-primary">相对资源路径</h3>
                        </div>
                        <p class="font-body text-secondary leading-relaxed">
                            站内资源默认使用相对路径，也支持直接填写远程绝对 URL，适合 CDN 与远端素材托管。
                        </p>
                    </div>

                    <div class="rounded-lg border border-border-default bg-default p-6 shadow-theme-sm">
                        <div class="mb-4 flex items-center">
                            <Icon name="Shield" :size="20" class="mr-2 text-accent4" />
                            <h3 class="font-heading text-xl font-semibold text-primary">轻量开发态</h3>
                        </div>
                        <p class="font-body text-secondary leading-relaxed">
                            开发模式下不再提供本地 YAML 配置面板与资源管理入口，避免与远程配置源产生状态分叉。
                        </p>
                    </div>
                </div>
            </div>
        </template>
    </DefaultContentPage>
</template>

<script setup lang="ts">
import DefaultContentPage from '@/components/layout/pagecontainer/DefaultContentPage.vue'
import Icon from '@/components/layout/contentcommon/Icon.vue'

defineOptions({
    name: 'ConfigUI'
})
</script>
