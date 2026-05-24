/**
 * 文件用途：Vite 构建配置，启用 Vue 支持与 SaaS 只读预览插件。
 */

import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

import runtimeHealth from './src/core/plugins/runtime-health'
import runtimeBuildRunner from './src/core/plugins/runtime-build-runner'
import runtimeSaaSPreview from './src/core/plugins/runtime-saas-preview'
import runtimeStandalonePreviewGate, {
  resolveStandalonePreviewEnabled,
} from './src/core/plugins/runtime-standalone-preview-gate'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const standalonePreviewEnabled = resolveStandalonePreviewEnabled(env.RUNTIME_STANDALONE_PREVIEW_ENABLED)
  const runtimeServerHost = resolveRuntimeServerHost(env.RUNTIME_SERVER_HOST)
  const runtimeServerPort = resolveRuntimeServerPort(env.RUNTIME_SERVER_PORT)

  return {
    define: {
      __RUNTIME_BACKEND_BUILD__: 'false',
    },
    server: {
      host: runtimeServerHost,
      port: runtimeServerPort,
      strictPort: true,
      cors: true,
    },
    plugins: [
      runtimeHealth(),
      runtimeStandalonePreviewGate({
        enabled: standalonePreviewEnabled,
      }),
      vue(),
      runtimeBuildRunner({
        jwksUrl: env.RUNTIME_PREVIEW_JWKS_URL,
        backendApiBaseUrl: env.RUNTIME_BACKEND_API_BASE_URL,
      }),
      runtimeSaaSPreview({
        jwksUrl: env.RUNTIME_PREVIEW_JWKS_URL,
        backendApiBaseUrl: env.RUNTIME_BACKEND_API_BASE_URL,
        previewAudience: env.RUNTIME_PREVIEW_TOKEN_AUDIENCE,
      })
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@runtime-kit': resolve(__dirname, 'src/runtime-kit'),
        '@components': resolve(__dirname, 'src/components'),
        '@views': resolve(__dirname, 'src/views'),
        '@utils': resolve(__dirname, 'src/utils'),
        '@types': resolve(__dirname, 'src/types'),
        '@styles': resolve(__dirname, 'src/styles')
      }
    },
    css: {
      modules: {
        localsConvention: 'camelCase'
      }
    },
    assetsInclude: ['**/*.drawio'],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/vue/') || id.includes('/node_modules/vue-router/')) {
              return 'vendor'
            }
            return undefined
          }
        }
      }
    },
    base: './'
  }
})

/**
 * 解析 Runtime dev server 监听地址；本地开发默认仅绑定回环地址，容器镜像通过环境变量覆盖为 0.0.0.0。
 * @param rawHost 环境变量原始地址
 * @returns Vite server.host 配置值
 */
export function resolveRuntimeServerHost(rawHost?: string | null): string {
  const normalized = String(rawHost || '').trim()
  return normalized || '127.0.0.1'
}

/**
 * 解析 Runtime dev server 监听端口。
 * @param rawPort 环境变量原始端口
 * @returns Vite server.port 配置值
 */
export function resolveRuntimeServerPort(rawPort?: string | null): number {
  const parsed = Number(String(rawPort || '').trim())
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed
  }
  return 7373
}
