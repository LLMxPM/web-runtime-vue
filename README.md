# web-runtime-vue

`web-runtime-vue` 现已调整为一个面向 SaaS 平台的只读预览 Runtime。它负责在内网环境中渲染“无状态 preview artifact”的整项目预览、单页面预览与组件预览：加载 Backend 注入的预览上下文、消费标准化配置包、按 artifact 白名单拉取远程模块，并保留导航、全屏与 PDF 导出等运行时能力。

## 运行时定位

- **只读、无状态优先**：Runtime 不再提供浏览器直连本地文件系统、本地页面编辑器、资源管理器或配置面板。
- **统一预览入口**：整项目预览、单页面预览和组件预览共享同一套 `PreviewContextToken + PreviewArtifact` 启动链路。
- **远程虚拟模块**：项目页面源码通过发布产物按需拉取；页面可引用基础能力通过 `@runtime-kit` manifest 显式公开，Runtime shell 私有能力保留在 Runtime 本地。
- **多租户隔离**：预览上下文以 `tenant_id + artifact_id + scope_type` 为主键，跨租户/跨作用域/跨 artifact 请求会被拒绝。

## 当前能力

- 配置驱动的 PPT/演示页面渲染
- `app.config.yaml` 驱动的页面画布尺寸（`app.page.width` / `app.page.height`）
- 目录导航、翻页、全屏放映
- 主题与图标配置加载
- Runtime Kit 基础组件清单（`src/runtime-kit/manifest/runtime-kit.manifest.json`）
- PDF 导出
- 通过 `x-runtime-preview-context` + JWKS 验签启动整项目预览
- 通过 preview artifact 清单白名单解析远程页面模块与静态资源

## 本地使用

### 1. 安装依赖

```bash
pnpm install
```

### 2. 只读 fixture 模式开发

```bash
pnpm dev
```

- 默认读取仓库内 `public/config/*.config.yaml`
- 默认路由指向 `src/examples/local/views` 下的本地示例页面
- 适合调试 Runtime 壳层、布局、示例页面和基础交互
- 不提供浏览器内编辑、资源上传或本地文件写入

### 3. 示例目录分层

- `src/examples/public`：对外示例，面向平台工作空间组件、文档和接入方参考。
- `src/examples/local`：本地示例，仅服务 `pnpm dev` 默认 fixture 与 Runtime 壳层调试。
- `src/views`：运行时入口视图目录，目前保留整页预览入口和组件预览入口。

### 4. 类型检查、测试与构建

```bash
pnpm check
pnpm test
pnpm build
```

## SaaS/平台接入方式

### 1. 外部访问入口

- 浏览器访问 **Backend 公网/内网业务域名**
- Backend 完成用户登录态、租户权限、项目权限、发布版本 ACL 校验
- Backend 将整项目预览请求反向代理到内网 Runtime

### 2. Runtime 预览入口

- Runtime 仅暴露内部预览页入口：`GET /__preview`
- 请求头必须包含：`x-runtime-preview-context: <JWS>`
- Runtime 会使用 `RUNTIME_PREVIEW_JWKS_URL` 指向的 JWKS 对 JWS 进行离线验签

### 3. Runtime 内部依赖的 Backend API

- `GET /internal/runtime/preview-artifacts/{artifact_id}/manifest`
- `GET /internal/runtime/preview-artifacts/{artifact_id}/config-bundle`
- `GET /internal/runtime/preview-artifacts/{artifact_id}/modules?path=...`
- 资源通过 `asset_base_url + manifest.assets` 解析，不再依赖 preview session 恢复接口
- Runtime 回源 Backend 的短期服务令牌由 Backend 在 preview/build 请求时动态下发，Runtime 不再依赖常驻 `RUNTIME_SERVICE_JWT`

### 4. 关键环境变量

- `RUNTIME_PREVIEW_JWKS_URL`
- `RUNTIME_PREVIEW_TOKEN_AUDIENCE`
- `RUNTIME_BACKEND_API_BASE_URL`

## 文档

### 项目内使用文档

- [页面创建指南](docs/page-creation-guide.md)
- [主题系统使用指南](docs/theme-usage-guide.md)
- [图标系统使用指南](docs/icon-system-guide.md)
- [路由配置指南](docs/routes-config-guide.md)
- [组件预览 previewSchema 指南](docs/components/component-preview-schema-guide.md)

### 外部对接文档

- [SaaS 运行时架构与时序](docs/integration/runtime-architecture.md)
- [鉴权与安全契约](docs/integration/auth-and-security.md)
- [Backend 对接 API](docs/integration/backend-api.md)
- [发布产物规范](docs/integration/release-artifact-spec.md)
- [迁移说明](docs/integration/migration-guide.md)

## 说明

- `public/config/routes.config.yaml` 中的 `component` 字段仍保持字符串形式，但在 SaaS 场景下它表示 **preview artifact 中的逻辑模块路径**，不再意味着 Runtime 本地文件路径。
- Runtime 不再依赖 `preview-session` 恢复上下文；后续远程模块请求必须显式携带 `ctx=<PreviewContextToken>`。
- 如果未来需要恢复作者态编辑、草稿预览或 HMR，请通过 Backend 工作区/发布 API 重新设计，不要恢复浏览器直写本地文件的旧方案。

## 许可证

本项目遵循 `AGPL-3.0-or-later` 许可协议。
