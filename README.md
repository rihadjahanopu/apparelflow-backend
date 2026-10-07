# ⚙️ ApparelFlow ERP — Backend API & Gatekeeper Verification Service

<div align="center">

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.2-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.10-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Vitest](https://img.shields.io/badge/Vitest-5.0-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![JWT](https://img.shields.io/badge/Auth-JWT_Tokens-black?style=for-the-badge&logo=jsonwebtokens&logoColor=white)](https://jwt.io/)
[![npm](https://img.shields.io/badge/npm-v10.x-CB3837?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/)
[![pnpm](https://img.shields.io/badge/pnpm-v9.x-F69220?style=for-the-badge&logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Vercel](https://img.shields.io/badge/Vercel-Serverless_API-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)

<p align="center">
  <b>A Production-Grade Manufacturing Execution System (MES) API & Zero-Defect Gatekeeper Service</b><br>
  Built with Express 5, TypeScript, PostgreSQL, Prisma 7 with pg.Pool adapter, and Strict Server-Side Hard-Stop Gatekeeping.
</p>

</div>

---

## 📌 1. Executive Summary & Architecture Overview

The **ApparelFlow Backend** is the core operational engine of the ApparelFlow ERP suite. It guarantees that no defective, incomplete, or unverified garment bundle can ever physically or digitally cross from the Cutting Room into the Sewing Assembly Lines.

### Core Architectural Guarantees:

1. **Unbypassable Server-Side Gatekeeper:** While the client-side UI disables approval buttons when shortages exist, the backend acts as the true authoritarian gatekeeper. Calling the approval API endpoint on any batch with missing pieces immediately halts with an **HTTP 422 Unprocessable Entity** response.
2. **Deterministic Multiplier Mathematics:** Computes exact expected piece counts for each individual garment component based on Bill of Materials (BOM) formulas.
3. **Strict Role-Based Access Control (RBAC):** Cryptographically enforced through JWT claims; supervisors cannot approve, verifiers cannot create orders, and sewing staff can only access strictly verified batches.
4. **Cloud-Native Connection Pooling:** Built on `@prisma/adapter-pg` with `pg.Pool`, enabling high-concurrency serverless execution on Vercel without exhausting database connection pools on Neon, Supabase, or AWS RDS.

---

## 🔄 2. State Machine & Finite-State Lifecycle

Every cutting order follows a deterministic state machine managed by the backend controllers:

```mermaid
stateDiagram-v2
    [*] --> READY_FOR_VERIFICATION: POST /api/orders (Supervisor)

    state "READY_FOR_VERIFICATION" as RFV
    state "VERIFIED" as VER
    state "REJECTED" as REJ
    state "IN_SEWING" as SEW
    state "COMPLETED" as COMP

    RFV --> VER: POST /api/verify/:id/approve (All Components GREEN / YELLOW)
    RFV --> REJ: POST /api/verify/:id/reject (Shortage / Defect with Mandatory Note)

    REJ --> RFV: Supervisor Resolves & Recuts Bundle

    VER --> SEW: POST /api/sewing/:id/start (Sewing Supervisor)
    SEW --> COMP: Batch Completed
    COMP --> [*]
```

### State Validation Matrix:

| Attempted Transition           | Endpoint                       | Required Role        | Pre-conditions                                                                  | Rejection Response                         |
| :----------------------------- | :----------------------------- | :------------------- | :------------------------------------------------------------------------------ | :----------------------------------------- |
| $\to$ `READY_FOR_VERIFICATION` | `POST /api/orders`             | `cutting_supervisor` | Valid `recipe_id`, `target_qty > 0`, non-empty `fabric_roll_id`.                | `400 Bad Request`                          |
| $\to$ `VERIFIED`               | `POST /api/verify/:id/approve` | `cutting_verifier`   | **Every single component must be GREEN or YELLOW.** Zero RED shortages allowed. | **`422 Unprocessable Entity` (Hard-Stop)** |
| $\to$ `REJECTED`               | `POST /api/verify/:id/reject`  | `cutting_verifier`   | `rejection_note` must be non-empty string.                                      | **`422 Unprocessable Entity`**             |
| $\to$ `IN_SEWING`              | `POST /api/sewing/:id/start`   | `sewing_supervisor`  | Current database status must strictly equal `'VERIFIED'`.                       | `400 Bad Request`                          |

---

## 🚦 3. Gatekeeper Algorithm & BOM Multiplier Mathematics

### 1. Component Multiplier Formula:

$$\text{Expected Component Qty} = \text{Target Batch Qty} \times \text{Pieces per Garment (from BOM)}$$

### 2. Traffic-Light Status Matrix:

- **`MATCH` (Green):** $\text{Actual} = \text{Expected}$ $\implies$ Verification Passed.
- **`EXCESS` (Yellow):** $\text{Actual} > \text{Expected}$ $\implies$ Verification Passed with surplus flag.
- **`SHORTAGE` (Red):** $\text{Actual} < \text{Expected}$ $\implies$ **HARD-STOP TRIGGERED**.

### 3. Server-Side Hard-Stop Logic (`verifyController.ts`):

```typescript
// Inspect all verification items for this order
const shortages = order.verification_items.filter(
	(item) => item.actual_qty < item.expected_qty
);

if (shortages.length > 0) {
	return res.status(422).json({
		error: "GATEKEEPER_HARD_STOP",
		message:
			"Cannot approve order with component shortages (RED traffic-light status).",
		shortages: shortages.map((s) => ({
			component_id: s.component_id,
			component_name: s.component.component_name,
			expected: s.expected_qty,
			actual: s.actual_qty,
			deficit: s.expected_qty - s.actual_qty,
		})),
	});
}
```

### 4. Fabric Wastage Percentage Calculation:

$$\text{Wastage \%} = \frac{\text{Actual Fabric Yards Used} - \text{Expected Fabric Yards}}{\text{Expected Fabric Yards}} \times 100$$
$$\text{Expected Fabric Yards} = \text{Target Batch Qty} \times \text{Standard Fabric Yards per Piece}$$

The resulting percentage is immutably logged into the `VerificationLog` record upon approval or rejection.

---

## 🛡️ 4. Security & Role-Based Access Control (RBAC)

The backend implements a two-tier middleware pipeline for all protected routes:

```
[ Incoming HTTP Request ]
          │
          ▼
┌──────────────────────────────────────┐
│ authenticateToken Middleware         │
│ • Validates Bearer JWT header        │
│ • Verifies signature & expiration    │
│ • Injects req.user (id, role, email) │
└──────────────────┬───────────────────┘
                   │ Success
                   ▼
┌──────────────────────────────────────┐
│ requireRole(...allowedRoles)         │
│ • Asserts req.user.role ∈ allowed    │
│ • Rejects unauthorized roles (403)   │
└──────────────────┬───────────────────┘
                   │ Success
                   ▼
       [ Route Controller Handler ]
```

### Role Permissions Matrix:

| Role Slug            | Create Orders (`/orders`) | Approve / Reject (`/verify`) | Access Sewing (`/sewing`) |
| :------------------- | :-----------------------: | :--------------------------: | :-----------------------: |
| `cutting_supervisor` |        ✅ Allowed         |     ❌ **403 Forbidden**     |   ❌ **403 Forbidden**    |
| `cutting_verifier`   |   ❌ **403 Forbidden**    |          ✅ Allowed          |   ❌ **403 Forbidden**    |
| `sewing_supervisor`  |   ❌ **403 Forbidden**    |     ❌ **403 Forbidden**     |        ✅ Allowed         |

### Sewing Queue Isolation Guarantee:

The sewing endpoint enforces query-level database isolation. It is physically impossible for unverified or rejected batches to appear on the sewing floor:

```typescript
const queue = await prisma.cuttingOrder.findMany({
	where: { status: "VERIFIED" },
	include: { recipe: true, verification_logs: true },
});
```

---

## 🗄️ 5. Relational Database Schema (PostgreSQL + Prisma 7)

```mermaid
erDiagram
    User ||--o{ CuttingOrder : "creates"
    User ||--o{ VerificationLog : "verifies"
    Recipe ||--o{ RecipeComponent : "contains"
    Recipe ||--o{ CuttingOrder : "specifies"
    CuttingOrder ||--o{ VerificationItem : "details"
    CuttingOrder ||--o{ VerificationLog : "records"
    RecipeComponent ||--o{ VerificationItem : "references"

    User {
        int id PK
        string email UK
        string password_hash
        string role
        string full_name
        datetime created_at
    }

    Recipe {
        int id PK
        string recipe_code UK
        string name
        string category
        float std_fabric_yards
        float wastage_cap
    }

    RecipeComponent {
        int id PK
        int recipe_id FK
        string component_name
        int pieces_per_garment
        string image_url
    }

    CuttingOrder {
        int id PK
        string order_no UK
        int recipe_id FK
        int target_qty
        string fabric_roll_id
        float actual_fabric_yds
        string status
        int created_by FK
        datetime created_at
        datetime updated_at
    }

    VerificationItem {
        int id PK
        int order_id FK
        int component_id FK
        int expected_qty
        int actual_qty
        string status
    }

    VerificationLog {
        int id PK
        int order_id FK
        int verifier_id FK
        string decision
        string rejection_note
        float wastage_pct
        datetime timestamp
    }
```

---

## 🔌 6. REST API Specification & Endpoints

### Authentication & Identity

- `POST /api/auth/login`: Authenticates with email and password. Returns signed JWT and user object.
- `GET /api/auth/me`: Returns current user's profile from JWT claims.
- `GET /api/auth/demo-switch/:role`: Convenience endpoint returning valid demo JWT tokens for quick role evaluation.

### Garment Recipes & BOM

- `GET /api/recipes`: Retrieves all recipes along with their component formulas and standard fabric allowances.
- `GET /api/recipes/:id`: Retrieves a specific garment recipe by ID.

### Cutting Orders

- `GET /api/orders`: Retrieves all orders, their BOM components, calculated traffic lights, and audit logs.
- `POST /api/orders`: _(Role: `cutting_supervisor`)_ Creates a new cutting order, computes component piece requirements, and initializes verification line items.
- `GET /api/orders/:id`: Retrieves order details for a specific batch.

### Quality Gatekeeper Verification

- `POST /api/verify/:id/update-counts`: _(Role: `cutting_verifier`)_ Updates physical piece counts and recomputes traffic-light badges.
- `POST /api/verify/:id/approve`: _(Role: `cutting_verifier`)_ **Hard-Stop Gatekeeper.** Approves batch if all pieces match; halts with `422` if any shortages exist.
- `POST /api/verify/:id/reject`: _(Role: `cutting_verifier`)_ Rejects batch with mandatory `rejection_note` and logs wastage audit record.

### Sewing Floor Execution

- `GET /api/sewing/queue`: _(Role: `sewing_supervisor`)_ Retrieves all orders where `status = 'VERIFIED'`.
- `POST /api/sewing/:id/start`: _(Role: `sewing_supervisor`)_ Transitions batch from `VERIFIED` to `IN_SEWING`.

---

## 🧪 7. Automated Test Suite (Vitest)

The test suite in [`apparelflow-backend/tests/gatekeeper.test.ts`](file:///persistent/home/rihad/Developer/dev/taks/apparelflow-backend/tests/gatekeeper.test.ts) provides 100% automated coverage across the 5 core manufacturing compliance requirements:

- **Test 1:** All GREEN order approval by verifier succeeds and updates status to `VERIFIED`.
- **Test 2:** Approval attempt with a RED component returns **HTTP 422 Unprocessable Entity**.
- **Test 3:** Rejection without an audit note is blocked by backend validation (**HTTP 422**).
- **Test 4:** Non-verifier user attempting approval returns **HTTP 403 Forbidden**.
- **Test 5:** DB query for Sewing Queue strictly enforces `WHERE status = 'VERIFIED'`.

To run tests:

```bash
cd apparelflow-backend
pnpm test
# or: npm test
```

### Verified Test Suite Output (100% Pass):
```text
 ✓ tests/gatekeeper.test.ts (5 tests) 6829ms
   ✓ ApparelFlow Gatekeeper & RBAC Integration Tests (5)
     ✓ Test 1: All GREEN order approval by verifier succeeds and updates status to VERIFIED
     ✓ Test 2: Approval attempt with a RED component returns HTTP 422 Unprocessable Entity
     ✓ Test 3: Rejection without a note is blocked by backend validation (HTTP 422)
     ✓ Test 4: Non-verifier user attempting approval returns HTTP 403 Forbidden
     ✓ Test 5: DB query for Sewing Queue enforces strictly WHERE status = "VERIFIED"

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  7.42s
```

---

## 🔑 8. Pre-Seeded Demo Credentials

The database is pre-seeded with three operational personas:

| Persona           | Role                 | Email                        | Password       | Permissions                                              |
| :---------------- | :------------------- | :--------------------------- | :------------- | :------------------------------------------------------- |
| **Marcus Vance**  | `cutting_supervisor` | `supervisor@apparelflow.com` | `Password123!` | Create orders, log rolls, review BOM ratios.             |
| **Elena Rostova** | `cutting_verifier`   | `verifier@apparelflow.com`   | `Password123!` | Count pieces, evaluate traffic lights, approve / reject. |
| **Devon Chen**    | `sewing_supervisor`  | `sewing@apparelflow.com`     | `Password123!` | Receive verified batches, initiate sewing assembly.      |

---

## 🚀 9. Running the Backend Locally

### Prerequisites:

- [Node.js (>= 18.0)](https://nodejs.org/)
- PostgreSQL database instance (local, Docker, Supabase, or Neon)

### Step 1: Install Dependencies

```bash
cd apparelflow-backend
pnpm install
# or: npm install
```

### Step 2: Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Ensure your `DATABASE_URL` is pointing to your PostgreSQL instance:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/apparelflow_erp?schema=public"
JWT_SECRET="apparelflow-super-secret-enterprise-jwt-key-2026"
PORT=4000
NODE_ENV=development
```

### Step 3: Run Database Migrations & Seed

```bash
pnpm prisma:migrate    # executes: prisma db push (creates tables in PostgreSQL)
pnpm prisma:seed       # executes: tsx prisma/seed.ts (seeds BOM recipes, users, and batches)
```

### Step 4: Start Development Server

```bash
pnpm dev
# or: npm run dev
```

The server will start at: 👉 **[http://localhost:4000](http://localhost:4000)** (Health check: `http://localhost:4000/api/health`).

---

## ☁️ 10. Vercel Serverless API Deployment

The backend is configured for zero-config Vercel Serverless deployment using the Express Serverless adapter:

1. In the [Vercel Dashboard](https://vercel.com), click **Add New Project** and select this repository.
2. In project settings, set **Root Directory** to:
   `apparelflow-backend`
3. Framework Preset: **Other**.
4. Set the following **Environment Variables**:
   - `DATABASE_URL`: Your cloud PostgreSQL connection string (Neon / Supabase).
   - `JWT_SECRET`: A secure production secret key.
5. Click **Deploy**. Vercel will run `prisma generate && tsc` and launch the serverless API.

---

## 📂 11. Backend Directory Structure

```text
apparelflow-backend/
├── api/
│   └── index.ts              # Vercel Serverless entrypoint exporting Express app
├── prisma/
│   ├── schema.prisma         # Relational PostgreSQL schema definition
│   └── seed.ts               # Database seeder (Recipes, BOM, Users, Orders)
├── src/
│   ├── config.ts             # Environment & JWT configuration
│   ├── db.ts                 # Prisma Client instance with @prisma/adapter-pg Pool
│   ├── types.ts              # TypeScript domain types & RBAC definitions
│   ├── middleware/
│   │   ├── auth.ts           # JWT token authentication middleware
│   │   └── rbac.ts           # Role-based access control (403 Forbidden)
│   ├── services/
│   │   └── gatekeeperService.ts # Traffic light evaluation & wastage math
│   ├── controllers/
│   │   ├── authController.ts # Login, user profile, demo token switcher
│   │   ├── recipeController.ts # BOM recipes and component retrieval
│   │   ├── orderController.ts # Order issuance & validation
│   │   ├── verifyController.ts # Gatekeeper Hard-Stop & Rejection audits
│   │   └── sewingController.ts # Sewing queue (Strictly VERIFIED status)
│   ├── routes/               # Express router endpoints
│   ├── app.ts                # Express application setup & middleware
│   └── index.ts              # Local server entrypoint (Port 4000)
├── tests/
│   └── gatekeeper.test.ts    # Vitest automated test suite (5 core tests)
├── package.json
├── tsconfig.json
├── vercel.json               # Serverless rewrite rules for Vercel
└── vitest.config.ts
```
