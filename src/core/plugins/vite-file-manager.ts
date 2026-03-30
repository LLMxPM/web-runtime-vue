/**
 * 文件功能：提供 Runtime 独立开发模式下的文件管理中间件，复用统一路径校验与文件访问能力。
 */

import type { Plugin, ViteDevServer } from 'vite'
import { parse as parseMultipart } from 'parse-multipart-data'

import {
  type AllowedDirRule,
  FileAccessError,
  createFileAccessController,
} from './file-access'

interface FileManagerOptions {
  allowedDirs: AllowedDirRule[]
}

/**
 * Vite 文件管理插件。
 * 仅供 Runtime 独立开发模式下的浏览器端编辑功能使用。
 * @param options 目录白名单配置
 * @returns Vite 插件对象
 */
export default function viteFileManager(options?: Partial<FileManagerOptions>): Plugin {
  const defaultOptions: FileManagerOptions = {
    allowedDirs: [
      { path: 'public/config', read: true, write: true, delete: false, upload: false },
      { path: 'public/img', read: true, write: true, delete: true, upload: true },
      { path: 'src/views', read: true, write: true, delete: true, upload: true },
      { path: 'src/components/layout/pagecontainer', read: true, write: false, delete: false, upload: false },
    ],
  }

  const config = { ...defaultOptions, ...options }
  let rootDir = ''

  return {
    name: 'vite-file-manager',
    apply: 'serve',

    configResolved(resolvedConfig) {
      rootDir = resolvedConfig.root
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith('/__file-manager')) {
          return next()
        }

        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
          res.statusCode = 200
          res.end()
          return
        }

        const access = createFileAccessController(rootDir, config.allowedDirs)
        try {
          if (url.startsWith('/__file-manager/list')) {
            const dirPath = getUrlParam(req.url || '', req.headers.host || 'localhost', 'path')
            sendJson(res, { files: access.listDirectory(dirPath) })
            return
          }

          if (url.startsWith('/__file-manager/read')) {
            const filePath = getUrlParam(req.url || '', req.headers.host || 'localhost', 'path')
            sendJson(res, { content: access.readTextFile(filePath), path: filePath })
            return
          }

          if (url.startsWith('/__file-manager/write')) {
            const payload = await readJsonBody(req)
            const result = access.writeTextFile(payload.path, payload.content)
            sendJson(res, { success: true, path: result.path })
            return
          }

          if (url.startsWith('/__file-manager/delete')) {
            const payload = await readJsonBody(req)
            const result = access.deleteFile(payload.path)
            sendJson(res, { success: true, path: result.path })
            return
          }

          if (url.startsWith('/__file-manager/upload')) {
            const payload = await readMultipartBody(req)
            const result = access.writeBinaryFile(payload.path, payload.file, true)
            sendJson(res, { success: true, path: result.path })
            return
          }

          if (url.startsWith('/__file-manager/mkdir')) {
            const payload = await readJsonBody(req)
            const result = access.makeDirectory(payload.path)
            sendJson(res, { success: true, path: result.path })
            return
          }

          if (url.startsWith('/__file-manager/rmdir')) {
            const payload = await readJsonBody(req)
            const result = access.removeDirectory(payload.path, payload.recursive ?? true)
            sendJson(res, { success: true, path: result.path })
            return
          }

          sendJson(res, { error: 'API endpoint not found' }, 404)
        } catch (error) {
          handleError(res, error)
        }
      })
    },
  }
}

/**
 * 从 URL 查询参数中提取指定字段。
 * @param rawUrl 原始 URL
 * @param host 请求主机名
 * @param key 参数名
 * @returns 参数值
 */
function getUrlParam(rawUrl: string, host: string, key: string): string {
  const url = new URL(rawUrl, `http://${host}`)
  return url.searchParams.get(key) || ''
}

/**
 * 读取 JSON 请求体。
 * @param req Node 请求对象
 * @returns 解析后的对象
 */
async function readJsonBody(req: any): Promise<any> {
  const chunks: Buffer[] = []
  await new Promise<void>((resolvePromise, rejectPromise) => {
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolvePromise())
    req.on('error', (error: Error) => rejectPromise(error))
  })

  const rawBody = Buffer.concat(chunks).toString('utf-8')
  return rawBody ? JSON.parse(rawBody) : {}
}

/**
 * 读取 multipart 上传请求。
 * @param req Node 请求对象
 * @returns 上传文件与目标路径
 */
async function readMultipartBody(req: any): Promise<{ path: string; file: Buffer }> {
  const chunks: Buffer[] = []
  await new Promise<void>((resolvePromise, rejectPromise) => {
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolvePromise())
    req.on('error', (error: Error) => rejectPromise(error))
  })

  const buffer = Buffer.concat(chunks)
  const contentType = String(req.headers['content-type'] || '')
  const boundary = contentType.split('boundary=')[1]
  if (!boundary) {
    throw new FileAccessError(400, 'MULTIPART_INVALID', '缺少 multipart boundary。')
  }

  const parts = parseMultipart(buffer, boundary)
  const filePart = parts.find((part) => part.name === 'file')
  const pathPart = parts.find((part) => part.name === 'path')
  if (!filePart || !pathPart) {
    throw new FileAccessError(400, 'MULTIPART_INVALID', '上传请求缺少 file 或 path 字段。')
  }

  return {
    path: pathPart.data.toString('utf-8'),
    file: Buffer.from(filePart.data),
  }
}

/**
 * 输出统一 JSON 响应。
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
 * 将内部异常映射为标准 JSON 错误响应。
 * @param res Node 响应对象
 * @param error 异常对象
 */
function handleError(res: any, error: unknown): void {
  if (error instanceof FileAccessError) {
    sendJson(res, { error: error.message, code: error.code }, error.statusCode)
    return
  }

  const message = error instanceof Error ? error.message : '未知文件服务异常。'
  sendJson(res, { error: message, code: 'FILE_MANAGER_ERROR' }, 500)
}
