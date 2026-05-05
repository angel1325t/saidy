import { createServer } from './server.js';
import { env } from './lib/env.js';

const app = createServer();

app.listen(env.port, () => {
  console.log(`saidy-server running on port ${env.port}`);
});
