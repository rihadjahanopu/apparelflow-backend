import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 4000,
  jwtSecret: process.env.JWT_SECRET || 'apparelflow-super-secret-enterprise-jwt-key-2026',
  nodeEnv: process.env.NODE_ENV || 'development',
};

