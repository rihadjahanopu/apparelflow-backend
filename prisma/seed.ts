import { prisma, pool } from '../src/db';
import bcrypt from 'bcryptjs';

export async function seedDatabase() {
  console.log('--- Cleaning database ---');
  await prisma.verificationLog.deleteMany();
  await prisma.verificationItem.deleteMany();
  await prisma.cuttingOrder.deleteMany();
  await prisma.recipeComponent.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.user.deleteMany();

  console.log('--- Seeding Users ---');
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const supervisor = await prisma.user.create({
    data: {
      email: 'supervisor@apparelflow.com',
      password_hash: passwordHash,
      role: 'cutting_supervisor',
      full_name: 'Marcus Vance',
    },
  });

  const verifier = await prisma.user.create({
    data: {
      email: 'verifier@apparelflow.com',
      password_hash: passwordHash,
      role: 'cutting_verifier',
      full_name: 'Elena Rostova',
    },
  });

  const sewingSupervisor = await prisma.user.create({
    data: {
      email: 'sewing@apparelflow.com',
      password_hash: passwordHash,
      role: 'sewing_supervisor',
      full_name: 'Devon Chen',
    },
  });

  console.log('--- Seeding Recipes & BOMs ---');
  // Recipe A: Casual Blouse
  const recipeA = await prisma.recipe.create({
    data: {
      recipe_code: 'REC-BL01',
      name: 'Casual Blouse',
      category: 'Woven Tops',
      std_fabric_yards: 1.8,
      wastage_cap: 5.0,
      recipe_components: {
        create: [
          { component_name: 'Front Body', pieces_per_garment: 1 },
          { component_name: 'Back Body', pieces_per_garment: 1 },
          { component_name: 'Sleeves', pieces_per_garment: 2 },
          { component_name: 'Collar & Stand', pieces_per_garment: 1 },
          { component_name: 'Sleeve Cuffs', pieces_per_garment: 2 },
        ],
      },
    },
    include: { recipe_components: true },
  });

  // Recipe B: Crop Top
  const recipeB = await prisma.recipe.create({
    data: {
      recipe_code: 'REC-CT02',
      name: 'Crop Top',
      category: 'Knit Activewear',
      std_fabric_yards: 1.1,
      wastage_cap: 8.0,
      recipe_components: {
        create: [
          { component_name: 'Front Chest', pieces_per_garment: 1 },
          { component_name: 'Back Support', pieces_per_garment: 1 },
          { component_name: 'Neck Binding', pieces_per_garment: 1 },
          { component_name: 'Hem Elastic', pieces_per_garment: 1 },
          { component_name: 'Side Strap Accents', pieces_per_garment: 2 },
        ],
      },
    },
    include: { recipe_components: true },
  });

  console.log('--- Seeding Initial Cutting Orders ---');

  // Order 1: ORD-2026-001 (Casual Blouse, 100 pcs, Ready for verification - Perfect match ready to approve)
  const order1 = await prisma.cuttingOrder.create({
    data: {
      order_no: 'ORD-2026-001',
      recipe_id: recipeA.id,
      target_qty: 100,
      fabric_roll_id: 'ROLL-TX-9481',
      actual_fabric_yds: 184.5, // Expected: 180 yds. Wastage: 2.5% (Safe)
      status: 'READY_FOR_VERIFICATION',
      created_by: supervisor.id,
    },
  });

  for (const comp of recipeA.recipe_components) {
    const expected = 100 * comp.pieces_per_garment;
    await prisma.verificationItem.create({
      data: {
        order_id: order1.id,
        component_id: comp.id,
        expected_qty: expected,
        actual_qty: expected, // Exact match GREEN
        status: 'MATCH',
      },
    });
  }

  // Order 2: ORD-2026-002 (Crop Top, 50 pcs, Ready for verification - Contains a RED shortage to demonstrate Gatekeeper block)
  const order2 = await prisma.cuttingOrder.create({
    data: {
      order_no: 'ORD-2026-002',
      recipe_id: recipeB.id,
      target_qty: 50,
      fabric_roll_id: 'ROLL-CT-4102',
      actual_fabric_yds: 57.0, // Expected: 55 yds. Wastage: 3.64%
      status: 'READY_FOR_VERIFICATION',
      created_by: supervisor.id,
    },
  });

  for (const comp of recipeB.recipe_components) {
    const expected = 50 * comp.pieces_per_garment;
    // Introduce shortage on 'Side Strap Accents' (expected 100, actual 94)
    let actual = expected;
    let itemStatus = 'MATCH';
    if (comp.component_name === 'Side Strap Accents') {
      actual = 94; // Shortage of 6 pieces
      itemStatus = 'SHORTAGE';
    }
    await prisma.verificationItem.create({
      data: {
        order_id: order2.id,
        component_id: comp.id,
        expected_qty: expected,
        actual_qty: actual,
        status: itemStatus,
      },
    });
  }

  // Order 3: ORD-2026-003 (Casual Blouse, 60 pcs, VERIFIED - Queued for Sewing)
  const order3 = await prisma.cuttingOrder.create({
    data: {
      order_no: 'ORD-2026-003',
      recipe_id: recipeA.id,
      target_qty: 60,
      fabric_roll_id: 'ROLL-TX-8820',
      actual_fabric_yds: 110.0, // Expected: 108 yds. Wastage: 1.85%
      status: 'VERIFIED',
      created_by: supervisor.id,
    },
  });

  for (const comp of recipeA.recipe_components) {
    const expected = 60 * comp.pieces_per_garment;
    await prisma.verificationItem.create({
      data: {
        order_id: order3.id,
        component_id: comp.id,
        expected_qty: expected,
        actual_qty: expected,
        status: 'MATCH',
      },
    });
  }

  await prisma.verificationLog.create({
    data: {
      order_id: order3.id,
      verifier_id: verifier.id,
      decision: 'APPROVED',
      wastage_pct: 1.85,
      timestamp: new Date(Date.now() - 3600000 * 2), // 2 hours ago
    },
  });

  // Order 4: ORD-2026-004 (Crop Top, 40 pcs, REJECTED with note)
  const order4 = await prisma.cuttingOrder.create({
    data: {
      order_no: 'ORD-2026-004',
      recipe_id: recipeB.id,
      target_qty: 40,
      fabric_roll_id: 'ROLL-CT-1099',
      actual_fabric_yds: 49.0, // Expected: 44 yds. Wastage: 11.36% (Exceeded cap!)
      status: 'REJECTED',
      created_by: supervisor.id,
    },
  });

  for (const comp of recipeB.recipe_components) {
    const expected = 40 * comp.pieces_per_garment;
    const actual = comp.component_name === 'Neck Binding' ? expected - 8 : expected;
    await prisma.verificationItem.create({
      data: {
        order_id: order4.id,
        component_id: comp.id,
        expected_qty: expected,
        actual_qty: actual,
        status: actual < expected ? 'SHORTAGE' : 'MATCH',
      },
    });
  }

  await prisma.verificationLog.create({
    data: {
      order_id: order4.id,
      verifier_id: verifier.id,
      decision: 'REJECTED',
      rejection_note: 'Dull cutting die tore Neck Binding components (8 pieces short). Wastage exceeded cap at 11.36%. Batch rejected for recut.',
      wastage_pct: 11.36,
      timestamp: new Date(Date.now() - 3600000 * 5),
    },
  });

  console.log('--- Seed Completed Successfully! ---');
}

if (require.main === module) {
  seedDatabase()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      try {
        await pool.end();
      } catch {
        // ignore
      }
    });
}

