# Vue 页面资源引用规范

> 适用范围：所有在 Runtime 中运行的 `.vue` 页面文件。

---

## 核心原则

**Vue 页面只需传资源的逻辑名 `asset.name`，其余全部由框架自动完成。**

Backend 生成预览时，已将所有信息注入到 Runtime 的 window 上下文中：

```
manifest.assets = { "background": "a3f8b2c1...", "logo-mark": "b5c8d3e2..." }
assetBaseUrl    = "http://backend/api/v1/public/assets/{workspaceId}"
```

`resolveResourcePath(asset.name)` 完成全部解析：`asset.name → file_hash → 完整 URL`。

---

## 一、推荐写法：直接用组件

### `<AssetImage>` — 图片

```vue
<script setup lang="ts">
import AssetImage from '@/components/common/AssetImage.vue'
</script>

<template>
  <AssetImage name="product-hero" alt="产品主图" class="w-full rounded-xl" />
</template>
```

### `<AssetBackground>` — 背景图容器

```vue
<script setup lang="ts">
import AssetBackground from '@/components/common/AssetBackground.vue'
</script>

<template>
  <AssetBackground name="background" class="min-h-screen">
    <h1>页面标题</h1>
  </AssetBackground>
</template>
```

---

## 二、需要 URL 字符串时：composable

```vue
<script setup lang="ts">
import { useAssetSrc, useAssetBackground } from '@/core/composables'

const src = useAssetSrc('product-hero')
const bgStyle = useAssetBackground('background')
</script>

<template>
  <img :src="src" alt="产品图" />
  <div :style="bgStyle" class="hero" />
</template>
```

---

## 三、Runtime 静态资源（`public/` 目录）

放在 Runtime `public/` 目录下的文件（如 logo、默认占位图）同样使用 `resolveResourcePath`：

```vue
<script setup lang="ts">
import { resolveResourcePath } from '@/core/utils/path'
const logoSrc = resolveResourcePath('img/logo/ppt-e.png')
</script>

<template>
  <img :src="logoSrc" alt="logo" />
</template>
```

---

## 四、禁止写法

```css
/* ❌ CSS url() 不经过路径解析，跨 Origin 时 404 */
.hero {
  background-image: url('/img/illus/background/background.png');
}
```

```vue
<!-- ❌ 硬编码绝对路径 -->
<img src="http://127.0.0.1:8000/api/v1/public/assets/1/abc123" />
```

---

## 五、提交前检查清单

- [ ] `<style>` 中没有 `url('/...')`
- [ ] 图片用 `<AssetImage>` 或 `useAssetSrc` 绑定
- [ ] 背景图用 `<AssetBackground>` 或 `useAssetBackground` 绑定
- [ ] 工作空间资源统一使用逻辑名 `asset.name`
- [ ] 不依赖大小写、后缀或 basename 兜底解析
