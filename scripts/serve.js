// Development-only entry point for npm run dev. Serves public/ on localhost.
import { createStaticServer } from './static-server.js';

const port = Number(process.env.PORT || 4173);
createStaticServer().listen(port, '127.0.0.1', () =>
  console.log(
    `Lightning Lens → http://localhost:${port}\nServing public/ locally. Ctrl+C to stop.`,
  ),
);
