import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../types';
import { calculateWastage } from '../services/gatekeeperService';

/**
 * Sewing supervisor queue:
 * STRICT RULE: Only orders with status = 'VERIFIED' are accessible.
 * Unverified, pending, rejected, or completed orders are strictly excluded from the queue.
 */
export const getSewingQueue = async (
  _req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const orders = await prisma.cuttingOrder.findMany({
      where: {
        status: 'VERIFIED',
      },
      include: {
        recipe: {
          include: {
            recipe_components: true,
          },
        },
        creator: {
          select: { id: true, full_name: true, email: true },
        },
        verification_items: {
          include: {
            component: true,
          },
        },
        verification_logs: {
          include: {
            verifier: {
              select: { id: true, full_name: true, email: true },
            },
          },
          orderBy: { timestamp: 'desc' },
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    const queue = orders.map((order) => {
      const wastage = calculateWastage(
        order.target_qty,
        order.recipe.std_fabric_yards,
        order.actual_fabric_yds,
        order.recipe.wastage_cap
      );

      const latestApprovalLog = order.verification_logs.find((log) => log.decision === 'APPROVED');

      return {
        ...order,
        wastage,
        latestApprovalLog,
      };
    });

    res.json({ queue });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

/**
 * Sewing floor action: Transition order from 'VERIFIED' to 'IN_SEWING'.
 */
export const startSewing = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid order ID.' });
      return;
    }

    const order = await prisma.cuttingOrder.findUnique({
      where: { id },
    });

    if (!order) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
      return;
    }

    if (order.status !== 'VERIFIED') {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: `Cannot start sewing on order with status '${order.status}'. Order must be VERIFIED by gatekeeper first.`,
      });
      return;
    }

    const updated = await prisma.cuttingOrder.update({
      where: { id },
      data: {
        status: 'IN_SEWING',
      },
    });

    res.json({
      message: `Batch ${order.order_no} released to active sewing assembly line.`,
      order: updated,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

