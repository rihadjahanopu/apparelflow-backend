import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/apparelflow_erp?schema=public';

const useSsl =
  connectionString.includes('sslmode=require') ||
  connectionString.includes('supabase.co') ||
  connectionString.includes('neon.tech') ||
  process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
export { pool };
