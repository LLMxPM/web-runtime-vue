/**
 * 文件用途：验证 Runtime 构建 worker 的子进程隔离、错误识别与超时处理。
 */

import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import {
  createRuntimeBuildWorkerScript,
  isRuntimeBuildWorkerOomFailure,
  normalizeWorkerMaxOldSpaceMb,
  normalizeWorkerTimeoutMs,
  runRuntimeViteBuildInWorker,
} from './runtime-build-worker'

describe('runtime build worker', () => {
  it('应生成包含 Vite 构建配置的 worker 脚本', () => {
    const source = createRuntimeBuildWorkerScript()

    expect(source).toContain("import { build as viteBuild } from 'vite'")
    expect(source).toContain('tailwindcss(resolve(tempRoot, "tailwind.config.js"))')
    expect(source).toContain('__RUNTIME_BACKEND_BUILD__')
    expect(source).toContain('input.mode === "diagnostics"')
  })

  it('应按默认值和显式值解析 worker 资源限制', () => {
    const originalMaxOldSpaceMb = process.env.RUNTIME_BUILD_WORKER_MAX_OLD_SPACE_MB
    const originalTimeoutMs = process.env.RUNTIME_BUILD_WORKER_TIMEOUT_MS
    try {
      delete process.env.RUNTIME_BUILD_WORKER_MAX_OLD_SPACE_MB
      delete process.env.RUNTIME_BUILD_WORKER_TIMEOUT_MS

      expect(normalizeWorkerMaxOldSpaceMb()).toBe(8192)
      expect(normalizeWorkerMaxOldSpaceMb(4096)).toBe(4096)
      expect(normalizeWorkerTimeoutMs()).toBe(600000)
      expect(normalizeWorkerTimeoutMs(1000)).toBe(1000)

      process.env.RUNTIME_BUILD_WORKER_MAX_OLD_SPACE_MB = '6144'
      process.env.RUNTIME_BUILD_WORKER_TIMEOUT_MS = '300000'
      expect(normalizeWorkerMaxOldSpaceMb()).toBe(6144)
      expect(normalizeWorkerTimeoutMs()).toBe(300000)
    } finally {
      restoreEnvValue('RUNTIME_BUILD_WORKER_MAX_OLD_SPACE_MB', originalMaxOldSpaceMb)
      restoreEnvValue('RUNTIME_BUILD_WORKER_TIMEOUT_MS', originalTimeoutMs)
    }
  })

  it('应识别 Node/V8 OOM 退出特征', () => {
    expect(isRuntimeBuildWorkerOomFailure('FATAL ERROR: JavaScript heap out of memory', null)).toBe(true)
    expect(isRuntimeBuildWorkerOomFailure('Ineffective mark-compacts near heap limit', null)).toBe(true)
    expect(isRuntimeBuildWorkerOomFailure('', 134)).toBe(true)
    expect(isRuntimeBuildWorkerOomFailure('normal failure', 1)).toBe(false)
  })

  it('worker 成功写出结果时应正常返回', async () => {
    const tempRoot = await createWorkerFixture()
    try {
      await expect(runRuntimeViteBuildInWorker({
        tempRoot,
        base: './',
        mode: 'diagnostics',
        workerScriptSource: createResultScript('{ success: true }'),
      })).resolves.toBeUndefined()
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('worker 写出 Vite 错误时应保留插件、文件与行列信息', async () => {
    const tempRoot = await createWorkerFixture()
    try {
      await expect(runRuntimeViteBuildInWorker({
        tempRoot,
        base: './',
        mode: 'diagnostics',
        workerScriptSource: createResultScript(`{
          success: false,
          error: {
            name: 'RollupError',
            message: '编译失败',
            plugin: 'vite:vue',
            code: 'PLUGIN_ERROR',
            id: 'src/views/Page.vue?vue&type=script',
            loc: { file: 'src/views/Page.vue', line: 2, column: 3 }
          }
        }`, 1),
      })).rejects.toMatchObject({
        name: 'RollupError',
        message: '编译失败',
        plugin: 'vite:vue',
        code: 'PLUGIN_ERROR',
        id: 'src/views/Page.vue?vue&type=script',
        loc: { file: 'src/views/Page.vue', line: 2, column: 3 },
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('worker 非零退出且无结构化结果时应返回 worker failed 错误', async () => {
    const tempRoot = await createWorkerFixture()
    try {
      await expect(runRuntimeViteBuildInWorker({
        tempRoot,
        base: './',
        mode: 'project',
        outDir: join(tempRoot, 'dist'),
        workerScriptSource: 'process.exit(7)',
      })).rejects.toMatchObject({
        code: 'RUNTIME_BUILD_WORKER_FAILED',
        statusCode: 500,
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('worker OOM stderr 应转为 OOM 错误码', async () => {
    const tempRoot = await createWorkerFixture()
    try {
      await expect(runRuntimeViteBuildInWorker({
        tempRoot,
        base: './',
        mode: 'diagnostics',
        workerScriptSource: [
          "console.error('FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory')",
          'process.exit(134)',
        ].join('\n'),
      })).rejects.toMatchObject({
        code: 'RUNTIME_BUILD_WORKER_OOM',
        statusCode: 500,
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('worker 超时应终止并返回 timeout 错误码', async () => {
    const tempRoot = await createWorkerFixture()
    try {
      await expect(runRuntimeViteBuildInWorker({
        tempRoot,
        base: './',
        mode: 'diagnostics',
        timeoutMs: 20,
        workerScriptSource: 'setInterval(() => {}, 1000)',
      })).rejects.toMatchObject({
        code: 'RUNTIME_BUILD_WORKER_TIMEOUT',
        statusCode: 504,
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})

/**
 * 创建 worker 测试临时目录。
 * @returns 临时目录
 */
async function createWorkerFixture(): Promise<string> {
  return mkdtemp(join(os.tmpdir(), 'runtime-build-worker-test-'))
}

/**
 * 创建写出结构化结果的测试 worker 脚本。
 * @param resultExpression 结果对象表达式
 * @param exitCode 退出码
 * @returns ESM 脚本文本
 */
function createResultScript(resultExpression: string, exitCode = 0): string {
  return [
    "import { writeFile } from 'node:fs/promises'",
    `await writeFile(process.argv[3], JSON.stringify(${resultExpression}), 'utf-8')`,
    `process.exitCode = ${exitCode}`,
    '',
  ].join('\n')
}

/**
 * 恢复测试期间修改过的环境变量。
 * @param key 环境变量名
 * @param value 原始值
 */
function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
