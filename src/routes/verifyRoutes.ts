import { Router } from 'express';
import {
  updateComponentCounts,
  approveOrder,
  rejectOrder,
} from '../controllers/verifyController';
import { authenticateToken } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

const router = Router();

// All verification actions strictly require cutting_verifier role
router.put('/:id/items', authenticateToken, requireRole('cutting_verifier'), updateComponentCounts);
router.post('/:id/approve', authenticateToken, requireRole('cutting_verifier'), approveOrder);
router.post('/:id/reject', authenticateToken, requireRole('cutting_verifier'), rejectOrder);

export default router;

