import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // El backend (/server/.env.example) documenta PORT=4000. Si cambia en
      // tu entorno local, actualiza este valor (o usa VITE_API_URL en su
      // lugar y quita este proxy).
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
