import { defineConfig } from 'drizzle-kit';
import { loadDotenv } from './src/core/config/dotenv.js';
import { resolveStoragePaths } from './src/core/config/index.js';

loadDotenv();

const { dbFile } = resolveStoragePaths(process.env.STORAGE_ROOT || './storage');

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/core/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: dbFile,
  },
});
