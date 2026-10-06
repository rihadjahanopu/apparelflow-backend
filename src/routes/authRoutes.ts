import { Router } from 'express';
import { login, register, getMe, getDemoUsers, switchDemoRole, updateProfile } from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.post('/login', login);
router.post('/register', register);
router.get('/me', authenticateToken, getMe);
router.put('/profile', authenticateToken, updateProfile);
router.get('/demo-users', getDemoUsers);
router.post('/demo-switch', switchDemoRole);

export default router;

