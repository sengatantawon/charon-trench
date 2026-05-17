import dotenv from 'dotenv';
dotenv.config();

import { startCharon } from './src/app.js';

startCharon().catch((error) => {
  console.error(error);
  process.exit(1);
});
