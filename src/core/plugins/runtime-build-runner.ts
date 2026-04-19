/**
 * 文件用途：提供 Runtime 内部整项目构建入口，并在临时工作区中执行程序化 Vite 构建、归档与回传。
 */

import { mkdtemp, mkdir, rm, symlink, writeFile, cp, access, readdir, readFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { createHash } from 'crypto'
import os from 'os'
import { join, resolve, sep } from 'path'

import { zipSync } from 'fflate'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { Plugin, ViteDevServer } from 'vite'
import { build as viteBuild } from 'vite'
import vue from '@vitejs/plugin-vue'

import type { RuntimePreloadedConfigBundle, RuntimePreviewArtifactManifest } from '../shared/runtime-preview'
import { normalizeAssetKey } from '../shared/runtime-preview'
import {
  buildStaticAssetPath,
  hasForbiddenRootAbsoluteAssetPath,
  normalizeBuildBaseUrl,
} from './runtime-build-runner.helpers'
import { createBuildEntrySource, createBuildIndexHtmlSource } from './runtime-build-entry'

interface RuntimeBuildRunnerOptions {
  endpointPath?: string
  serviceTokenHeaderName?: string
  jwksUrl?: string
  buildAudience?: string
  backendApiBaseUrl?: string
}

interface RuntimeBuildCommandClaims extends JWTPayload {
  sub: string
  job_id: string
  artifact_id: string
  project_id: string
  workspace_id: string
  base_url: string
  jti: string
}

interface RuntimeBuildRequestBody {
  artifact_id: string
  base_url: string
}

interface UploadedBuildArtifactSummary {
  artifact_archive_path?: string
  artifact_download_url?: string
  artifact_entry_file?: string
  artifact_sha256?: string
  artifact_size_bytes?: number
  message?: string
}

interface BuildArtifactSummary {
  artifactEntryFile: string
  artifactSha256: string
  artifactSizeBytes: number
  message: string
}

interface RuntimeBuildLogContext {
  jobId?: string
  artifactId?: string
  baseUrl?: string
  runtimeRoot?: string
  tempRoot?: string
  distRoot?: string
  [key: string]: unknown
}

const DEFAULT_BUILD_ENDPOINT = '/__runtime_internal/v1/builds/project'
const DEFAULT_BUILD_AUDIENCE = 'runtime-build'
const DEFAULT_RUNTIME_SERVICE_TOKEN_HEADER = 'x-runtime-service-token'

/**
 * 输出远程构建调试日志，便于定位 Runtime 实际执行路径。
 * @param stage 当前构建阶段
 * @param context 结构化上下文
 */
function logRuntimeBuild(stage: string, context: RuntimeBuildLogContext = {}): void {
  console.info(`[runtime-build] ${stage}`, context)
}

/**
 * 输出远程构建异常日志。
 * @param stage 当前构建阶段
 * @param error 异常对象
 * @param context 结构化上下文
 */
function logRuntimeBuildError(stage: string, error: unknown, context: RuntimeBuildLogContext = {}): void {
  console.error(`[runtime-build] ${stage}`, {
    ...context,
    error: error instanceof Error
      ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
      : error,
  })
}
/**
 * Runtime 内部整项目构建插件：
 * 1. 仅在 Vite serve 下暴露内部构建入口；
 * 2. 使用 Backend JWKS 验签构建命令令牌；
 * 3. 拉取 build snapshot 后在临时工作区执行程序化构建；
 * 4. 构建阶段只物化当前 snapshot 资源，并将其增量写入 `__build_assets`；
 * 5. 构建完成后将 dist.zip 回传 Backend，并清理临时文件。
 */
export default function runtimeBuildRunner(options: RuntimeBuildRunnerOptions = {}): Plugin {
  const endpointPath = options.endpointPath || DEFAULT_BUILD_ENDPOINT
  const serviceTokenHeaderName = (options.serviceTokenHeaderName || DEFAULT_RUNTIME_SERVICE_TOKEN_HEADER).toLowerCase()
  let runtimeRoot = ''

  return {
    name: 'runtime-build-runner',
    apply: 'serve',

    configResolved(resolvedConfig) {
      runtimeRoot = resolvedConfig.root
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url || '').split('?')[0] !== endpointPath) {
          return next()
        }

        if (req.method !== 'POST') {
          return sendJson(res, 405, {
            success: false,
            code: 'METHOD_NOT_ALLOWED',
            message: '整项目构建入口仅支持 POST。',
          })
        }

        try {
          const buildToken = readBearerToken(String(req.headers.authorization || ''))
          const verifiedClaims = await verifyBuildToken(buildToken, {
            jwksUrl: options.jwksUrl || process.env.RUNTIME_PREVIEW_JWKS_URL || '',
            audience: options.buildAudience || process.env.RUNTIME_BUILD_TOKEN_AUDIENCE || DEFAULT_BUILD_AUDIENCE,
          })
          const payload = await readJsonBody<RuntimeBuildRequestBody>(req)
          const normalizedBaseUrl = normalizeBuildBaseUrl(payload.base_url)
          assertBuildRequestMatchesClaims(payload, normalizedBaseUrl, verifiedClaims)
          const buildContext: RuntimeBuildLogContext = {
            jobId: String(verifiedClaims.job_id),
            artifactId: payload.artifact_id,
            baseUrl: normalizedBaseUrl,
            runtimeRoot,
            method: req.method,
            requestUrl: req.url,
          }

          logRuntimeBuild('request.received', buildContext)
          const serviceToken = String(req.headers[serviceTokenHeaderName] || '')
          if (!serviceToken) {
            throw new RuntimeBuildError(401, 'RUNTIME_SERVICE_TOKEN_REQUIRED', '缺少 Backend 下发的 Runtime 服务令牌。')
          }

          const backendClient = createBuildBackendClient({
            backendApiBaseUrl: options.backendApiBaseUrl || process.env.RUNTIME_BACKEND_API_BASE_URL || '',
            serviceToken,
          })

          logRuntimeBuild('snapshot.fetch.start', buildContext)
          const manifest = await backendClient.fetchManifest(payload.artifact_id)
          const configBundle = await backendClient.fetchConfigBundle(payload.artifact_id)
          logRuntimeBuild('snapshot.fetch.done', {
            ...buildContext,
            moduleCount: Object.keys(manifest.modules || {}).length,
            assetCount: Object.keys(manifest.assets || {}).length,
          })
          const buildSummary = await runProjectBuild({
            runtimeRoot,
            jobId: String(verifiedClaims.job_id),
            artifactId: payload.artifact_id,
            buildToken,
            baseUrl: normalizedBaseUrl,
            manifest,
            configBundle,
            backendClient,
          })

          sendJson(res, 200, {
            success: true,
            artifact_id: payload.artifact_id,
            base_url: normalizedBaseUrl,
            artifact_entry_file: buildSummary.artifactEntryFile,
            artifact_sha256: buildSummary.artifactSha256,
            artifact_size_bytes: buildSummary.artifactSizeBytes,
            message: buildSummary.message,
          })
          logRuntimeBuild('request.completed', {
            ...buildContext,
            artifactEntryFile: buildSummary.artifactEntryFile,
            artifactSha256: buildSummary.artifactSha256,
            artifactSizeBytes: buildSummary.artifactSizeBytes,
          })
        } catch (error) {
          logRuntimeBuildError('request.failed', error, {
            runtimeRoot,
            method: req.method,
            requestUrl: req.url,
          })
          sendBuildError(res, error)
        }
      })
    },
  }
}

/**
 * 验证整项目构建命令令牌。
 * @param token Backend 签发的整项目构建命令令牌
 * @param options 验签选项
 * @returns 已校验的 claims
 */
async function verifyBuildToken(
  token: string,
  options: {
    jwksUrl: string
    audience: string
  },
): Promise<RuntimeBuildCommandClaims> {
  if (!options.jwksUrl) {
    throw new RuntimeBuildError(503, 'JWKS_URL_MISSING', 'Runtime 未配置 JWKS 地址。')
  }
  const jwks = createRemoteJWKSet(new URL(options.jwksUrl))
  const { payload } = await jwtVerify(token, jwks, {
    audience: options.audience,
  })

  const claims = payload as RuntimeBuildCommandClaims
  if (!claims.job_id || !claims.artifact_id || !claims.project_id || !claims.workspace_id || !claims.base_url) {
    throw new RuntimeBuildError(401, 'BUILD_TOKEN_INVALID', '构建命令令牌缺少必需声明。')
  }
  return claims
}

/**
 * 读取请求头中的 Bearer Token。
 * @param authorization 原始 Authorization 头
 * @returns Bearer Token
 */
function readBearerToken(authorization: string): string {
  const trimmed = authorization.trim()
  if (!trimmed.startsWith('Bearer ')) {
    throw new RuntimeBuildError(401, 'BUILD_TOKEN_REQUIRED', '缺少 Bearer 构建令牌。')
  }
  return trimmed.slice('Bearer '.length).trim()
}

/**
 * 读取 JSON 请求体。
 * @param req Node 请求对象
 * @returns 解析后的 JSON
 */
async function readJsonBody<T>(req: NodeJS.ReadableStream): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const rawBody = Buffer.concat(chunks).toString('utf-8')
  try {
    return JSON.parse(rawBody) as T
  } catch {
    throw new RuntimeBuildError(400, 'REQUEST_BODY_INVALID', '请求体不是合法 JSON。')
  }
}

/**
 * 校验请求体与令牌声明是否一致。
 * @param payload Runtime 构建请求体
 * @param normalizedBaseUrl 已规范化的 baseUrl
 * @param claims 已校验的 JWT 声明
 */
function assertBuildRequestMatchesClaims(
  payload: RuntimeBuildRequestBody,
  normalizedBaseUrl: string,
  claims: RuntimeBuildCommandClaims,
): void {
  if (String(payload.artifact_id || '') !== String(claims.artifact_id || '')) {
    throw new RuntimeBuildError(403, 'BUILD_ARTIFACT_MISMATCH', '构建 artifact 与令牌声明不一致。')
  }
  if (normalizedBaseUrl !== normalizeBuildBaseUrl(claims.base_url)) {
    throw new RuntimeBuildError(403, 'BUILD_BASE_URL_MISMATCH', '构建 base_url 与令牌声明不一致。')
  }
}

/**
 * 创建用于读取 Backend build snapshot 的客户端。
 * @param options 客户端配置
 * @returns 只读构建客户端
 */
function createBuildBackendClient(options: {
  backendApiBaseUrl: string
  serviceToken: string
}) {
  if (!options.backendApiBaseUrl) {
    throw new RuntimeBuildError(503, 'BACKEND_API_BASE_URL_MISSING', 'Runtime 未配置 Backend API 根地址。')
  }
  if (!options.serviceToken) {
    throw new RuntimeBuildError(503, 'RUNTIME_SERVICE_TOKEN_REQUIRED', 'Runtime 未获取到服务级令牌。')
  }

  const apiBaseUrl = options.backendApiBaseUrl.replace(/\/+$/, '')
  const defaultHeaders: Record<string, string> = {
    Authorization: `Bearer ${options.serviceToken}`,
  }

  return {
    async fetchManifest(artifactId: string): Promise<RuntimePreviewArtifactManifest> {
      return requestJson<RuntimePreviewArtifactManifest>(
        `${apiBaseUrl}/internal/runtime/preview-artifacts/${encodeURIComponent(artifactId)}/manifest`,
        defaultHeaders,
      )
    },

    async fetchConfigBundle(artifactId: string): Promise<RuntimePreloadedConfigBundle> {
      return requestJson<RuntimePreloadedConfigBundle>(
        `${apiBaseUrl}/internal/runtime/preview-artifacts/${encodeURIComponent(artifactId)}/config-bundle`,
        defaultHeaders,
      )
    },

    async fetchModuleSource(artifactId: string, modulePath: string): Promise<string> {
      const url = `${apiBaseUrl}/internal/runtime/preview-artifacts/${encodeURIComponent(artifactId)}/modules?path=${encodeURIComponent(modulePath)}`
      const response = await fetch(url, {
        headers: {
          ...defaultHeaders,
          Accept: 'text/plain, application/json;q=0.9',
        },
      })
      if (!response.ok) {
        throw await toBuildError(response, 'MODULE_FETCH_FAILED')
      }
      return response.text()
    },

    async fetchAssetBinary(assetUrl: string): Promise<Buffer> {
      const response = await fetch(assetUrl, {
        headers: {
          Accept: '*/*',
        },
      })
      if (!response.ok) {
        throw await toBuildError(response, 'ASSET_FETCH_FAILED')
      }
      return Buffer.from(await response.arrayBuffer())
    },

    async uploadBuildArtifact(params: {
      jobId: string
      buildToken: string
      archiveBuffer: Buffer
      entryFile: string
      sha256: string
      sizeBytes: number
    }): Promise<UploadedBuildArtifactSummary> {
      const formData = new FormData()
      formData.set('archive', new Blob([params.archiveBuffer], { type: 'application/zip' }), 'dist.zip')
      formData.set('entry_file', params.entryFile)
      formData.set('sha256', params.sha256)
      formData.set('size_bytes', String(params.sizeBytes))

      const response = await fetch(
        `${apiBaseUrl}/api/v1/internal/runtime/build-jobs/${encodeURIComponent(params.jobId)}/artifact`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.buildToken}`,
          },
          body: formData,
        },
      )
      if (!response.ok) {
        throw await toBuildError(response, 'BUILD_ARTIFACT_UPLOAD_FAILED')
      }
      return response.json() as Promise<UploadedBuildArtifactSummary>
    },
  }
}

/**
 * 请求 JSON 接口并统一处理错误。
 * @param url 请求地址
 * @param headers 请求头
 * @returns 解析后的 JSON
 */
async function requestJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    headers: {
      ...headers,
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw await toBuildError(response, 'BACKEND_REQUEST_FAILED')
  }
  return response.json() as Promise<T>
}

/**
 * 将后端错误响应转换为统一 Runtime 构建错误。
 * @param response HTTP 响应
 * @param fallbackCode 兜底错误码
 * @returns 构建错误
 */
async function toBuildError(response: Response, fallbackCode: string): Promise<RuntimeBuildError> {
  let message = response.statusText || 'Backend 请求失败。'
  let code = fallbackCode
  try {
    const payload = await response.json()
    code = String(payload?.code || code)
    message = String(payload?.message || message)
  } catch {
    // 忽略非 JSON 错误体
  }
  return new RuntimeBuildError(response.status, code, message)
}

/**
 * 执行整项目构建、归档与上传。
 * @param params 构建参数
 * @returns 构建摘要
 */
async function runProjectBuild(params: {
  runtimeRoot: string
  jobId: string
  artifactId: string
  buildToken: string
  baseUrl: string
  manifest: RuntimePreviewArtifactManifest
  configBundle: RuntimePreloadedConfigBundle
  backendClient: ReturnType<typeof createBuildBackendClient>
}): Promise<BuildArtifactSummary> {
  const tempRoot = await createBuildWorkspace(params.runtimeRoot)
  const distRoot = resolve(tempRoot, 'dist')
  const buildContext: RuntimeBuildLogContext = {
    jobId: params.jobId,
    artifactId: params.artifactId,
    baseUrl: params.baseUrl,
    runtimeRoot: params.runtimeRoot,
    tempRoot,
    distRoot,
  }

  try {
    logRuntimeBuild('workspace.created', buildContext)
    logRuntimeBuild('modules.inject.start', buildContext)
    await injectSnapshotModules(tempRoot, params.artifactId, params.manifest, params.backendClient)
    logRuntimeBuild('modules.inject.done', {
      ...buildContext,
      moduleCount: Object.keys(params.manifest.modules || {}).length,
    })

    logRuntimeBuild('workspace.validate.start', buildContext)
    await validateBuildWorkspaceSources(tempRoot)
    validateConfigAssetReferences(params.manifest, params.configBundle)
    logRuntimeBuild('workspace.validate.done', buildContext)

    logRuntimeBuild('assets.materialize.start', buildContext)
    const staticAssetMapping = await materializeSnapshotAssets(tempRoot, params.manifest, params.backendClient)
    logRuntimeBuild('assets.materialize.done', {
      ...buildContext,
      materializedAssetCount: Object.keys(staticAssetMapping).length,
    })

    logRuntimeBuild('entry.write.start', buildContext)
    await writeBuildEntryFiles(tempRoot, {
      ...params.configBundle,
      manifest: {
        ...params.manifest,
        artifact_kind: 'build_release',
        asset_base_url: undefined,
        assets: staticAssetMapping,
      },
    })
    logRuntimeBuild('entry.write.done', buildContext)

    logRuntimeBuild('vite.build.start', buildContext)
    await viteBuild({
      configFile: false,
      root: tempRoot,
      base: params.baseUrl,
      plugins: [vue()],
      assetsInclude: ['**/*.drawio'],
      resolve: {
        alias: {
          '@': resolve(tempRoot, 'src'),
          '@components': resolve(tempRoot, 'src/components'),
          '@views': resolve(tempRoot, 'src/views'),
          '@workspace-components': resolve(tempRoot, 'src/workspace-components'),
          '@utils': resolve(tempRoot, 'src/utils'),
          '@types': resolve(tempRoot, 'src/types'),
          '@styles': resolve(tempRoot, 'src/styles'),
        },
        extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.vue'],
      },
      css: {
        modules: {
          localsConvention: 'camelCase',
        },
      },
      build: {
        outDir: distRoot,
        emptyOutDir: false,
        sourcemap: false,
        rollupOptions: {
          output: {
            manualChunks: {
              vendor: ['vue', 'vue-router'],
            },
          },
        },
      },
    })
    logRuntimeBuild('vite.build.done', buildContext)

    logRuntimeBuild('artifact.archive.start', buildContext)
    const archiveBuffer = await createZipArchiveFromDirectory(distRoot)
    const artifactSha256 = createHash('sha256').update(archiveBuffer).digest('hex')
    const artifactSizeBytes = archiveBuffer.length
    logRuntimeBuild('artifact.archive.done', {
      ...buildContext,
      artifactSha256,
      artifactSizeBytes,
    })

    logRuntimeBuild('artifact.upload.start', {
      ...buildContext,
      artifactSha256,
      artifactSizeBytes,
    })
    const uploadSummary = await params.backendClient.uploadBuildArtifact({
      jobId: params.jobId,
      buildToken: params.buildToken,
      archiveBuffer,
      entryFile: 'index.html',
      sha256: artifactSha256,
      sizeBytes: artifactSizeBytes,
    })
    logRuntimeBuild('artifact.upload.done', {
      ...buildContext,
      artifactArchivePath: uploadSummary.artifact_archive_path,
      artifactDownloadUrl: uploadSummary.artifact_download_url,
      artifactEntryFile: uploadSummary.artifact_entry_file || 'index.html',
      artifactSha256: uploadSummary.artifact_sha256 || artifactSha256,
      artifactSizeBytes: uploadSummary.artifact_size_bytes || artifactSizeBytes,
    })

    return {
      artifactEntryFile: String(uploadSummary.artifact_entry_file || 'index.html'),
      artifactSha256: String(uploadSummary.artifact_sha256 || artifactSha256),
      artifactSizeBytes: Number(uploadSummary.artifact_size_bytes || artifactSizeBytes),
      message: String(uploadSummary.message || '构建完成。'),
    }
  } catch (error) {
    logRuntimeBuildError('run.failed', error, buildContext)
    throw error
  } finally {
    logRuntimeBuild('workspace.cleanup.start', buildContext)
    await rm(tempRoot, { recursive: true, force: true })
    logRuntimeBuild('workspace.cleanup.done', buildContext)
  }
}

/**
 * 在系统临时目录中创建构建工作区，并复制 Runtime 壳层代码。
 * @param runtimeRoot 当前 Runtime 根目录
 * @returns 临时工作区路径
 */
async function createBuildWorkspace(runtimeRoot: string): Promise<string> {
  const tempRoot = await mkdtemp(join(os.tmpdir(), 'web-presentation-runtime-build-'))
  const copyTargets = [
    'src',
    'index.html',
    'postcss.config.js',
    'tailwind.config.js',
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.node.json',
  ]

  for (const relativePath of copyTargets) {
    const sourcePath = resolve(runtimeRoot, relativePath)
    if (!await pathExists(sourcePath)) {
      continue
    }
    const targetPath = resolve(tempRoot, relativePath)
    await cp(sourcePath, targetPath, {
      recursive: true,
      filter: (source) => shouldCopyRuntimePath(source),
    })
  }

  const sourceNodeModules = resolve(runtimeRoot, 'node_modules')
  if (await pathExists(sourceNodeModules)) {
    const targetNodeModules = resolve(tempRoot, 'node_modules')
    await symlink(
      sourceNodeModules,
      targetNodeModules,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  }

  await mkdir(resolve(tempRoot, 'public'), { recursive: true })
  return tempRoot
}

/**
 * 判断 Runtime 模板中的路径是否允许复制到构建工作区。
 * @param source 当前待复制路径
 * @returns 是否允许复制
 */
function shouldCopyRuntimePath(source: string): boolean {
  const normalized = source.replace(/\\/g, '/')
  return !normalized.includes('/node_modules/')
    && !normalized.includes('/dist/')
    && !normalized.includes('/.git/')
    && !normalized.includes('/__tests__/')
    && !/\.(test|spec)\.[^/]+$/i.test(normalized)
}

/**
 * 将 build snapshot 的远程模块写入临时工作区。
 * @param tempRoot 临时工作区
 * @param artifactId build snapshot artifact ID
 * @param manifest 预览清单
 * @param backendClient 后端客户端
 */
async function injectSnapshotModules(
  tempRoot: string,
  artifactId: string,
  manifest: RuntimePreviewArtifactManifest,
  backendClient: ReturnType<typeof createBuildBackendClient>,
): Promise<void> {
  for (const logicalPath of Object.keys(manifest.modules || {})) {
    const content = await backendClient.fetchModuleSource(artifactId, logicalPath)
    const targetPath = resolve(tempRoot, logicalPath.split('/').join(sep))
    await mkdir(resolve(targetPath, '..'), { recursive: true })
    await writeFile(targetPath, content, 'utf-8')
  }
}

/**
 * 校验工作区源码中不存在根绝对静态资源引用。
 * @param tempRoot 临时工作区根目录
 */
async function validateBuildWorkspaceSources(tempRoot: string): Promise<void> {
  const sourceRoot = resolve(tempRoot, 'src')
  const violations: string[] = []
  await collectTextFileViolations(sourceRoot, violations)
  if (violations.length > 0) {
    throw new RuntimeBuildError(
      409,
      'BUILD_SOURCE_ABSOLUTE_ASSET_PATH_FORBIDDEN',
      `构建源码中存在根绝对静态资源引用：${violations.join('；')}`,
    )
  }
}

/**
 * 递归扫描源码文本中的非法根绝对静态资源引用。
 * @param rootDir 扫描目录
 * @param violations 违规列表
 */
async function collectTextFileViolations(rootDir: string, violations: string[]): Promise<void> {
  if (!await pathExists(rootDir)) {
    return
  }
  const entries = await readdir(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = resolve(rootDir, entry.name)
    if (entry.isDirectory()) {
      await collectTextFileViolations(entryPath, violations)
      continue
    }
    if (/\.(test|spec)\.[^/]+$/i.test(entry.name)) {
      continue
    }
    if (!/\.(vue|ts|tsx|js|jsx|css)$/.test(entry.name)) {
      continue
    }
    const content = await readFile(entryPath, 'utf-8')
    if (hasForbiddenRootAbsoluteAssetPath(content)) {
      violations.push(entryPath.replace(/\\/g, '/'))
    }
  }
}

/**
 * 校验 themes/icons/fonts 中声明的逻辑资源必须命中 manifest。
 * @param manifest build snapshot manifest
 * @param configBundle build snapshot config bundle
 */
function validateConfigAssetReferences(
  manifest: RuntimePreviewArtifactManifest,
  configBundle: RuntimePreloadedConfigBundle,
): void {
  const assetKeys = new Set(Object.keys(manifest.assets || {}).map(item => normalizeAssetKey(item)))
  const missingAssetKeys = collectConfigAssetKeys(configBundle).filter(assetKey => !assetKeys.has(assetKey))
  if (missingAssetKeys.length > 0) {
    throw new RuntimeBuildError(
      409,
      'BUILD_CONFIG_ASSET_MISSING',
      `构建配置引用了未进入 snapshot 的静态资源：${missingAssetKeys.join(', ')}`,
    )
  }
}

/**
 * 从 build snapshot 配置包中收集必须进入 manifest 的逻辑资源名。
 * @param configBundle build snapshot 配置包
 * @returns 去重后的逻辑资源名
 */
function collectConfigAssetKeys(configBundle: RuntimePreloadedConfigBundle): string[] {
  const assetKeys = new Set<string>()

  const themeEntries = Object.values(((configBundle.themes as Record<string, unknown>)?.themes as Record<string, Record<string, unknown>>) || {})
  for (const themeEntry of themeEntries) {
    appendAssetKey(assetKeys, themeEntry?.logo)
    appendAssetKey(assetKeys, themeEntry?.invertLogo)
  }

  const iconEntries = ((configBundle.icons as Record<string, unknown>)?.static_icons as Array<Record<string, unknown>>) || []
  for (const iconEntry of iconEntries) {
    appendAssetKey(assetKeys, iconEntry?.src)
  }

  const fontEntries = Object.values(((configBundle.fonts as unknown as Record<string, unknown>)?.items as Record<string, Record<string, unknown>>) || {})
  for (const fontEntry of fontEntries) {
    appendAssetKey(assetKeys, fontEntry?.asset_name)
  }

  return Array.from(assetKeys)
}

/**
 * 将单个逻辑资源名加入校验集合。
 * @param target 目标集合
 * @param rawValue 原始资源名
 */
function appendAssetKey(target: Set<string>, rawValue: unknown): void {
  const normalizedValue = normalizeAssetKey(String(rawValue || ''))
  if (!normalizedValue || /^https?:\/\//i.test(normalizedValue)) {
    return
  }
  target.add(normalizedValue)
}

/**
 * 下载并落盘 build snapshot 中声明的静态资源。
 * @param tempRoot 临时工作区
 * @param manifest 预览清单
 * @param backendClient 后端客户端
 * @returns 供静态构建使用的资源映射
 */
async function materializeSnapshotAssets(
  tempRoot: string,
  manifest: RuntimePreviewArtifactManifest,
  backendClient: ReturnType<typeof createBuildBackendClient>,
): Promise<Record<string, string>> {
  const staticAssetMapping: Record<string, string> = {}
  const assetBaseUrl = String(manifest.asset_base_url || '').replace(/\/+$/, '')
  if (!assetBaseUrl) {
    throw new RuntimeBuildError(409, 'BUILD_ASSET_BASE_URL_MISSING', '构建快照缺少 asset_base_url。')
  }

  for (const [logicalName, mappedValue] of Object.entries(manifest.assets || {})) {
    const metadata = manifest.asset_metadata?.[logicalName]
    const fileHash = String(metadata?.file_hash || mappedValue || '').trim()
    if (!fileHash) {
      continue
    }

    const staticPath = buildStaticAssetPath(fileHash, metadata?.original_name, logicalName)
    const assetUrl = `${assetBaseUrl}/${encodeURIComponent(fileHash)}`
    const content = await backendClient.fetchAssetBinary(assetUrl)

    await writePublicBinary(tempRoot, staticPath, content)
    staticAssetMapping[logicalName] = staticPath
  }

  return staticAssetMapping
}

/**
 * 向 public 目录写入二进制资源。
 * @param tempRoot 临时工作区
 * @param relativePath public 相对路径
 * @param content 文件内容
 */
async function writePublicBinary(tempRoot: string, relativePath: string, content: Buffer): Promise<void> {
  const normalizedPath = String(relativePath || '').trim().replace(/^\.?\/*/, '').replace(/\\/g, '/')
  if (!normalizedPath) {
    return
  }
  const targetPath = resolve(tempRoot, 'public', normalizedPath.split('/').join(sep))
  await mkdir(resolve(targetPath, '..'), { recursive: true })
  await writeFile(targetPath, content)
}

/**
 * 写入构建专用入口脚本与 index.html。
 * @param tempRoot 临时工作区
 * @param preloadedConfig 预加载配置包
 */
async function writeBuildEntryFiles(
  tempRoot: string,
  preloadedConfig: RuntimePreloadedConfigBundle,
): Promise<void> {
  const entryFilePath = resolve(tempRoot, 'src/__build_entry__.ts')
  const indexHtmlPath = resolve(tempRoot, 'index.html')

  await writeFile(
    entryFilePath,
    createBuildEntrySource(preloadedConfig),
    'utf-8',
  )

  await writeFile(
    indexHtmlPath,
    createBuildIndexHtmlSource(),
    'utf-8',
  )
}

/**
 * 把 dist 目录打包为 ZIP Buffer。
 * @param distRoot Vite 构建输出目录
 * @returns ZIP 二进制内容
 */
async function createZipArchiveFromDirectory(distRoot: string): Promise<Buffer> {
  const archiveEntries: Record<string, Uint8Array> = {}
  await collectArchiveEntries(distRoot, distRoot, archiveEntries)
  return Buffer.from(zipSync(archiveEntries, { level: 9 }))
}

/**
 * 递归收集 ZIP 归档条目。
 * @param rootDir 根目录
 * @param currentDir 当前目录
 * @param archiveEntries ZIP 条目映射
 */
async function collectArchiveEntries(
  rootDir: string,
  currentDir: string,
  archiveEntries: Record<string, Uint8Array>,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = resolve(currentDir, entry.name)
    if (entry.isDirectory()) {
      await collectArchiveEntries(rootDir, entryPath, archiveEntries)
      continue
    }
    const entryBytes = await readFile(entryPath)
    const relativePath = entryPath
      .replace(rootDir, '')
      .replace(/^[\\/]+/, '')
      .split(sep)
      .join('/')
    archiveEntries[relativePath] = new Uint8Array(entryBytes)
  }
}

/**
 * 判断路径是否存在。
 * @param targetPath 目标路径
 * @returns 是否存在
 */
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 输出 JSON 响应。
 * @param res Node 响应对象
 * @param statusCode HTTP 状态码
 * @param payload 返回体
 */
function sendJson(res: any, statusCode: number, payload: Record<string, unknown>): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

/**
 * 输出统一的构建错误响应。
 * @param res Node 响应对象
 * @param error 原始错误
 */
function sendBuildError(res: any, error: unknown): void {
  if (error instanceof RuntimeBuildError) {
    return sendJson(res, error.statusCode, {
      success: false,
      code: error.code,
      message: error.message,
    })
  }

  return sendJson(res, 500, {
    success: false,
    code: 'RUNTIME_BUILD_FAILED',
    message: error instanceof Error ? error.message : 'Runtime 构建失败。',
  })
}

/**
 * Runtime 内部整项目构建错误。
 */
class RuntimeBuildError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}
