import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { loadEnv } from 'vite'
import runtimeInternalFileService from './src/core/plugins/runtime-internal-file-service'
import runtimePreviewGateway from './src/core/plugins/runtime-preview-gateway'
import viteFileManager from './src/core/plugins/vite-file-manager'

const allowedDirs = [
  { path: 'public/config', read: true, write: true, delete: false, upload: false },
  { path: 'public/img', read: true, write: true, delete: true, upload: true },
  { path: 'src/views', read: true, write: true, delete: true, upload: true },
  { path: 'src/components/layout/pagecontainer', read: true, write: false, delete: false, upload: false },
  { path: 'public/fonts', read: true, write: true, delete: true, upload: true },
  { path: 'src/styles', read: true, write: true, delete: false, upload: false }
]

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')

  return {
    server: {
      host: '127.0.0.1',
      port: 7373
    },
    plugins: [
      vue(),
      runtimePreviewGateway({
        sharedSecret: env.RUNTIME_SHARED_SECRET,
      }),
      runtimeInternalFileService({
        allowedDirs,
        sharedSecret: env.RUNTIME_SHARED_SECRET,
      }),
      ...(env.RUNTIME_PLATFORM_MODE === 'true'
        ? []
        : [viteFileManager({
          allowedDirs,
        })]), // 文件管理插件（仅独立开发模式）
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
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
