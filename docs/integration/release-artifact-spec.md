# 发布产物规范

本文档定义 Runtime 所依赖的发布产物结构与命名规范。

## 1. 设计目标

- 发布后内容不可变
- 可按 `tenant_id + project_id + release_id` 精确定位
- 可被 Runtime 按需拉取模块与资源
- 配置、页面、资源之间可通过 manifest 建立稳定映射

## 2. 产物组成

每个发布版本至少应包含四类内容：

### 2.1 manifest

用于描述版本元数据、模块白名单和资源映射。

必填字段：

- `release_id`
- `tenant_id`
- `project_id`
- `entry_route`
- `modules`
- `assets`

可选字段：

- `version`
- `published_at`

### 2.2 config-bundle

标准化 JSON 配置包，包含：

- `app`
- `routes`
- `icons`
- `themes`

要求：

- 字段结构应与 Runtime 当前的配置读取逻辑兼容
- 不再要求浏览器直接读取 YAML
- 由 Backend 在发布阶段完成 YAML -> JSON 的标准化

### 2.3 页面模块源码

- 存储形式：`.vue` SFC 文本
- 逻辑路径统一为 `src/views/...`
- `routes.config` 中的 `component` 字段推荐继续使用 `@/views/...` 形式，Runtime 会在加载前规范化

### 2.4 资源索引

- 通过 `assets` 建立逻辑路径到实际资源路径的映射
- 键统一使用规范化相对路径，例如 `img/logo/ppt-e.png`
- 值可为：
  - 相对 `asset_base_url` 的资源路径
  - 已签名或可直接访问的绝对 URL

## 3. 模块映射规则

manifest 中的 `modules` 使用逻辑路径为 key，例如：

```json
{
  "src/views/project/HomePage.vue": {
    "path": "src/views/project/HomePage.vue",
    "hash": "sha256:abc123"
  }
}
```

要求：

- key 必须唯一
- `path` 建议与 key 保持一致
- `hash` 用于审计、缓存与发布追踪

## 4. 资源映射规则

```json
{
  "img/logo/ppt-e.png": "assets/logo/ppt-e.abc123.png",
  "fonts/source-code-pro.woff2": "assets/fonts/source-code-pro.def456.woff2"
}
```

要求：

- Runtime 优先命中 `assets` 映射
- 未命中时可回退到 `asset_base_url + 原始资源路径`
- 对于高价值资源，建议总是写入 `assets` 映射避免歧义

## 5. 兼容策略

- 路由配置中的 `component` 仍允许使用字符串形式
- Runtime 会将 `@/views/...`、`/src/views/...`、`views/...` 统一规范化为 `src/views/...`
- 本地内建默认页面，如 `src/views/defaultpage/NotFoundPage.vue`，仍由 Runtime 本地代码提供

## 6. 发布建议

- 建议对每个发布版本生成不可变 `release_id`
- 建议 manifest 和 config-bundle 使用强缓存 + 内容哈希
- 建议页面模块源码和资源统一进入对象存储或制品仓库
- 若存在多语言或多区域差异，建议在发布阶段生成独立 release
