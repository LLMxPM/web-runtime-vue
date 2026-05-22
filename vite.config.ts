/**
 * 文件用途：Vite 构建配置，启用 Vue 支持与 SaaS 只读预览插件。
 */

import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

import runtimeBuildRunner from './src/core/plugins/runtime-build-runner'
import runtimeSaaSPreview from './src/core/plugins/runtime-saas-preview'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')

  return {
    server: {
      host: '127.0.0.1',
      port: 7373,
      strictPort: true,
      cors: true,
    },
    plugins: [
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
          manualChunks: {
            vendor: ['vue', 'vue-router']
          }
        }
      }
    },
    base: './'
  }
})
