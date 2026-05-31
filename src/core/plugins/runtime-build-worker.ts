/**
 * 文件用途：隔离 Runtime 构建阶段的 Vite/Rollup 执行，避免构建 OOM 直接终止 Runtime 主进程。
 */

import { spawn } from 'child_process'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

const DEFAULT_WORKER_MAX_OLD_SPACE_MB = 8192
const DEFAULT_WORKER_TIMEOUT_MS = 600000
const MAX_CAPTURED_OUTPUT_LENGTH = 12000

export interface RuntimeBuildWorkerRunOptions {
  tempRoot: string
  base: string
  mode: 'project' | 'diagnostics'
  outDir?: string
  maxOldSpaceMb?: number
  timeoutMs?: number
  workerScriptSource?: string
}

interface RuntimeBuildWorkerInput {
  tempRoot: string
  base: string
  mode: 'project' | 'diagnostics'
  outDir?: string
}

interface SerializedWorkerError {
  name?: string
  message?: string
  stack?: string
  id?: string
  plugin?: string
  code?: string
  loc?: {
    file?: string
    line?: number
    column?: number
  }
}

interface RuntimeBuildWorkerOutput {
  success: boolean
  error?: SerializedWorkerError
}

interface RuntimeBuildWorkerExit {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * Runtime 构建 worker 进程错误。
 */
export class RuntimeBuildWorkerProcessError extends Error {
  statusCode: number
  code: string
  stdout?: string
  stderr?: string

  constructor(statusCode: number, code: string, message: string, output?: { stdout?: string; stderr?: string }) {
    super(message)
    this.name = 'RuntimeBuildWorkerProcessError'
    this.statusCode = statusCode
    this.code = code
    this.stdout = output?.stdout
    this.stderr = output?.stderr
  }
}

/**
 * Runtime 构建 worker 中捕获到的 Vite 构建错误。
 */
export class RuntimeBuildWorkerViteError extends Error {
  code: string
  id?: string
  plugin?: string
  loc?: {
    file?: string
    line?: number
    column?: number
  }

  constructor(payload: SerializedWorkerError) {
    super(String(payload.message || 'Runtime Vite 构建失败。'))
    this.name = String(payload.name || 'RuntimeBuildWorkerViteError')
    this.stack = payload.stack
    this.code = String(payload.code || 'RUNTIME_VITE_COMPILE_FAILED')
    this.id = payload.id
    this.plugin = payload.plugin
    this.loc = payload.loc
  }
}

/**
 * 在子进程中执行 Runtime Vite 构建。
 * @param options worker 执行参数
 */
export async function runRuntimeViteBuildInWorker(options: RuntimeBuildWorkerRunOptions): Promise<void> {
  const tempRoot = resolve(options.tempRoot)
  const inputPath = resolve(tempRoot, '__runtime_build_worker_input.json')
  const outputPath = resolve(tempRoot, '__runtime_build_worker_output.json')
  const workerScriptPath = resolve(tempRoot, '__runtime_build_worker.mjs')
  const workerInput: RuntimeBuildWorkerInput = {
    tempRoot,
    base: options.base,
    mode: options.mode,
    outDir: options.outDir ? resolve(options.outDir) : undefined,
  }

  await writeFile(inputPath, JSON.stringify(workerInput), 'utf-8')
  await writeFile(workerScriptPath, options.workerScriptSource || createRuntimeBuildWorkerScript(), 'utf-8')

  let exit: RuntimeBuildWorkerExit
  try {
    exit = await spawnRuntimeBuildWorker({
      workerScriptPath,
      inputPath,
      outputPath,
      cwd: tempRoot,
      maxOldSpaceMb: normalizeWorkerMaxOldSpaceMb(options.maxOldSpaceMb),
      timeoutMs: normalizeWorkerTimeoutMs(options.timeoutMs),
    })
  } catch (error) {
    throw new RuntimeBuildWorkerProcessError(
      500,
      'RUNTIME_BUILD_WORKER_FAILED',
      error instanceof Error ? error.message : 'Runtime 构建 worker 启动失败。',
    )
  }
  const output = await readWorkerOutput(outputPath)

  if (output?.success) {
    return
  }
  if (output?.error) {
    throw new RuntimeBuildWorkerViteError(output.error)
  }
  throw buildWorkerProcessError(exit)
}

/**
 * 解析 worker 进程堆内存上限。
 * @param explicitValue 显式传入值
 * @returns MB 数
 */
export function normalizeWorkerMaxOldSpaceMb(explicitValue?: number): number {
  return normalizePositiveInteger(
    explicitValue,
    process.env.RUNTIME_BUILD_WORKER_MAX_OLD_SPACE_MB,
    DEFAULT_WORKER_MAX_OLD_SPACE_MB,
  )
}

/**
 * 解析 worker 进程超时时间。
 * @param explicitValue 显式传入值
 * @returns 毫秒数
 */
export function normalizeWorkerTimeoutMs(explicitValue?: number): number {
  return normalizePositiveInteger(
    explicitValue,
    process.env.RUNTIME_BUILD_WORKER_TIMEOUT_MS,
    DEFAULT_WORKER_TIMEOUT_MS,
  )
}

/**
 * 判断 worker 退出信息是否符合 Node/V8 OOM 特征。
 * @param stderr 标准错误输出
 * @param exitCode 进程退出码
 * @returns 是否为 OOM 失败
 */
export function isRuntimeBuildWorkerOomFailure(stderr: string, exitCode?: number | null): boolean {
  const normalizedStderr = String(stderr || '').toLowerCase()
  return exitCode === 134
    || normalizedStderr.includes('javascript heap out of memory')
    || normalizedStderr.includes('ineffective mark-compacts near heap limit')
    || normalizedStderr.includes('allocation failed')
}

/**
 * 生成可被 Node 直接执行的构建 worker 脚本。
 * @returns ESM worker 脚本文本
 */
export function createRuntimeBuildWorkerScript(): string {
  return [
    '/**',
    ' * 文件用途：Runtime 临时构建 worker，在独立 Node 进程内执行 Vite/Rollup 构建。',
    ' */',
    "import { readFile, writeFile } from 'node:fs/promises'",
    "import { resolve } from 'node:path'",
    "import { build as viteBuild } from 'vite'",
    "import vue from '@vitejs/plugin-vue'",
    "import tailwindcss from 'tailwindcss'",
    "import autoprefixer from 'autoprefixer'",
    '',
    'function buildRuntimeBuildCssConfig(tempRoot) {',
    '  return {',
    '    modules: { localsConvention: "camelCase" },',
    '    postcss: {',
    '      plugins: [',
    '        tailwindcss(resolve(tempRoot, "tailwind.config.js")),',
    '        autoprefixer(),',
    '      ],',
    '    },',
    '  }',
    '}',
    '',
    'function serializeError(error) {',
    '  return {',
    '    name: error?.name,',
    '    message: String(error?.message || error || "Runtime Vite 构建失败。"),',
    '    stack: error?.stack,',
    '    id: error?.id,',
    '    plugin: error?.plugin,',
    '    code: error?.code,',
    '    loc: error?.loc ? {',
    '      file: error.loc.file,',
    '      line: error.loc.line,',
    '      column: error.loc.column,',
    '    } : undefined,',
    '  }',
    '}',
    '',
    'function createBuildOptions(input) {',
    '  const tempRoot = input.tempRoot',
    '  const buildOptions = {',
    '    emptyOutDir: false,',
    '    sourcemap: false,',
    '    rollupOptions: {',
    '      output: {',
    '        manualChunks(id) {',
    '          if (id.includes("/node_modules/vue/") || id.includes("/node_modules/vue-router/")) {',
    '            return "vendor"',
    '          }',
    '          return undefined',
    '        },',
    '      },',
    '    },',
    '  }',
    '  if (input.mode === "diagnostics") {',
    '    buildOptions.write = false',
    '  } else {',
    '    buildOptions.outDir = input.outDir',
    '  }',
    '  return {',
    '    configFile: false,',
    '    root: tempRoot,',
    '    base: input.base,',
    '    define: { __RUNTIME_BACKEND_BUILD__: "true" },',
    '    plugins: [vue()],',
    '    assetsInclude: ["**/*.drawio"],',
    '    resolve: {',
    '      alias: {',
    '        "@": resolve(tempRoot, "src"),',
    '        "@runtime-kit": resolve(tempRoot, "src/runtime-kit"),',
    '        "@components": resolve(tempRoot, "src/components"),',
    '        "@views": resolve(tempRoot, "src/views"),',
    '        "@workspace-components": resolve(tempRoot, "src/workspace-components"),',
    '        "@utils": resolve(tempRoot, "src/utils"),',
    '        "@types": resolve(tempRoot, "src/types"),',
    '        "@styles": resolve(tempRoot, "src/styles"),',
    '      },',
    '      extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json", ".vue"],',
    '    },',
    '    css: buildRuntimeBuildCssConfig(tempRoot),',
    '    build: buildOptions,',
    '  }',
    '}',
    '',
    'async function main() {',
    '  const inputPath = process.argv[2]',
    '  const outputPath = process.argv[3]',
    '  const input = JSON.parse(await readFile(inputPath, "utf-8"))',
    '  try {',
    '    await viteBuild(createBuildOptions(input))',
    '    await writeFile(outputPath, JSON.stringify({ success: true }), "utf-8")',
    '  } catch (error) {',
    '    await writeFile(outputPath, JSON.stringify({ success: false, error: serializeError(error) }), "utf-8")',
    '    process.exitCode = 1',
    '  }',
    '}',
    '',
    'await main()',
    '',
  ].join('\n')
}

interface SpawnRuntimeBuildWorkerOptions {
  workerScriptPath: string
  inputPath: string
  outputPath: string
  cwd: string
  maxOldSpaceMb: number
  timeoutMs: number
}

/**
 * 启动 Node worker 进程并等待退出。
 * @param options 进程参数
 * @returns 退出摘要
 */
function spawnRuntimeBuildWorker(options: SpawnRuntimeBuildWorkerOptions): Promise<RuntimeBuildWorkerExit> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      `--max-old-space-size=${options.maxOldSpaceMb}`,
      options.workerScriptPath,
      options.inputPath,
      options.outputPath,
    ], {
      cwd: options.cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timeoutHandle = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMs)

    child.stdout.on('data', chunk => {
      stdout = appendCapturedOutput(stdout, chunk)
    })
    child.stderr.on('data', chunk => {
      stderr = appendCapturedOutput(stderr, chunk)
    })
    child.on('error', error => {
      clearTimeout(timeoutHandle)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle)
      resolve({ code, signal, stdout, stderr, timedOut })
    })
  })
}

/**
 * 读取 worker 写出的结构化结果。
 * @param outputPath 输出文件路径
 * @returns worker 输出；文件不存在时返回 null
 */
async function readWorkerOutput(outputPath: string): Promise<RuntimeBuildWorkerOutput | null> {
  try {
    return JSON.parse(await readFile(outputPath, 'utf-8')) as RuntimeBuildWorkerOutput
  } catch {
    return null
  }
}

/**
 * 根据 worker 退出信息构建主进程可处理的错误。
 * @param exit worker 退出摘要
 * @returns 结构化错误
 */
function buildWorkerProcessError(exit: RuntimeBuildWorkerExit): RuntimeBuildWorkerProcessError {
  const output = { stdout: exit.stdout, stderr: exit.stderr }
  if (exit.timedOut) {
    return new RuntimeBuildWorkerProcessError(
      504,
      'RUNTIME_BUILD_WORKER_TIMEOUT',
      'Runtime 构建 worker 执行超时。',
      output,
    )
  }
  if (isRuntimeBuildWorkerOomFailure(exit.stderr, exit.code)) {
    return new RuntimeBuildWorkerProcessError(
      500,
      'RUNTIME_BUILD_WORKER_OOM',
      'Runtime 构建 worker 内存不足或被 V8 终止。',
      output,
    )
  }
  return new RuntimeBuildWorkerProcessError(
    500,
    'RUNTIME_BUILD_WORKER_FAILED',
    `Runtime 构建 worker 异常退出：exitCode=${exit.code ?? 'null'} signal=${exit.signal ?? 'null'}。`,
    output,
  )
}

/**
 * 追加并裁剪子进程输出，避免异常日志占用过多主进程内存。
 * @param current 当前已捕获输出
 * @param chunk 新输出
 * @returns 裁剪后的输出
 */
function appendCapturedOutput(current: string, chunk: unknown): string {
  const next = current + String(chunk || '')
  if (next.length <= MAX_CAPTURED_OUTPUT_LENGTH) {
    return next
  }
  return next.slice(next.length - MAX_CAPTURED_OUTPUT_LENGTH)
}

/**
 * 解析正整数配置。
 * @param explicitValue 显式值
 * @param rawEnv 环境变量值
 * @param fallback 默认值
 * @returns 正整数
 */
function normalizePositiveInteger(explicitValue: number | undefined, rawEnv: string | undefined, fallback: number): number {
  const explicit = Number(explicitValue)
  if (Number.isInteger(explicit) && explicit > 0) {
    return explicit
  }

  const fromEnv = Number(String(rawEnv || '').trim())
  if (Number.isInteger(fromEnv) && fromEnv > 0) {
    return fromEnv
  }

  return fallback
}
