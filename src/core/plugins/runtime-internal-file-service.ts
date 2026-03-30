/**
 * 文件功能：提供仅供 Backend 调用的 Runtime 内网文件接口，包含签名鉴权、路径校验与批量上传能力。
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto'
import type { Plugin, ViteDevServer } from 'vite'

import {
  type AllowedDirRule,
  FileAccessError,
  createFileAccessController,
  hashContent,
  joinRelativePath,
} from './file-access'

interface RuntimeInternalFileServiceOptions {
  allowedDirs: AllowedDirRule[]
  sharedSecret?: string
  timestampToleranceSeconds?: number
  nonceTtlSeconds?: number
}

interface BatchUploadFilePayload {
  file_name: string
  content: string
  content_encoding: 'utf-8' | 'base64'
  overwrite?: boolean
}

/**
 * 生成内部接口签名。
 * @param secret 共享密钥
 * @param method HTTP 方法
 * @param pathWithQuery 路径和查询串
 * @param timestamp 时间戳
 * @param nonce 随机串
 * @param body 请求体
 * @returns 十六进制签名值
 */
export function buildInternalSignature(
  secret: string,
  method: string,
  pathWithQuery: string,
  timestamp: string,
  nonce: string,
  body: Buffer,
): string {
  const signingString = [
    method.toUpperCase(),
    pathWithQuery,
    timestamp,
    nonce,
    hashContent(body),
  ].join('\n')
  return createHmac('sha256', secret).update(signingString).digest('hex')
}

/**
 * Runtime 内网文件服务插件。
 * @param options 运行参数
 * @returns Vite 插件对象
 */
export default function runtimeInternalFileService(options: RuntimeInternalFileServiceOptions): Plugin {
  const config = {
    timestampToleranceSeconds: 300,
    nonceTtlSeconds: 600,
    ...options,
  }

  let rootDir = ''
  let basePath = ''
  const nonceStore = new Map<string, number>()

  return {
    name: 'runtime-internal-file-service',
    apply: 'serve',

    configResolved(resolvedConfig) {
      rootDir = resolvedConfig.root
      basePath = normalizeBasePath(resolvedConfig.base)
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const rawPathWithQuery = req.url || ''
        const pathWithQuery = stripBasePath(rawPathWithQuery, basePath)
        if (!pathWithQuery.startsWith('/__runtime_internal/v1')) {
          return next()
        }

        const requestId = randomUUID()
        const access = createFileAccessController(rootDir, config.allowedDirs)
        try {
          const body = await collectBody(req)
          verifyRequest({
            sharedSecret: config.sharedSecret || process.env.RUNTIME_SHARED_SECRET || '',
            method: req.method || 'GET',
            pathWithQuery: rawPathWithQuery,
            headers: req.headers,
            body,
            timestampToleranceSeconds: config.timestampToleranceSeconds,
            nonceTtlSeconds: config.nonceTtlSeconds,
            nonceStore,
          })

          if (pathWithQuery.startsWith('/__runtime_internal/v1/files?') || pathWithQuery === '/__runtime_internal/v1/files') {
            const dirPath = getUrlParam(pathWithQuery, req.headers.host || 'localhost', 'path')
            sendJson(res, { success: true, path: dirPath, files: access.listDirectory(dirPath), request_id: requestId })
            return
          }

          if (pathWithQuery.startsWith('/__runtime_internal/v1/file?') && req.method === 'GET') {
            const filePath = getUrlParam(pathWithQuery, req.headers.host || 'localhost', 'path')
            const content = access.readTextFile(filePath)
            sendJson(res, {
              success: true,
              path: filePath,
              file_name: extractFileName(filePath),
              content,
              content_hash: hashContent(Buffer.from(content, 'utf-8')),
              request_id: requestId,
            })
            return
          }

          if (pathWithQuery === '/__runtime_internal/v1/file' && req.method === 'PUT') {
            const payload = parseJsonBody(body)
            const result = access.writeTextFile(payload.path, String(payload.content ?? ''), payload.expected_hash)
            sendJson(res, toFileResponse(result, requestId))
            return
          }

          if (pathWithQuery === '/__runtime_internal/v1/file' && req.method === 'DELETE') {
            const payload = parseJsonBody(body)
            const result = access.deleteFile(payload.path)
            sendJson(res, toFileResponse(result, requestId))
            return
          }

          if (pathWithQuery === '/__runtime_internal/v1/directory' && req.method === 'POST') {
            const payload = parseJsonBody(body)
            const result = access.makeDirectory(payload.path)
            sendJson(res, toFileResponse(result, requestId))
            return
          }

          if (pathWithQuery === '/__runtime_internal/v1/directory' && req.method === 'DELETE') {
            const payload = parseJsonBody(body)
            const result = access.removeDirectory(payload.path, payload.recursive ?? true)
            sendJson(res, toFileResponse(result, requestId))
            return
          }

          if (pathWithQuery === '/__runtime_internal/v1/files/batch-upload' && req.method === 'POST') {
            const payload = parseJsonBody(body)
            const targetPath = String(payload.target_path || '')
            const files = Array.isArray(payload.files) ? payload.files as BatchUploadFilePayload[] : []
            if (!targetPath.trim()) {
              throw new FileAccessError(400, 'TARGET_PATH_REQUIRED', 'target_path 不能为空。')
            }
            if (files.length === 0) {
              throw new FileAccessError(400, 'FILES_REQUIRED', 'files 不能为空。')
            }

            const uploadedFiles = files.map((file) => {
              const fileBuffer = decodeBatchFile(file)
              const fullPath = joinRelativePath(targetPath, file.file_name)
              const result = access.writeBinaryFile(fullPath, fileBuffer, file.overwrite ?? true)
              return toFileResponse(result, requestId)
            })

            sendJson(res, {
              success: true,
              path: targetPath,
              file_name: '',
              content_hash: '',
              files: uploadedFiles,
              request_id: requestId,
            })
            return
          }

          sendJson(res, { success: false, code: 'ENDPOINT_NOT_FOUND', message: '未找到内部文件接口。', request_id: requestId }, 404)
        } catch (error) {
          handleError(res, error, requestId)
        }
      })
    },
  }
}

/**
 * 规范化 Vite base 配置，便于匹配带前缀的内部接口。
 * @param rawBase Vite base 配置
 * @returns 规范化后的前缀路径，根路径返回空串
 */
function normalizeBasePath(rawBase: string): string {
  const normalized = String(rawBase || '/').trim()
  if (!normalized || normalized === '/') {
    return ''
  }

  return `/${normalized.replace(/^\/+|\/+$/g, '')}`
}

/**
 * 去除请求 URL 中的 base 前缀，便于内部接口按固定路径匹配。
 * @param rawUrl 原始请求 URL
 * @param basePath 规范化后的 base 前缀
 * @returns 去除前缀后的 URL
 */
function stripBasePath(rawUrl: string, basePath: string): string {
  if (!basePath || rawUrl === basePath) {
    return rawUrl
  }

  if (rawUrl.startsWith(`${basePath}/`)) {
    return rawUrl.slice(basePath.length)
  }

  return rawUrl
}

/**
 * 校验 Runtime 内网请求签名与重放保护。
 * @param params 校验参数
 */
function verifyRequest(params: {
  sharedSecret: string
  method: string
  pathWithQuery: string
  headers: Record<string, string | string[] | undefined>
  body: Buffer
  timestampToleranceSeconds: number
  nonceTtlSeconds: number
  nonceStore: Map<string, number>
}): void {
  if (!params.sharedSecret) {
    throw new FileAccessError(503, 'SECRET_MISSING', 'Runtime 未配置共享密钥。')
  }

  const timestamp = String(params.headers['x-internal-timestamp'] || '')
  const nonce = String(params.headers['x-internal-nonce'] || '')
  const signature = String(params.headers['x-internal-signature'] || '')
  if (!timestamp || !nonce || !signature) {
    throw new FileAccessError(401, 'SIGNATURE_REQUIRED', '缺少内部请求签名头。')
  }

  const now = Math.floor(Date.now() / 1000)
  const requestTimestamp = Number(timestamp)
  if (!Number.isFinite(requestTimestamp)) {
    throw new FileAccessError(401, 'TIMESTAMP_INVALID', '内部请求时间戳不合法。')
  }
  if (Math.abs(now - requestTimestamp) > params.timestampToleranceSeconds) {
    throw new FileAccessError(401, 'TIMESTAMP_EXPIRED', '内部请求时间戳已过期。')
  }

  cleanupExpiredNonces(params.nonceStore, now, params.nonceTtlSeconds)
  const existingNonce = params.nonceStore.get(nonce)
  if (existingNonce && now - existingNonce <= params.nonceTtlSeconds) {
    throw new FileAccessError(401, 'NONCE_REPLAY', '内部请求 nonce 已被使用。')
  }

  const expectedSignature = buildInternalSignature(
    params.sharedSecret,
    params.method,
    params.pathWithQuery,
    timestamp,
    nonce,
    params.body,
  )

  const providedBuffer = Buffer.from(signature, 'utf-8')
  const expectedBuffer = Buffer.from(expectedSignature, 'utf-8')
  if (
    providedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new FileAccessError(401, 'SIGNATURE_INVALID', '内部请求签名不正确。')
  }

  params.nonceStore.set(nonce, now)
}

/**
 * 定期清理过期 nonce，避免内存持续增长。
 * @param nonceStore nonce 缓存
 * @param now 当前时间戳
 * @param nonceTtlSeconds 过期秒数
 */
function cleanupExpiredNonces(nonceStore: Map<string, number>, now: number, nonceTtlSeconds: number): void {
  for (const [nonce, usedAt] of nonceStore.entries()) {
    if (now - usedAt > nonceTtlSeconds) {
      nonceStore.delete(nonce)
    }
  }
}

/**
 * 读取原始请求体。
 * @param req Node 请求对象
 * @returns 原始字节数组
 */
async function collectBody(req: any): Promise<Buffer> {
  const chunks: Buffer[] = []
  await new Promise<void>((resolvePromise, rejectPromise) => {
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolvePromise())
    req.on('error', (error: Error) => rejectPromise(error))
  })
  return Buffer.concat(chunks)
}

/**
 * 解析 JSON 请求体。
 * @param body 原始请求体
 * @returns 解析后的对象
 */
function parseJsonBody(body: Buffer): any {
  try {
    const raw = body.toString('utf-8')
    return raw ? JSON.parse(raw) : {}
  } catch (error) {
    throw new FileAccessError(400, 'BODY_INVALID', 'JSON 请求体解析失败。')
  }
}

/**
 * 获取 URL 查询参数。
 * @param rawUrl 原始 URL
 * @param host 请求主机
 * @param key 参数名
 * @returns 参数值
 */
function getUrlParam(rawUrl: string, host: string, key: string): string {
  const url = new URL(rawUrl, `http://${host}`)
  return url.searchParams.get(key) || ''
}

/**
 * 解析批量上传中的单个文件内容。
 * @param file 文件载荷
 * @returns 二进制内容
 */
function decodeBatchFile(file: BatchUploadFilePayload): Buffer {
  if (!file.file_name?.trim()) {
    throw new FileAccessError(400, 'FILE_NAME_REQUIRED', '批量上传文件缺少 file_name。')
  }

  if (file.content_encoding === 'utf-8') {
    return Buffer.from(String(file.content ?? ''), 'utf-8')
  }
  if (file.content_encoding === 'base64') {
    return Buffer.from(String(file.content ?? ''), 'base64')
  }
  throw new FileAccessError(400, 'CONTENT_ENCODING_INVALID', 'content_encoding 仅支持 utf-8 或 base64。')
}

/**
 * 生成标准文件响应结构。
 * @param result 文件写入结果
 * @param requestId 请求 ID
 * @returns 标准响应
 */
function toFileResponse(result: { path: string; fileName: string; contentHash: string }, requestId: string) {
  return {
    success: true,
    path: result.path,
    file_name: result.fileName,
    content_hash: result.contentHash,
    request_id: requestId,
  }
}

/**
 * 输出 JSON 响应。
 * @param res Node 响应对象
 * @param payload 响应体
 * @param statusCode 状态码
 */
function sendJson(res: any, payload: unknown, statusCode: number = 200): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

/**
 * 将异常映射为统一内部接口错误格式。
 * @param res Node 响应对象
 * @param error 异常对象
 * @param requestId 请求 ID
 */
function handleError(res: any, error: unknown, requestId: string): void {
  if (error instanceof FileAccessError) {
    sendJson(res, { success: false, code: error.code, message: error.message, request_id: requestId }, error.statusCode)
    return
  }

  const message = error instanceof Error ? error.message : '未知 Runtime 内部文件异常。'
  sendJson(res, { success: false, code: 'INTERNAL_ERROR', message, request_id: requestId }, 500)
}

/**
 * 提取文件名。
 * @param filePath 文件路径
 * @returns 文件名
 */
function extractFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || ''
}
