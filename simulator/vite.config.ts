import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import qrcode from 'qrcode-terminal'

function qrcodeMobilePlugin(): Plugin {
  return {
    name: 'vite-plugin-qrcode-mobile',
    apply: 'serve',
    configureServer(server) {
      const originalPrintUrls = server.printUrls.bind(server)
      server.printUrls = () => {
        originalPrintUrls()
        const targetUrl =
          server.resolvedUrls?.network?.[0] || server.resolvedUrls?.local?.[0]
        if (targetUrl) {
          console.log('\n  Mobile Testing — QR Code :\n')
          qrcode.generate(targetUrl, { small: true }, (code: string) => {
            const formatted = code
              .split('\n')
              .map((line: string) => `  ${line}`)
              .join('\n')
            console.log(formatted)
          })
          console.log(`  Scannez pour tester sur mobile : ${targetUrl}\n`)
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [vue(), qrcodeMobilePlugin()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: {
    format: 'es',
  },
})
