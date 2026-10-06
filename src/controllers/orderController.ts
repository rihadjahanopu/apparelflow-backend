import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../types';
import { calculateWastage, evaluateGatekeeper } from '../services/gatekeeperService';

export const listOrders = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.query;

    const whereClause: any = {};
    if (status && typeof status === 'string') {
      whereClause.status = status;
    }

    const orders = await prisma.cuttingOrder.findMany({
      where: whereClause,
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
      orderBy: { created_at: 'desc' },
    });

    const enrichedOrders = orders.map((order) => {
      const itemsForGatekeeper = order.verification_items.map((vi) => ({
        component_id: vi.component_id,
        component_name: vi.component.component_name,
        expected_qty: vi.expected_qty,
        actual_qty: vi.actual_qty,
      }));

      const gatekeeper = evaluateGatekeeper(itemsForGatekeeper);
      const wastage = calculateWastage(
        order.target_qty,
        order.recipe.std_fabric_yards,
        order.actual_fabric_yds,
        order.recipe.wastage_cap
      );

      return {
        ...order,
        gatekeeper,
        wastage,
      };
    });

    res.json({ orders: enrichedOrders });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

export const getOrderById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid order ID.' });
      return;
    }

    const order = await prisma.cuttingOrder.findUnique({
      where: { id },
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
    });

    if (!order) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
      return;
    }

    const itemsForGatekeeper = order.verification_items.map((vi) => ({
      component_id: vi.component_id,
      component_name: vi.component.component_name,
      expected_qty: vi.expected_qty,
      actual_qty: vi.actual_qty,
    }));

    const gatekeeper = evaluateGatekeeper(itemsForGatekeeper);
    const wastage = calculateWastage(
      order.target_qty,
      order.recipe.std_fabric_yards,
      order.actual_fabric_yds,
      order.recipe.wastage_cap
    );

    res.json({
      order: {
        ...order,
        gatekeeper,
        wastage,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

export const createOrder = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { recipe_id, target_qty, fabric_roll_id, actual_fabric_yds, initial_counts_matched } = req.body;

    // Defensive input guards
    if (!recipe_id || typeof recipe_id !== 'number') {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Valid Recipe ID is required.' });
      return;
    }

    if (!target_qty || typeof target_qty !== 'number' || target_qty <= 0 || !Number.isInteger(target_qty)) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Target batch quantity must be a strictly positive integer (> 0). Decimals and negative numbers are prohibited.',
      });
      return;
    }

    if (!fabric_roll_id || typeof fabric_roll_id !== 'string' || fabric_roll_id.trim() === '') {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Fabric Roll ID / Batch tag is mandatory.' });
      return;
    }

    if (
      actual_fabric_yds === undefined ||
      actual_fabric_yds === null ||
      typeof actual_fabric_yds !== 'number' ||
      actual_fabric_yds <= 0
    ) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Actual fabric yards used must be a positive number (> 0).',
      });
      return;
    }

    // Verify recipe existence
    const recipe = await prisma.recipe.findUnique({
      where: { id: recipe_id },
      include: { recipe_components: true },
    });

    if (!recipe) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Specified recipe not found.' });
      return;
    }

    // Generate unique order number (e.g. ORD-2026-XXXX)
    const timestamp = Date.now().toString().slice(-4);
    const randomHex = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const order_no = `ORD-${new Date().getFullYear()}-${timestamp}${randomHex}`;

    const order = await prisma.cuttingOrder.create({
      data: {
        order_no,
        recipe_id,
        target_qty,
        fabric_roll_id: fabric_roll_id.trim(),
        actual_fabric_yds,
        status: 'READY_FOR_VERIFICATION',
        created_by: req.user!.id,
      },
    });

    // Initialize verification items based on BOM multiplier:
    // Expected Qty = Target Batch Qty * Pieces per Garment
    const verificationItemPromises = recipe.recipe_components.map((comp) => {
      const expected_qty = target_qty * comp.pieces_per_garment;
      // If initial_counts_matched is true, seed actual_qty as expected_qty (green match).
      // Otherwise seed as 0 or expected. Setting to expected_qty lets verifiers quickly confirm or adjust floor variances.
      const actual_qty = initial_counts_matched !== false ? expected_qty : 0;
      const status = actual_qty === expected_qty ? 'MATCH' : 'SHORTAGE';

      return prisma.verificationItem.create({
        data: {
          order_id: order.id,
          component_id: comp.id,
          expected_qty,
          actual_qty,
          status,
        },
      });
    });

    await Promise.all(verificationItemPromises);

    const createdOrderWithDetails = await prisma.cuttingOrder.findUnique({
      where: { id: order.id },
      include: {
        recipe: { include: { recipe_components: true } },
        verification_items: { include: { component: true } },
      },
    });

    res.status(201).json({
      message: 'Cutting order created successfully and sent to Verifier Terminal.',
      order: createdOrderWithDetails,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
};

