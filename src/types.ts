import { Request } from 'express';

export type UserRole = 'cutting_supervisor' | 'cutting_verifier' | 'sewing_supervisor';

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  full_name: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export type ComponentTrafficStatus = 'MATCH' | 'EXCESS' | 'SHORTAGE'; // GREEN, YELLOW, RED

