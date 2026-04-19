# Backend 对接 API

本文档面向 Backend/平台团队，定义 Runtime 依赖的公开预览入口和内部 preview artifact 接口。

## 1. 总体原则

- Preview 为**无状态、短生命周期**链路，不保存可恢复的 preview session。
- Backend 负责创建临时 `PreviewArtifact`，并签发自包含的 `PreviewContextToken`。
- Runtime 只认两类输入：
  - `x-runtime-preview-context: <PreviewContextToken>`
  - `/internal/runtime/preview-artifacts/{artifact_id}/...`

## 2. 公开预览入口

该入口由 Backend 提供给浏览器访问，Runtime 不直接对外暴露。

### 推荐入口

`GET /preview/artifacts/{artifact_id}?token=<PreviewContextToken>`

#### 处理职责

- 校验用户登录态
- 校验租户/项目/工作空间权限
- 校验 token 与 `artifact_id` 一致
- 反向代理到 Runtime：`GET /__preview`

#### 代理到 Runtime 时必须附带的请求头

```http
x-runtime-preview-context: <PreviewContextToken>
```

## 3. Runtime 内部 API

以下接口由 Backend 提供给 Runtime 调用，默认都要求服务级鉴权。

### 公共请求头

```http
Authorization: Bearer <RuntimeServiceAccessToken>
x-runtime-preview-context: <PreviewContextToken>
Accept: application/json
```

## 4. 获取 Preview Artifact Manifest

### `GET /internal/runtime/preview-artifacts/{artifact_id}/manifest`

#### 成功响应示例

```json
{
  "artifact_id": "rel_20260411_001",
  "tenant_id": "tenant_a",
  "preview_kind": "page",
  "owner_scope": {
    "scope_type": "project",
    "project_id": "proj_demo",
    "workspace_id": "ws_demo"
  },
  "entry_descriptor": {
    "entry_type": "module",
    "module_path": "src/views/project/HomePage.vue"
  },
  "version": "preview-artifact",
  "modules": {
    "src/workspace-components/CMP_DEMO/v/1.vue": {
      "path": "src/workspace-components/CMP_DEMO/v/1.vue",
      "hash": "sha256:abc123"
    }
  },
  "assets": {
    "img/logo/ppt-e.png": "assets/logo/ppt-e.abc123.png"
  }
}
```

#### 关键约束

- `artifact_id` 必须与 token 中的 `artifact_id` 一致
- `preview_kind / owner_scope / entry_descriptor` 必须与 token 中声明一致
- 单页面预览入口模块允许不进入 `modules` 白名单，但仍必须能通过 `modules?path=` 拉到源码

## 5. 获取标准化配置包

### `GET /internal/runtime/preview-artifacts/{artifact_id}/config-bundle`

#### 说明

- 返回 Runtime 启动所需的 JSON 配置包
- 项目/页面预览必须包含 `app/routes/icons/themes/fonts/module_resolver`
- 组件预览额外包含 `component_preview`

#### 组件预览片段示例

```json
{
  "component_preview": {
    "component_import_path": "@workspace-components/CMP_DEMO/v/1",
    "component_code": "CMP_DEMO",
    "component_version_no": 1,
    "display_name": "示例组件",
    "schema": {
      "props": {
        "title": {
          "type": "string",
          "default": "Hello Preview"
        }
      }
    },
    "canvas": {
      "width": 1920,
      "height": 1080,
      "padding": 48,
      "background": "#f8fafc"
    }
  }
}
```

## 6. 获取远程模块源码

### `GET /internal/runtime/preview-artifacts/{artifact_id}/modules?path={logical_module_path}`

#### 请求示例

```http
GET /internal/runtime/preview-artifacts/rel_20260411_001/modules?path=src%2Fviews%2Fproject%2FHomePage.vue
Authorization: Bearer <RuntimeServiceAccessToken>
x-runtime-preview-context: <PreviewContextToken>
Accept: text/plain
```

#### 成功响应

- `200 text/plain`
- body 为 `.vue` SFC 源码

#### 失败响应建议

```json
{
  "code": "MODULE_NOT_FOUND",
  "message": "Module src/views/project/HomePage.vue not found in preview artifact rel_20260411_001"
}
```

## 7. PreviewContextToken Claims

Runtime 至少依赖以下声明：

- 公共字段
  - `tenant_id`
  - `artifact_id`
  - `preview_kind`
  - `scope_type`
  - `workspace_id`
  - `entry_descriptor`
  - `asset_base_url`
  - `trace_id`
  - `iat`
  - `exp`
  - `jti`
- 项目/页面预览额外要求
  - `project_id`
- 组件预览可选字段
  - `component_preview_mode`
  - `component_code`
  - `component_version_no`

#### 关键约束

- 组件预览 token **不要求 `project_id`**
- `scope_type=project` 时必须携带 `project_id`
- Runtime 后续远程模块请求不再恢复 preview session，而是直接透传 `ctx=<PreviewContextToken>`

## 8. 资源访问

推荐方式：

- 在 token 中通过 `asset_base_url` 指定资源根地址
- manifest 的 `assets` 存储相对资源路径
- Runtime 通过 `asset_base_url + manifest.assets[key]` 拼出最终资源 URL

## 9. 状态码建议

- `200`：成功
- `400`：请求参数非法
- `401`：RuntimeServiceAccessToken 或 PreviewContextToken 无效
- `403`：token、artifact、scope 或入口描述不匹配
- `404`：artifact、模块或资源不存在
- `409`：artifact 状态不允许访问
- `500`：内部错误

## 10. 对接检查清单

- 是否能生成符合契约的 `PreviewContextToken`
- 是否已暴露 JWKS 地址
- 是否实现 `preview-artifacts/manifest/config-bundle/modules` 接口
- 是否校验 RuntimeServiceAccessToken 与 PreviewContextToken 一致性
- 是否保证组件预览不要求 `project_id`
- 是否保证 artifact 按 TTL 清理，而不是持久化为可恢复会话
