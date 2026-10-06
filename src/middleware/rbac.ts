import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, UserRole } from '../types';

export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required prior to RBAC verification.',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Access denied. Role '${req.user.role}' is not authorized to perform this operation. Required role(s): ${allowedRoles.join(', ')}.`,
      });
      return;
    }

    next();
  };
};

