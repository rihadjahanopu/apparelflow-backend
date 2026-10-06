import { Router } from 'express';
import { getSewingQueue, startSewing } from '../controllers/sewingController';
import { authenticateToken } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

const router = Router();

// All sewing operations strictly require sewing_supervisor role
router.get('/queue', authenticateToken, requireRole('sewing_supervisor'), getSewingQueue);
router.post('/start/:id', authenticateToken, requireRole('sewing_supervisor'), startSewing);

export default router;

