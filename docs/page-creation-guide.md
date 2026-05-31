# 页面添加指南

本文档说明在 Runtime 中新增页面时，页面源码应如何使用 Runtime Kit。当前原则是：Runtime Kit 只提供 Backend/Agent 无法稳定直接实现的运行时能力，不提供通用内容块、布局辅助组件或默认页面模板。

## 1. 标准流程

1. 在工作空间源码的 `src/views` 下新增页面文件。Runtime 仓库自带演示页面放在 `src/examples/local/views`。
2. 页面根部使用页面画布能力，建议导入 `DefaultContainer`。
3. 页面内容结构、卡片、网格、页头页脚、目录样式、分页样式由 Backend/Agent 直接生成。
4. 根据资源元数据显式选择资源组件，或使用资源 composable 解析 URL。
5. 在 `routes.config.yaml` 中添加路由。
6. 通过页面预览或项目预览验证样式、资源和导航。

## 2. 页面根容器

`DefaultContainer` 是页面画布能力，不是默认内容模板。它只负责读取 Runtime 页面尺寸、建立真实画布宽高、提供定位上下文并裁剪溢出内容。

```vue
<script setup lang="ts">
import DefaultContainer from '@runtime-kit/public/components/page/layout/DefaultContainer.v1.vue'
</script>

<template>
  <DefaultContainer>
    <main class="relative h-full">
      <section class="absolute inset-0 p-16">
        <!-- 页面结构和样式由 Backend/Agent 生成 -->
      </section>
    </main>
  </DefaultContainer>
</template>
```

不要把 `DefaultContainer` 当作页头、页脚、封面或内容页模板；这些结构应直接写在页面源码里。

## 3. 页面尺寸

项目配置中的 `app.page.width` / `app.page.height` 是真实创作画布尺寸，页面源码坐标、`px`、`rem` 和 Tailwind arbitrary values 都按这个画布解释。Runtime 外壳可能为了预览区、全屏区、缩略图或 iframe 适配而等比缩放画布，但该缩放不改变页面源码中的 CSS 坐标，也不参与字号或间距计算。

需要在自定义组件中读取页面尺寸时，使用 `usePageSize`。

```vue
<script setup lang="ts">
import { usePageSize } from '@runtime-kit/public/composables/page/usePageSize.v1'

const { width, height, aspectRatio, pageStyle } = usePageSize()
</script>
```

`usePageSize` 只提供 Runtime 当前页面宽高和标准画布样式，不处理预览缩放、背景、网格或内容块。

非响应式场景可以使用 `buildPageCanvasStyle`：

```ts
import { buildPageCanvasStyle } from '@runtime-kit/public/composables/page/buildPageCanvasStyle.v1'

const style = buildPageCanvasStyle({ width: 1600, height: 900 })
```

## 4. 页码、目录和导航

Runtime Kit 不再推荐公开 `Pagination`、`TableOfContents` 这类 UI 组件。需要页码、目录或跳转能力时，使用 composable 获取数据，由页面源码自行渲染 UI。

### 当前页上下文

```vue
<script setup lang="ts">
import { useCurrentPage } from '@runtime-kit/public/composables/page/useCurrentPage.v1'

const { currentPage, totalPages, title } = useCurrentPage()
</script>

<template>
  <footer class="absolute bottom-8 right-12 text-sm text-secondary">
    {{ currentPage }} / {{ totalPages }}
  </footer>
</template>
```

### 路由目录

```vue
<script setup lang="ts">
import { useRouteCatalog } from '@runtime-kit/public/composables/page/useRouteCatalog.v1'

const { catalogItems } = useRouteCatalog()
</script>

<template>
  <ol class="space-y-4">
    <li v-for="item in catalogItems" :key="item.id" class="flex justify-between">
      <span>{{ item.title }}</span>
      <span>{{ item.pageNumber }}</span>
    </li>
  </ol>
</template>
```

目录的列数、字号、连接线、章节编号样式都由 Backend/Agent 在页面源码中决定。

### 页间导航

```vue
<script setup lang="ts">
import { usePageNavigation } from '@runtime-kit/public/composables/page/usePageNavigation.v1'

const { canGoNext, canGoPrevious, goToNextPage, goToPreviousPage } = usePageNavigation()
</script>
```

导航按钮、快捷键和手势不是 Runtime Kit 公开能力的一部分。

## 5. 资源使用

资源使用应按 `asset_metadata.render_type` 显式选择组件。

```vue
<script setup lang="ts">
import AssetImage from '@runtime-kit/public/components/assets/AssetImage.v1.vue'
import AssetChart from '@runtime-kit/public/components/assets/AssetChart.v1.vue'
</script>

<template>
  <AssetImage name="product-hero" alt="产品主图" class="w-full h-64 min-h-40 rounded-lg border border-border bg-transparent p-0 overflow-hidden" />
  <AssetChart name="sales-chart" class="w-full h-96 min-h-60 rounded-lg border border-border bg-transparent p-0 overflow-hidden" />
</template>
```

资源组件的容器样式只通过 `class` 配置。使用完整静态 Tailwind 类写宽高、最小高度、圆角、边框、内边距、背景和裁剪，例如 `w-full h-96 min-h-60 rounded-lg border border-border bg-transparent p-0 overflow-hidden`；公式颜色和字号使用 `text-*` 类，例如 `text-primary text-5xl`。

支持的资源能力：

- `AssetImage`：`render_type=image`
- `AssetVideo`：`render_type=video`
- `AssetDrawio`：`render_type=drawio`
- `AssetMermaid`：`render_type=mermaid`
- `AssetChart`：`render_type=chart`
- `AssetFormula`：`render_type=formula`
- `useAssetSrc` / `useAssetBackground`
- `resolveResourcePath`

不要使用 `AssetRenderer`，也不要引用 `@runtime-kit/internal/renderers/*`。

## 6. 图标和颜色

图标依赖 Runtime 图标配置、资源解析和 SVG inline 能力，因此保留为 Runtime Kit 能力。

```vue
<script setup lang="ts">
import Icon from '@runtime-kit/public/components/primitives/Icon.v1.vue'
</script>

<template>
  <Icon name="home" class="size-8" color="primary" />
</template>
```

自定义 SVG、连线或图表颜色需要解析 Runtime 主题色时，使用 `resolveColor`。

```ts
import { resolveColor } from '@runtime-kit/public/utils/colors.v1'

const color = resolveColor('accent1-300')
```

`resolveColor` 只负责颜色表达式解析，不代表 Runtime Kit 提供通用样式系统。

## 7. 高级 DOM 能力

`Connector` 用于在真实 DOM 元素之间绘制连线，适合流程图、架构图和关系图。

```vue
<script setup lang="ts">
import Connector from '@runtime-kit/public/components/primitives/Connector.v1.vue'
</script>

<template>
  <div class="relative h-full">
    <div id="node-a">A</div>
    <div id="node-b">B</div>
    <Connector from="#node-a" to="#node-b" arrow="end" />
  </div>
</template>
```

该能力依赖元素挂载、尺寸和定位上下文，不进入 Agent 默认推荐流，应在页面预览或项目预览中验证。

## 8. 禁止事项

- 不要使用旧路径 `@runtime-kit/components/...`。
- 不要引用 `@runtime-kit/internal/...`。
- 不要使用未带 `.vN` 的 `@runtime-kit/public/...` 路径。
- 不要把 Runtime Kit 当作通用 UI 组件库。
- 不要要求 Runtime Kit 提供通用内容块、卡片、布局辅助、封面模板或内容页模板。
- 不要使用 `AssetRenderer`。
- 不要在 CSS 中硬编码资源 `url('/...')`，资源路径必须经过 Runtime 解析。

## 9. 相关文档

- [Runtime Kit 能力说明](./runtime-kit-capabilities.md)
- [资源引用规范](./integration/asset-usage-guide.md)
- [路由配置指南](./routes-config-guide.md)
- [图标系统指南](./icon-system-guide.md)
