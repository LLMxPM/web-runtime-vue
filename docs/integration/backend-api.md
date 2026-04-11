# Backend 对接 API

本文档面向 Backend/平台团队，定义 Runtime 依赖的公开预览入口和内部发布产物接口。

## 1. 公开预览入口

该入口由 Backend 提供给浏览器访问，Runtime 不直接对外暴露。

### `GET /preview/projects/{project_id}/releases/{release_id}`

#### 处理职责

- 校验用户登录态
- 校验租户/项目/发布版本 ACL
- 生成短期预览上下文 JWS
- 反向代理到 Runtime：`GET /__preview`

#### 代理到 Runtime 时必须附带的请求头

```http
x-runtime-preview-context: <JWS>
```

## 2. Runtime 内部 API

以下接口由 Backend 提供给 Runtime 调用，默认都要求服务级鉴权。

### 公共请求头

```http
Authorization: Bearer <RUNTIME_SERVICE_JWT>
x-runtime-preview-context: <JWS>
x-runtime-preview-session-id: <session_id>
x-runtime-service-audience: runtime-backend
Accept: application/json
```

## 3. 获取预览会话

### `GET /internal/runtime/preview-sessions/{session_id}`

#### 说明

- 用于 Runtime 在远程模块请求阶段恢复预览上下文
- 该接口不依赖 Runtime 进程内缓存
- `session_id` 建议直接复用预览 JWS 的 `jti`

#### 成功响应示例

```json
{
  "session_id": "sess_20260411_001",
  "tenant_id": "tenant_a",
  "project_id": "proj_demo",
  "release_id": "rel_20260411_001",
  "entry_route": "/home",
  "asset_base_url": "https://assets.example/releases/rel_20260411_001",
  "trace_id": "trace_20260411_abc"
}
```

## 4. 获取发布清单

### `GET /internal/runtime/releases/{release_id}/manifest`

#### 成功响应示例

```json
{
  "release_id": "rel_20260411_001",
  "tenant_id": "tenant_a",
  "project_id": "proj_demo",
  "entry_route": "/home",
  "version": "2026.04.11-1",
  "published_at": "2026-04-11T10:00:00Z",
  "modules": {
    "src/views/project/HomePage.vue": {
      "path": "src/views/project/HomePage.vue",
      "hash": "sha256:abc123"
    }
  },
  "assets": {
    "img/logo/ppt-e.png": "assets/logo/ppt-e.abc123.png"
  }
}
```

## 5. 获取标准化配置包

### `GET /internal/runtime/releases/{release_id}/config-bundle`

#### 成功响应示例

```json
{
  "app": {
    "app": {
      "title": "Demo Runtime",
      "icon": "Presentation",
      "version": "1.0.0",
      "description": "Published release preview",
      "features": {
        "showPdfExportButton": true,
        "menuMode": "preview"
      }
    }
  },
  "routes": {
    "routes": [
      {
        "route": "home",
        "component": "@/views/project/HomePage.vue",
        "meta": {
          "title": "首页",
          "order": 0
        }
      }
    ]
  },
  "icons": {
    "lucide_icons": ["Presentation"],
    "static_icons": [],
    "config": {
      "default_size": 20,
      "default_stroke_width": 2
    }
  },
  "themes": {
    "themes": {
      "lightblue": {
        "name": "白底蓝色",
        "description": "默认主题",
        "logo": "img/logo/ppt-e.png",
        "palette": {
          "text": {
            "primary": "#0D286A",
            "secondary": "#1D5297",
            "invert": "#ffffff"
          },
          "background": {
            "default": "#ffffff",
            "invert": "#0D286A"
          },
          "border": {
            "default": "#e5e7eb",
            "subtle": "#d1d5db"
          },
          "link": {
            "default": "#3b82f6",
            "hover": "#2563eb",
            "visited": "#7c3aed"
          },
          "accent": ["#0D286A"]
        },
        "typography": {
          "headingfont": "思源黑体",
          "bodyfont": "思源黑体",
          "codefont": "SourceCodePro",
          "baseFontSize": "16px"
        }
      }
    },
    "default": {
      "theme": "lightblue"
    }
  }
}
```

## 6. 获取页面模块源码

### `GET /internal/runtime/releases/{release_id}/modules?path={logical_module_path}`

#### 请求示例

```http
GET /internal/runtime/releases/rel_20260411_001/modules?path=src%2Fviews%2Fproject%2FHomePage.vue
Authorization: Bearer <RUNTIME_SERVICE_JWT>
x-runtime-preview-session-id: <session_id>
Accept: text/plain
```

#### 成功响应

- `200 text/plain`
- body 为 `.vue` SFC 源码

#### 失败响应建议

```json
{
  "code": "MODULE_NOT_FOUND",
  "message": "Module src/views/project/HomePage.vue not found in release rel_20260411_001"
}
```

## 7. 资源访问

可以有两种实现方式：

### 方式 A：Backend 代理资源

- `GET /internal/runtime/releases/{release_id}/assets/{asset_key}`
- Runtime 或资源代理层读取对象存储并返回文件内容

### 方式 B：直接返回可拼接的资源基地址

- 在 JWS 中通过 `asset_base_url` 指定资源根地址
- manifest 的 `assets` 存储相对资源路径

## 8. 状态码建议

- `200`：成功
- `400`：请求参数非法
- `401`：服务级 JWT 无效
- `403`：租户/项目/发布版本上下文不匹配
- `404`：发布版本、模块或资源不存在
- `409`：发布状态不允许访问
- `500`：内部错误

## 9. 对接检查清单

- 是否能生成符合契约的 JWS
- 是否能基于 `jti` 建立并查询预览会话
- 是否已暴露 JWKS 地址
- 是否实现 preview-sessions/manifest/config-bundle/modules 接口
- 是否校验服务级 JWT 与预览上下文一致性
- 是否能按发布版本返回不可变资源
