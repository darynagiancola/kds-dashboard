import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pagesBasePath = '/kds-dashboard/'
const defaultBasePath = process.env.GITHUB_PAGES === 'true' ? pagesBasePath : '/'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? defaultBasePath,
  plugins: [react(), tailwindcss()],
})
