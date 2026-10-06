import { Router } from 'express';
import { listOrders, getOrderById, createOrder } from '../controllers/orderController';
import { authenticateToken } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

const router = Router();

// Only cutting_supervisor can create cutting orders
router.post('/', authenticateToken, requireRole('cutting_supervisor'), createOrder);

// Orders listing & details
router.get('/', authenticateToken, listOrders);
router.get('/:id', authenticateToken, getOrderById);

export default router;

