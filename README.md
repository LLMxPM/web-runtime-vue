# web-runtime-vue

`web-runtime-vue` 现已调整为一个面向 SaaS 平台的只读预览 Runtime。它负责在内网环境中渲染“无状态 preview artifact”的整项目预览、单页面预览与组件预览：加载 Backend 注入的预览上下文、消费标准化配置包、按 artifact 白名单拉取远程模块，并保留导航、全屏与 PDF 导出等运行时能力。

## 运行时定位

- **只读、无状态优先**：Runtime 不再提供浏览器直连本地文件系统、本地页面编辑器、资源管理器或配置面板。
- **统一预览入口**：整项目预览、单页面预览和组件预览共享同一套 `PreviewContextToken + PreviewArtifact` 启动链路。
- **远程虚拟模块**：项目页面源码通过发布产物按需拉取；页面可引用基础能力通过 `@runtime-kit` manifest 显式公开，公开能力 import path 必须带 `.vN` 文件名版本，Runtime shell 私有能力保留在 Runtime 本地。
- **多租户隔离**：预览上下文以 `tenant_id + artifact_id + scope_type` 为主键，跨租户/跨作用域/跨 artifact 请求会被拒绝。

## 当前能力

- 配置驱动的 PPT/演示页面渲染
- `app.config.yaml` 驱动的页面画布尺寸（`app.page.width` / `app.page.height`）
- 目录导航、翻页、全屏放映
- 主题与图标配置加载
- Runtime Kit 基础组件清单（`src/runtime-kit/manifest/runtime-kit.manifest.json`）：清单项使用 `base_name + version_no + name` 描述能力版本，`name` 形如 `Icon.v1`，不兼容演进新增 v2/v3 文件。
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
- 如需禁止直接打开 Runtime 独立 fixture 页面，可设置 `RUNTIME_STANDALONE_PREVIEW_ENABLED=false`；该开关只拦截 `/` 等独立页面入口，仍保留 Backend 调用的 `/__preview`、构建与诊断链路。
- 本地默认监听 `127.0.0.1:7373`；容器部署通过 `RUNTIME_SERVER_HOST=0.0.0.0` 和 `RUNTIME_SERVER_PORT=7373` 暴露给平台内网。

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

### 5. 容器镜像

Runtime 作为独立子项目发布自己的 Docker Hub 镜像。镜像保留 Vite dev server，因为 `/__preview`、`/__runtime_internal/v1/builds/project` 和诊断接口由 Vite 插件承载：

```bash
docker build -t web-runtime-vue:local .
docker run --rm -p 7373:7373 --env-file .env.example web-runtime-vue:local
```

容器健康检查端点为 `GET /__runtime_healthz`。

### 6. Backend build release

Backend 触发整项目构建时，Runtime 会使用专用的 `build-release-main` 入口和 manifest 生成的页面模块映射。构建产物保留演示外壳能力，包括导航、翻页、全屏、侧栏/缩略图与 PDF 导出；组件预览宿主、资源预览宿主、Standalone 单页预览、本地 examples/fixture 页面和默认 Runtime Shell 静态示例资源不会进入 build release 依赖图。

## CI/CD

- `.github/workflows/ci.yml` 在 push、pull request 与手动触发时执行 `pnpm check`、`pnpm test`、`pnpm build`，并构建 Runtime 镜像 smoke，不推送。
- `.github/workflows/docker-release.yml` 在 GitHub Release `published` 后执行质量门禁并推送 Docker Hub。
- Docker Hub 需要配置 `vars.DOCKERHUB_NAMESPACE`、`vars.DOCKER_USERNAME`、`secrets.DOCKER_PASSWORD`。
- 稳定 Release 推送 `<release_tag>`、`sha-<12位提交>` 和 `latest`；Pre-release 只推送 `<release_tag>` 与 `sha-<12位提交>`。
- 平台根仓会校验 `web-runtime-vue:sha-<12位提交>` 是否存在，因此每个被平台子模块锁定的 Runtime 提交都应先完成本仓 Release。

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
- `RUNTIME_BUILD_TOKEN_AUDIENCE`
- `RUNTIME_DIAGNOSTICS_TOKEN_AUDIENCE`
- `RUNTIME_BACKEND_API_BASE_URL`
- `RUNTIME_SERVER_HOST`
- `RUNTIME_SERVER_PORT`
- `RUNTIME_SERVER_BASE_PATH`：同域 Gateway 模式设为 `/runtime/`，独立 Runtime 域名设为 `/` 或留空。
- `RUNTIME_SERVER_ALLOWED_HOSTS`：可追加允许访问 Vite dev server 的 Host，多个值用逗号、分号或空白分隔。
- `RUNTIME_STANDALONE_PREVIEW_ENABLED`：默认 `true`；设为 `false` 时关闭 Runtime 独立 fixture 页面入口，但不关闭平台预览、构建和诊断服务。

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
- `RUNTIME_STANDALONE_PREVIEW_ENABLED=false` 不是强安全网关；Vite dev server 仍需暴露 `/src`、`/@vite` 等资源给 Backend 预览页面使用。共享或生产环境仍应通过内网、反向代理或 Service Mesh 限制 Runtime 端口访问。

## 许可证

本项目遵循 `AGPL-3.0-or-later` 许可协议。
