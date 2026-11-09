import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    {
      name: 'route-complete-presentation',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/complete' || req.url === '/complete/') {
            req.url = '/complete.html';
          }
          next();
        });
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        complete: resolve(__dirname, 'complete.html')
      }
    }
  }
});
