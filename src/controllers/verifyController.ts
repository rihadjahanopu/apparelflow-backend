import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../types';
import {
  calculateWastage,
  evaluateComponentStatus,
  evaluateGatekeeper,
} from '../services/gatekeeperService';

/**
 * Verifier terminal: Updates actual physical piece counts for components.
 * Automatically recalculates GREEN/YELLOW/RED status for each item.
 */
export const updateComponentCounts = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid order ID.' });
      return;
    }

    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Payload must contain a non-empty array of item counts.',
      });
      return;
    }

    // Validate each item
    for (const item of items) {
      if (typeof item.component_id !== 'number') {
        res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'Each item must specify a numeric component_id.',
        });
        return;
      }
      if (
        typeof item.actual_qty !== 'number' ||
        item.actual_qty < 0 ||
        !Number.isInteger(item.actual_qty)
      ) {
        res.status(400).json({
          error: 'BAD_REQUEST',
          message: `Invalid actual_qty for component ${item.component_id}. Must be a non-negative integer.`,
        });
        return;
      }
    }

    const order = await prisma.cuttingOrder.findUnique({
      where: { id },
      include: {
        verification_items: {
          include: { component: true },
        },
      },
    });

    if (!order) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
      return;
    }

    // Update each verification item
    for (const item of items) {
      const existing = order.verification_items.find((vi) => vi.component_id === item.component_id);
      if (existing) {
        const status = evaluateComponentStatus(existing.expected_qty, item.actual_qty);
        await prisma.verificationItem.update({
          where: { id: existing.id },
          data: {
            actual_qty: item.actual_qty,
            status,
          },
        });
      }
    }

    const refreshedOrder = await prisma.cuttingOrder.findUnique({
      where: { id },
      include: {
        recipe: { include: { recipe_components: true } },
        verification_items: { include: { component: true } },
      },
    });

    res.json({
      message: 'Component counts updated successfully.',
      order: refreshedOrder,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

/**
 * Verifier terminal: Approves batch and releases to sewing.
 * STRICT HARD-STOP: If any component has RED status (actual < expected),
 * the server rejects with HTTP 422 Unprocessable Entity!
 */
export const approveOrder = async (
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
      include: {
        recipe: { include: { recipe_components: true } },
        verification_items: { include: { component: true } },
      },
    });

    if (!order) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
      return;
    }

    // Hard-Stop Gatekeeper Check
    const itemsForEvaluation = order.verification_items.map((vi) => ({
      component_id: vi.component_id,
      component_name: vi.component.component_name,
      expected_qty: vi.expected_qty,
      actual_qty: vi.actual_qty,
    }));

    const gatekeeperResult = evaluateGatekeeper(itemsForEvaluation);

    if (!gatekeeperResult.canApprove) {
      // 422 Unprocessable Entity Hard-Stop!
      res.status(422).json({
        error: 'UNPROCESSABLE_ENTITY',
        message: 'Gatekeeper Hard-Stop Violation: Cannot approve cutting batch with component shortages (RED traffic light status). All parts must match or exceed recipe BOM requirements.',
        shortages: gatekeeperResult.shortages,
      });
      return;
    }

    // Compute fabric wastage
    const wastage = calculateWastage(
      order.target_qty,
      order.recipe.std_fabric_yards,
      order.actual_fabric_yds,
      order.recipe.wastage_cap
    );

    // Update order status to VERIFIED
    const updatedOrder = await prisma.cuttingOrder.update({
      where: { id },
      data: {
        status: 'VERIFIED',
      },
    });

    // Defensive verifier ID resolution
    let verifier_id = req.user?.id;
    const userRecord = verifier_id ? await prisma.user.findUnique({ where: { id: verifier_id } }) : null;
    if (!userRecord && req.user?.email) {
      const fallbackUser = await prisma.user.findUnique({ where: { email: req.user.email } });
      if (fallbackUser) {
        verifier_id = fallbackUser.id;
      }
    }

    if (!verifier_id) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Verifier record not found in database. Please log in again.' });
      return;
    }

    // Create immutable audit log
    const verificationLog = await prisma.verificationLog.create({
      data: {
        order_id: id,
        verifier_id,
        decision: 'APPROVED',
        rejection_note: null,
        wastage_pct: wastage.wastagePct,
      },
      include: {
        verifier: {
          select: { id: true, full_name: true, email: true },
        },
      },
    });

    res.json({
      message: 'Batch successfully verified and released to Sewing Assembly Queue.',
      order: updatedOrder,
      log: verificationLog,
      wastage,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

/**
 * Verifier terminal: Rejects batch back to Cutting Supervisor.
 * Rejection note is strictly mandatory!
 */
export const rejectOrder = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid order ID.' });
      return;
    }

    const { rejection_note } = req.body;

    // Mandatory rejection note check
    if (!rejection_note || typeof rejection_note !== 'string' || rejection_note.trim().length === 0) {
      res.status(422).json({
        error: 'UNPROCESSABLE_ENTITY',
        message: 'Rejection requires a mandatory audit note explaining defects, shortages, or reasons for rejection.',
      });
      return;
    }

    const order = await prisma.cuttingOrder.findUnique({
      where: { id },
      include: {
        recipe: true,
      },
    });

    if (!order) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
      return;
    }

    const wastage = calculateWastage(
      order.target_qty,
      order.recipe.std_fabric_yards,
      order.actual_fabric_yds,
      order.recipe.wastage_cap
    );

    // Update order status to REJECTED
    const updatedOrder = await prisma.cuttingOrder.update({
      where: { id },
      data: {
        status: 'REJECTED',
      },
    });

    // Defensive verifier ID resolution
    let verifier_id = req.user?.id;
    const userRecord = verifier_id ? await prisma.user.findUnique({ where: { id: verifier_id } }) : null;
    if (!userRecord && req.user?.email) {
      const fallbackUser = await prisma.user.findUnique({ where: { email: req.user.email } });
      if (fallbackUser) {
        verifier_id = fallbackUser.id;
      }
    }

    if (!verifier_id) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Verifier record not found in database. Please log in again.' });
      return;
    }

    // Create immutable audit log
    const verificationLog = await prisma.verificationLog.create({
      data: {
        order_id: id,
        verifier_id,
        decision: 'REJECTED',
        rejection_note: rejection_note.trim(),
        wastage_pct: wastage.wastagePct,
      },
      include: {
        verifier: {
          select: { id: true, full_name: true, email: true },
        },
      },
    });

    res.json({
      message: 'Batch marked as REJECTED and returned to Cutting Supervisor with audit note.',
      order: updatedOrder,
      log: verificationLog,
      wastage,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

