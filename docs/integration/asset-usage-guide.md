# Vue 页面资源引用规范

本文档适用于 Runtime 中运行的 `.vue` 页面和工作空间组件。资源能力的核心原则是：Backend/Agent 根据资源元数据显式选择组件，Runtime 负责在浏览器端解析资源 URL 和渲染特殊格式。

## 1. 职责边界

- Backend/Agent 负责决定页面结构、资源摆放、标题、说明、卡片、网格和样式。
- Runtime Kit 负责解析 `asset.name` 到可访问 URL，并渲染 Draw.io、Mermaid、ECharts、LaTeX、视频等需要浏览器运行时的资源。
- 不再使用 `AssetRenderer` 聚合入口。每种资源类型使用显式组件。
- 不要引用 `@runtime-kit/internal/renderers/*`，内部渲染器只供 Runtime Kit 包装组件使用。

## 2. 选择规则

Backend 创建 artifact 时应在资源元数据中提供 `asset_metadata[name].render_type`。Agent 生成源码时按下表选择：

| `render_type` | 推荐能力 | 说明 |
| --- | --- | --- |
| `image` | `AssetImage` | 图片资源 |
| `video` | `AssetVideo` | 视频资源，可选封面 |
| `drawio` | `AssetDrawio` | Draw.io XML 图表 |
| `mermaid` | `AssetMermaid` | Mermaid 文本图表 |
| `chart` | `AssetChart` | ECharts option JSON |
| `formula` | `AssetFormula` | LaTeX 公式文本 |

如果需要自定义 DOM 或 CSS 结构，使用 `useAssetSrc`、`useAssetBackground`、`useAssetFontFamily` 或 `resolveResourcePath` 取得运行时资源引用，再由页面源码自行组织样式。

## 3. 显式资源组件

### AssetImage

适用于 `render_type=image`。

```vue
<script setup lang="ts">
import AssetImage from '@runtime-kit/public/components/assets/AssetImage.vue'
</script>

<template>
  <AssetImage name="product-hero" alt="产品主图" class="w-full rounded-lg" />
</template>
```

常用输入：

- `name`：资源逻辑名，必填。
- `alt`：图片替代文本。
- `fallback`：资源未命中时使用的兜底 URL。
- `showFallbackPlaceholder`：解析失败时是否显示占位。

失败表现：资源名为空或未命中时，使用 `fallback`；没有 fallback 时显示占位或 fallback slot。

不要用于：非图片资源、复杂图片说明布局、普通卡片结构。

### AssetVideo

适用于 `render_type=video`。

```vue
<script setup lang="ts">
import AssetVideo from '@runtime-kit/public/components/assets/AssetVideo.vue'
</script>

<template>
  <AssetVideo name="demo-video" poster-name="demo-poster" controls height="360px" />
</template>
```

常用输入：

- `name`：视频资源逻辑名，必填。
- `fallback`：视频资源兜底 URL。
- `posterName`：封面资源逻辑名。
- `poster` / `posterFallback`：普通封面 URL 或封面兜底 URL。
- 其他 video/viewer 属性可透传。

失败表现：视频 URL 解析为空时由内部视频渲染器显示 fallback slot 或空状态。

不要用于：视频标题、字幕说明、播放区域外的布局。

### AssetDrawio

适用于 `render_type=drawio`。

```vue
<script setup lang="ts">
import AssetDrawio from '@runtime-kit/public/components/assets/AssetDrawio.vue'
</script>

<template>
  <AssetDrawio name="architecture" height="420px" />
</template>
```

常用输入：

- `name`：Draw.io XML 资源逻辑名。
- `fallback`：未命中时的兜底 URL。
- 尺寸和表面样式属性可透传给内部 viewer。

失败表现：资源 URL 为空时不渲染图表；XML 解析失败由内部渲染器展示失败状态。

不要用于：已导出为普通图片的架构图，这类资源应使用 `AssetImage`。

### AssetMermaid

适用于 `render_type=mermaid`。

```vue
<script setup lang="ts">
import AssetMermaid from '@runtime-kit/public/components/assets/AssetMermaid.vue'
</script>

<template>
  <AssetMermaid name="process-flow" height="360px" />
</template>
```

常用输入：

- `name`：Mermaid 文本资源逻辑名。
- `fallback`：未命中时的兜底 URL。
- 尺寸和表面样式属性可透传给内部 viewer。

失败表现：资源 URL 为空时不渲染图表；语法错误由 Mermaid viewer 展示失败状态。

不要用于：Backend/Agent 直接用 HTML/CSS 生成的流程步骤布局。

### AssetChart

适用于 `render_type=chart`，资源内容应为 ECharts option JSON 或内部 viewer 可解析的 option 文本。

```vue
<script setup lang="ts">
import AssetChart from '@runtime-kit/public/components/assets/AssetChart.vue'
</script>

<template>
  <AssetChart name="sales-chart" height="360px" />
</template>
```

常用输入：

- `name`：图表 option 资源逻辑名。
- `fallback`：未命中时的兜底 URL。
- 尺寸和表面样式属性可透传给内部 viewer。

失败表现：资源请求失败时内容为空，内部图表不会渲染有效图形。

不要用于：指标卡片、普通表格、Backend 已经生成的静态图片。

### AssetFormula

适用于 `render_type=formula`，资源内容应为 LaTeX 文本。

```vue
<script setup lang="ts">
import AssetFormula from '@runtime-kit/public/components/assets/AssetFormula.vue'
</script>

<template>
  <AssetFormula name="equation" display-mode />
</template>
```

常用输入：

- `name`：公式文本资源逻辑名。
- `fallback`：未命中时的兜底 URL。
- KaTeX/viewer 属性可透传。

失败表现：资源请求失败时内容为空；LaTeX 解析失败由内部公式渲染器处理。

不要用于：普通文本公式说明、编号布局、公式周围的解释内容。

## 4. 自定义组件中获取 URL

### useAssetSrc

```vue
<script setup lang="ts">
import { useAssetSrc } from '@runtime-kit/public/composables/assets/useAsset'

const src = useAssetSrc('product-hero')
</script>

<template>
  <img :src="src" alt="产品图" />
</template>
```

### useAssetBackground

```vue
<script setup lang="ts">
import { useAssetBackground } from '@runtime-kit/public/composables/assets/useAsset'

const backgroundStyle = useAssetBackground('cover')
</script>

<template>
  <section :style="backgroundStyle" class="h-full bg-cover bg-center">
    <!-- 布局和内容由页面源码控制 -->
  </section>
</template>
```

### resolveResourcePath

```ts
import { resolveResourcePath } from '@runtime-kit/public/utils/assets'

const logoSrc = resolveResourcePath('img/logo/ppt-e.png')
```

适用于非响应式代码或 Runtime public 静态资源路径解析。Vue 模板中需要响应式资源时优先使用 `useAssetSrc`。

### useAssetFontFamily

```vue
<script setup lang="ts">
import { useAssetFontFamily } from '@runtime-kit/public/composables/assets/useAsset'

const titleFont = useAssetFontFamily('BrandSerif', 'sans-serif')
</script>

<template>
  <h1 :style="{ fontFamily: titleFont }">品牌标题</h1>
</template>
```

字体资源名必须来自工作空间已注册并启用的字体配置。页面和组件源码应使用静态字符串声明字体资源名，Backend 会据此把字体加入预览和构建 artifact。

### resolveAssetFontFamily

```ts
import { resolveAssetFontFamily } from '@runtime-kit/public/utils/fonts'

const titleFont = resolveAssetFontFamily('BrandSerif', 'sans-serif')
```

适用于非响应式代码。Vue 模板中需要响应式字体时优先使用 `useAssetFontFamily`。

## 5. 禁止写法

```vue
<!-- 禁止：聚合入口已经不再作为公开能力 -->
<AssetRenderer name="sales-chart" />
```

```vue
<!-- 禁止：引用内部渲染器 -->
<script setup lang="ts">
import MermaidViewer from '@runtime-kit/internal/renderers/MermaidViewer.vue'
</script>
```

```css
/* 禁止：CSS url() 不经过 Runtime 资源解析 */
.hero {
  background-image: url('/img/illus/background/background.png');
}
```

```vue
<!-- 禁止：硬编码 Backend 资源地址 -->
<img src="http://127.0.0.1:8000/api/v1/public/assets/1/abc123" />
```

## 6. 检查清单

- 页面内容资源是否根据 `asset_metadata.render_type` 选择了显式组件。
- 是否没有使用 `AssetRenderer`。
- 是否没有引用 `@runtime-kit/internal/...`。
- 背景图是否通过 `useAssetBackground` 或 `resolveResourcePath` 解析。
- 图片是否通过 `AssetImage` 或 `useAssetSrc` 绑定。
- 非主题字体是否通过 `useAssetFontFamily` 或 `resolveAssetFontFamily` 使用静态字体资源名声明。
- 工作空间资源是否统一使用逻辑名 `asset.name`。
