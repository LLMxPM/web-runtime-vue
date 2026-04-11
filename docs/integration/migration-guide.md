# 迁移说明

本文档说明本次 Runtime 改造移除了哪些旧能力，以及接入方需要如何迁移。

## 1. 本次移除的能力

- `__file-manager` 浏览器直连本地文件系统能力
- 本地页面编辑器、资源管理器、配置面板
- 基于 `RUNTIME_SHARED_SECRET` 的 `/__preview?ticket=...`
- `/__runtime_internal/v1/*` 内网文件写接口
- 开发态 Monaco 编辑链路

## 2. 新的接入方式

### 旧方式

- 浏览器直接访问 Runtime
- 前端通过环境变量或 URL 直接拉取远程 YAML
- 开发态可在浏览器内写本地文件并依赖 HMR

### 新方式

- 浏览器只访问 Backend 公开预览入口
- Backend 完成 ACL 校验后代理到 Runtime
- Runtime 读取预加载配置包与发布产物
- 项目页面通过远程虚拟模块按需拉取

## 3. 对 Backend 的影响

Backend 需要新增：

- 公开预览代理入口
- 预览上下文 JWS 生成逻辑
- JWKS 暴露
- manifest/config-bundle/modules 等内部 API
- 发布产物存储与读取能力

## 4. 对前端作者侧的影响

- 不再支持浏览器内直接编辑页面或配置
- 若需要作者预览，应建设 Backend 工作区/草稿发布流程
- 若需要联调，可继续使用本仓库的 fixture 模式验证壳层与基础能力

## 5. 建议迁移步骤

1. 先在 Backend 建好发布产物结构与内部 API
2. 再接入公开预览代理入口与 JWS
3. 使用 fixture 模式验证 Runtime 本地壳层
4. 切换到真实 Backend 联调整项目预览
5. 最后清理平台侧仍依赖旧本地编辑方案的链路

## 6. 验收建议

- 浏览器无法绕过 Backend 直接打开 Runtime 预览
- 非授权租户/项目/版本无法访问发布产物
- Runtime 能稳定加载整项目首页、导航、主题、图标与 PDF 导出
- 仓库中不再存在本地文件写接口或作者态编辑入口
