import { defineConfig } from 'vite'

// 部署在 GitHub Pages 子路径 /tower-defense/
export default defineConfig({
  base: '/tower-defense/',
  build: {
    outDir: 'dist',
  },
})
