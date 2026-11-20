import path from 'node:path';
import { config } from '../config.js';
import { createDashboardApp } from './app.js';

const port = Number(process.env.DASHBOARD_PORT || 3003);
const host = process.env.DASHBOARD_HOST || '0.0.0.0';
const dbPath = process.env.DATABASE_PATH || path.resolve(path.dirname(config.databasePath), 'divide.sqlite');
const environmentLabel = process.env.DASHBOARD_ENV || 'production';

const app = createDashboardApp({ dbPath, environmentLabel, port });

app.listen(port, host, () => {
  console.log(`📊 Dividindin Analytics Dashboard (${environmentLabel}) listening on http://${host}:${port}`);
  console.log(`🔒 Tailscale URL: http://staging.example.ts.net:${port}`);
  console.log(`🗄️  Read-only DB: ${dbPath}`);
});
