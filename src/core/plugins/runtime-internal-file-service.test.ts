/**
 * 文件功能：验证 Runtime 内网文件服务的签名逻辑与路径访问控制。
 */

import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { FileAccessError, createFileAccessController } from './file-access'
import { buildInternalSignature } from './runtime-internal-file-service'

const tempDirs: string[] = []

/**
 * 创建测试用临时目录，并在用例结束后清理。
 * @returns 临时目录绝对路径
 */
function createTempDir(): string {
  const dirPath = mkdtempSync(join(tmpdir(), 'runtime-file-service-'))
  tempDirs.push(dirPath)
  return dirPath
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dirPath) => {
    await rm(dirPath, { recursive: true, force: true })
  }))
})

describe('buildInternalSignature', () => {
  it('应基于方法、路径、时间戳、nonce 和 body 生成稳定签名', () => {
    const signature = buildInternalSignature(
      'shared-secret',
      'POST',
      '/__runtime_internal/v1/files/batch-upload',
      '1711111111',
      'nonce-1',
      Buffer.from('{"hello":"world"}', 'utf-8'),
    )

    expect(signature).toBe('bdcf9f2024cd667b4196c212ec68d15ef154f20ca74f23712630e7004579942e')
  })
})

describe('createFileAccessController', () => {
  it('应允许对白名单内文件进行读写', () => {
    const rootDir = createTempDir()
    mkdirSync(join(rootDir, 'src/views'), { recursive: true })
    const access = createFileAccessController(rootDir, [
      { path: 'src/views', read: true, write: true, delete: true, upload: true },
    ])

    const writeResult = access.writeTextFile('src/views/demo.vue', '<template />')
    const content = readFileSync(join(rootDir, 'src/views/demo.vue'), 'utf-8')

    expect(writeResult.fileName).toBe('demo.vue')
    expect(content).toBe('<template />')
    expect(access.readTextFile('src/views/demo.vue')).toBe('<template />')
  })

  it('应拒绝使用前缀碰撞访问白名单外目录', () => {
    const rootDir = createTempDir()
    mkdirSync(join(rootDir, 'src/views-malicious'), { recursive: true })
    const access = createFileAccessController(rootDir, [
      { path: 'src/views', read: true, write: true, delete: true, upload: true },
    ])

    expect(() => access.readTextFile('src/views-malicious/evil.vue')).toThrowError(FileAccessError)
  })

  it('应拒绝通过父目录跳转越过根目录', () => {
    const rootDir = createTempDir()
    const access = createFileAccessController(rootDir, [
      { path: 'src/views', read: true, write: true, delete: true, upload: true },
    ])

    expect(() => access.writeTextFile('src/views/../secrets.txt', 'oops')).toThrowError(FileAccessError)
  })

  it('应拒绝借助符号链接逃逸到根目录外', () => {
    const rootDir = createTempDir()
    const outsideDir = createTempDir()
    mkdirSync(join(rootDir, 'src'), { recursive: true })
    mkdirSync(join(outsideDir, 'views'), { recursive: true })
    symlinkSync(join(outsideDir, 'views'), join(rootDir, 'src/views'), 'junction')

    const access = createFileAccessController(rootDir, [
      { path: 'src/views', read: true, write: true, delete: true, upload: true },
    ])

    expect(() => access.writeTextFile('src/views/escape.vue', '<template />')).toThrowError(FileAccessError)
  })

  it('应支持写入二进制文件并返回内容哈希', () => {
    const rootDir = createTempDir()
    mkdirSync(join(rootDir, 'public/img'), { recursive: true })
    const access = createFileAccessController(rootDir, [
      { path: 'public/img', read: true, write: true, delete: true, upload: true },
    ])

    const result = access.writeBinaryFile('public/img/demo.txt', Buffer.from('hello', 'utf-8'))
    expect(result.path).toBe('public/img/demo.txt')
    expect(readFileSync(join(rootDir, 'public/img/demo.txt'), 'utf-8')).toBe('hello')
  })
})
