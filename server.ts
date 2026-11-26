import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './server/routes';

const isProduction = process.env.NODE_ENV === 'production';
const PORT = isProduction ? Number(process.env.PORT || 3000) : Number(process.env.SCHOLARGRID_PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api', createApiRouter());

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ScholarGrid Local Administration Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
