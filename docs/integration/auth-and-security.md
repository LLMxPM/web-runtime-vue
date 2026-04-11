# 鉴权与安全契约

本文档定义 Browser、Backend、Runtime 之间的鉴权边界，以及 Runtime 到 Backend 的内部访问约束。

## 1. 总体原则

- 用户身份只由 Backend 负责校验
- Runtime 不维护用户体系，不解析浏览器 Cookie/JWT
- Runtime 只信任 Backend 注入的短期 JWS 与服务级 JWT
- 发布产物访问必须绑定租户、项目和发布版本上下文

## 2. Browser -> Backend

- Browser 使用平台已有登录态访问 Backend 公开预览入口
- Backend 校验：
  - 用户是否登录
  - 用户是否属于目标租户
  - 用户是否有目标项目访问权限
  - 用户是否有目标发布版本预览权限

## 3. Backend -> Runtime

Backend 代理到 Runtime 时，必须注入：

- 请求头：`x-runtime-preview-context: <JWS>`

Runtime 通过 `RUNTIME_PREVIEW_JWKS_URL` 获取 JWKS 并离线验签。

### 预览上下文 JWS 必填声明

- `iss`
- `aud`
- `sub`
- `tenant_id`
- `project_id`
- `release_id`
- `entry_route`
- `asset_base_url`
- `exp`
- `jti`
- `trace_id`

### 验签失败处理

- JWS 缺失：`401 PREVIEW_CONTEXT_REQUIRED`
- JWS 声明不完整：`401 PREVIEW_CONTEXT_INVALID`
- JWS 过期或签名非法：`401`
- manifest 与 JWS 的租户/项目/版本不一致：`403 MANIFEST_CONTEXT_MISMATCH`

## 4. Runtime -> Backend

Runtime 调用 Backend 内部发布产物 API 时，统一使用服务级短期 JWT/JWS：

- `Authorization: Bearer <RUNTIME_SERVICE_JWT>`
- 可选请求头：`x-runtime-service-audience: <RUNTIME_SERVICE_TOKEN_AUDIENCE>`
- HTML 首屏链路会透传原始 `x-runtime-preview-context`
- 远程模块链路会携带 `x-runtime-preview-session-id`

Backend 应同时校验：

- 服务身份是否合法
- `aud` 是否匹配内部 API 约定
- 透传的预览上下文或预览会话是否与请求的 `release_id` 一致
- 当前服务是否被允许读取该租户/项目/版本的发布产物

### 预览会话查询接口

为避免 Runtime 依赖单机内存缓存，Backend 需要提供可重复查询的预览会话接口：

- `GET /internal/runtime/preview-sessions/{session_id}`

该接口至少返回：

- `session_id`
- `tenant_id`
- `project_id`
- `release_id`
- `entry_route`
- `asset_base_url`
- `trace_id`

## 5. 资源与模块白名单

Runtime 对远程模块和资源采用双层约束：

### 第一层：预览上下文约束

- 当前请求必须属于同一个 `tenant_id + project_id + release_id`

### 第二层：manifest 白名单

- 页面模块必须在 `manifest.modules` 中存在
- 静态资源应优先命中 `manifest.assets`

## 6. 错误码建议

| HTTP | code | 含义 |
| --- | --- | --- |
| 401 | `PREVIEW_CONTEXT_REQUIRED` | 缺少预览上下文 JWS |
| 401 | `PREVIEW_CONTEXT_INVALID` | 预览上下文声明不完整或非法 |
| 401 | `PREVIEW_SESSION_INVALID` | 预览会话内容非法或字段不完整 |
| 403 | `MANIFEST_CONTEXT_MISMATCH` | manifest 与预览上下文不一致 |
| 403 | `PREVIEW_SESSION_MISMATCH` | 预览会话标识与请求不一致 |
| 403 | `RELEASE_MISMATCH` | 模块请求的发布版本与上下文不一致 |
| 404 | `MODULE_NOT_ALLOWED` | 模块不在 manifest 白名单中 |
| 5xx | `BACKEND_REQUEST_FAILED` | Runtime 调用 Backend 内部 API 失败 |

## 7. 安全建议

- `RUNTIME_SERVICE_JWT` 应由部署系统或密钥管理系统注入，避免落库或提交仓库
- `exp` 建议控制在分钟级
- `jti` 用于链路追踪与审计
- Runtime 和 Backend 间建议走内网或 Service Mesh
- 如平台支持，建议叠加 mTLS
