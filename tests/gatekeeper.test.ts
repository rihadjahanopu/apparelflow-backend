import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app';
import { prisma, pool } from '../src/db';
import { config } from '../src/config';
import { seedDatabase } from '../prisma/seed';
import { AuthUser } from '../src/types';

describe('ApparelFlow Gatekeeper & RBAC Integration Tests', () => {
  let supervisorToken: string;
  let verifierToken: string;
  let sewingToken: string;

  let supervisorUser: AuthUser;
  let verifierUser: AuthUser;
  let sewingUser: AuthUser;

  beforeAll(async () => {
    // Seed initial database
    await seedDatabase();

    const supervisor = await prisma.user.findUniqueOrThrow({
      where: { email: 'supervisor@apparelflow.com' },
    });
    supervisorUser = {
      id: supervisor.id,
      email: supervisor.email,
      role: supervisor.role as any,
      full_name: supervisor.full_name,
    };
    supervisorToken = jwt.sign(supervisorUser, config.jwtSecret);

    const verifier = await prisma.user.findUniqueOrThrow({
      where: { email: 'verifier@apparelflow.com' },
    });
    verifierUser = {
      id: verifier.id,
      email: verifier.email,
      role: verifier.role as any,
      full_name: verifier.full_name,
    };
    verifierToken = jwt.sign(verifierUser, config.jwtSecret);

    const sewing = await prisma.user.findUniqueOrThrow({
      where: { email: 'sewing@apparelflow.com' },
    });
    sewingUser = {
      id: sewing.id,
      email: sewing.email,
      role: sewing.role as any,
      full_name: sewing.full_name,
    };
    sewingToken = jwt.sign(sewingUser, config.jwtSecret);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });

  // TEST 1: All GREEN order approval by verifier succeeds
  it('Test 1: All GREEN order approval by verifier succeeds and updates status to VERIFIED', async () => {
    // Find order 1 which is seeded with all matching GREEN components
    const order1 = await prisma.cuttingOrder.findUniqueOrThrow({
      where: { order_no: 'ORD-2026-001' },
      include: { verification_items: true },
    });

    // Verify all items are MATCH (GREEN)
    for (const item of order1.verification_items) {
      expect(item.actual_qty).toBe(item.expected_qty);
      expect(item.status).toBe('MATCH');
    }

    const response = await request(app)
      .post(`/api/verify/${order1.id}/approve`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body.message).toContain('released to Sewing Assembly Queue');
    expect(response.body.order.status).toBe('VERIFIED');
    expect(response.body.log).toBeDefined();
    expect(response.body.log.decision).toBe('APPROVED');
    expect(response.body.log.wastage_pct).toBe(2.5); // 184.5 yds used vs 180 expected = 2.5%

    // Verify in database
    const dbOrder = await prisma.cuttingOrder.findUnique({ where: { id: order1.id } });
    expect(dbOrder?.status).toBe('VERIFIED');

    const dbLog = await prisma.verificationLog.findFirst({
      where: { order_id: order1.id, decision: 'APPROVED' },
    });
    expect(dbLog).toBeDefined();
    expect(dbLog?.verifier_id).toBe(verifierUser.id);
  });

  // TEST 2: Approval attempt with a RED component returns HTTP 422 error
  it('Test 2: Approval attempt with a RED component returns HTTP 422 Unprocessable Entity', async () => {
    // Order 2 (ORD-2026-002) is seeded with a shortage in Side Strap Accents (expected 100, actual 94)
    const order2 = await prisma.cuttingOrder.findUniqueOrThrow({
      where: { order_no: 'ORD-2026-002' },
      include: { verification_items: true },
    });

    const response = await request(app)
      .post(`/api/verify/${order2.id}/approve`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send();

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('UNPROCESSABLE_ENTITY');
    expect(response.body.message).toContain('Gatekeeper Hard-Stop Violation');
    expect(response.body.shortages).toBeDefined();
    expect(response.body.shortages.length).toBeGreaterThanOrEqual(1);

    const shortage = response.body.shortages.find(
      (s: any) => s.component_name === 'Side Strap Accents'
    );
    expect(shortage).toBeDefined();
    expect(shortage.deficit).toBe(6);
    expect(shortage.status).toBe('SHORTAGE');

    // Confirm database status was NOT mutated to VERIFIED
    const dbOrder = await prisma.cuttingOrder.findUnique({ where: { id: order2.id } });
    expect(dbOrder?.status).toBe('READY_FOR_VERIFICATION');
  });

  // TEST 3: Rejection without a note is blocked by backend validation
  it('Test 3: Rejection without a note is blocked by backend validation (HTTP 422)', async () => {
    const order2 = await prisma.cuttingOrder.findUniqueOrThrow({
      where: { order_no: 'ORD-2026-002' },
    });

    // Attempt rejection with empty note
    const emptyNoteResponse = await request(app)
      .post(`/api/verify/${order2.id}/reject`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ rejection_note: '   ' });

    expect(emptyNoteResponse.status).toBe(422);
    expect(emptyNoteResponse.body.error).toBe('UNPROCESSABLE_ENTITY');
    expect(emptyNoteResponse.body.message).toContain('mandatory audit note');

    // Attempt rejection without rejection_note field
    const missingNoteResponse = await request(app)
      .post(`/api/verify/${order2.id}/reject`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({});

    expect(missingNoteResponse.status).toBe(422);

    // Order status must still be unchanged
    let dbOrder = await prisma.cuttingOrder.findUnique({ where: { id: order2.id } });
    expect(dbOrder?.status).toBe('READY_FOR_VERIFICATION');

    // Now provide a valid rejection note
    const validRejectResponse = await request(app)
      .post(`/api/verify/${order2.id}/reject`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        rejection_note: 'Shortage of 6 Side Strap Accents due to cutting machine miscalibration.',
      });

    expect(validRejectResponse.status).toBe(200);
    expect(validRejectResponse.body.order.status).toBe('REJECTED');
    expect(validRejectResponse.body.log.rejection_note).toContain(
      'Shortage of 6 Side Strap Accents'
    );

    dbOrder = await prisma.cuttingOrder.findUnique({ where: { id: order2.id } });
    expect(dbOrder?.status).toBe('REJECTED');
  });

  // TEST 4: Non-verifier user attempting approval returns HTTP 403 Forbidden
  it('Test 4: Non-verifier user attempting approval returns HTTP 403 Forbidden', async () => {
    const order1 = await prisma.cuttingOrder.findUniqueOrThrow({
      where: { order_no: 'ORD-2026-001' },
    });

    // Cutting Supervisor attempts verification approval
    const supervisorAttempt = await request(app)
      .post(`/api/verify/${order1.id}/approve`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send();

    expect(supervisorAttempt.status).toBe(403);
    expect(supervisorAttempt.body.error).toBe('FORBIDDEN');
    expect(supervisorAttempt.body.message).toContain("Role 'cutting_supervisor' is not authorized");

    // Sewing Supervisor attempts verification approval
    const sewingAttempt = await request(app)
      .post(`/api/verify/${order1.id}/approve`)
      .set('Authorization', `Bearer ${sewingToken}`)
      .send();

    expect(sewingAttempt.status).toBe(403);
    expect(sewingAttempt.body.error).toBe('FORBIDDEN');
    expect(sewingAttempt.body.message).toContain("Role 'sewing_supervisor' is not authorized");
  });

  // TEST 5: DB query for Sewing Queue enforces WHERE status = 'VERIFIED'
  it('Test 5: DB query for Sewing Queue enforces strictly WHERE status = "VERIFIED"', async () => {
    // Query sewing queue as sewing_supervisor
    const response = await request(app)
      .get('/api/sewing/queue')
      .set('Authorization', `Bearer ${sewingToken}`);

    expect(response.status).toBe(200);
    expect(response.body.queue).toBeDefined();
    expect(Array.isArray(response.body.queue)).toBe(true);
    expect(response.body.queue.length).toBeGreaterThan(0);

    // Verify EVERY order in queue has status = 'VERIFIED'
    for (const order of response.body.queue) {
      expect(order.status).toBe('VERIFIED');
    }

    // Verify unverified, rejected, or ready orders are NOT in the queue
    const orderNos = response.body.queue.map((o: any) => o.order_no);
    expect(orderNos).not.toContain('ORD-2026-002'); // Which was REJECTED in Test 3
    expect(orderNos).not.toContain('ORD-2026-004'); // Which is REJECTED from seed

    // Also test that non-sewing supervisor is forbidden from accessing the sewing queue
    const forbiddenResponse = await request(app)
      .get('/api/sewing/queue')
      .set('Authorization', `Bearer ${verifierToken}`);

    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.body.error).toBe('FORBIDDEN');
  });

  afterAll(async () => {
    try {
      await prisma.$disconnect();
      await pool.end();
    } catch {
      // Ignore if already disconnected
    }
  });
});
