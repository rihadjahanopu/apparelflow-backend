import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthenticatedRequest, AuthUser } from '../types';
import { prisma } from '../db';

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication token missing or invalid.',
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthUser;

    // Verify user existence in database and self-heal if DB was reseeded
    let dbUser = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!dbUser && decoded.email) {
      dbUser = await prisma.user.findUnique({ where: { email: decoded.email } });
    }

    if (!dbUser) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User session invalid or user record not found in database. Please log in again.',
      });
      return;
    }

    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role as any,
      full_name: dbUser.full_name,
    };
    next();
  } catch (error) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid or expired authentication token.',
    });
    return;
  }
};

