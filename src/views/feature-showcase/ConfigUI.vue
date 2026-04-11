<!--
  文件用途：功能展示页，说明只读预览 Runtime 的配置注入、鉴权边界与资源解析方式。
-->
<template>
    <DefaultContentPage title="配置运行时展示" subtitle="预加载配置包、JWS 上下文与发布产物驱动的只读 Runtime">
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
                            <h3 class="font-heading text-xl font-semibold text-primary">预加载配置包</h3>
                        </div>
                        <p class="font-body text-secondary leading-relaxed">
                            Backend 在预览首屏将标准化配置包注入 `window.__RUNTIME_PRELOADED_CONFIG__`，Runtime 优先读取该对象，而不是浏览器直接拉取任意 YAML。
                        </p>
                    </div>

                    <div class="rounded-lg border border-border-default bg-default p-6 shadow-theme-sm">
                        <div class="mb-4 flex items-center">
                            <Icon name="Shield" :size="20" class="mr-2 text-accent2" />
                            <h3 class="font-heading text-xl font-semibold text-primary">JWS 预览上下文</h3>
                        </div>
                        <p class="font-body text-secondary leading-relaxed">
                            Browser 访问公开预览地址时，由 Backend 完成用户态校验并向 Runtime 代理注入 `x-runtime-preview-context`，Runtime 通过 JWKS 离线验签。
                        </p>
                    </div>

                    <div class="rounded-lg border border-border-default bg-default p-6 shadow-theme-sm">
                        <div class="mb-4 flex items-center">
                            <Icon name="Image" :size="20" class="mr-2 text-accent3" />
                            <h3 class="font-heading text-xl font-semibold text-primary">发布产物资源映射</h3>
                        </div>
                        <p class="font-body text-secondary leading-relaxed">
                            资源路径会优先命中 manifest 的白名单映射，其次再拼接 `asset_base_url`，从而确保不同租户、项目和发布版本之间不会串资源。
                        </p>
                    </div>

                    <div class="rounded-lg border border-border-default bg-default p-6 shadow-theme-sm">
                        <div class="mb-4 flex items-center">
                            <Icon name="Code" :size="20" class="mr-2 text-accent4" />
                            <h3 class="font-heading text-xl font-semibold text-primary">远程虚拟模块</h3>
                        </div>
                        <p class="font-body text-secondary leading-relaxed">
                            项目页面源码通过发布产物白名单按需拉取；Runtime 仅保留本地壳层、布局与公共组件，本地编辑器和浏览器写文件能力已经移除。
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
