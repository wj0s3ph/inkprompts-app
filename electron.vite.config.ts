import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRedistributedPackageAuditPlugin } from './build/redistributed-package-audit.mjs'

const auditDirectory = resolve('.scratch/license-audit')

export default defineConfig({
  main: {
    plugins: [createRedistributedPackageAuditPlugin('main', { auditDirectory })]
  },
  preload: {
    plugins: [createRedistributedPackageAuditPlugin('preload', { auditDirectory })]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      tailwindcss(),
      createRedistributedPackageAuditPlugin('renderer', { auditDirectory })
    ]
  }
})
