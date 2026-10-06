import { app } from './app';
import { config } from './config';

const server = app.listen(config.port, () => {
  console.log(`🚀 ApparelFlow ERP API Server is running on port ${config.port}`);
  console.log(`📡 Health Check: http://localhost:${config.port}/api/health`);
});

export default server;

