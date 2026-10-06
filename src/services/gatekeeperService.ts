import { ComponentTrafficStatus } from '../types';

export interface ComponentEvaluation {
  component_id: number;
  component_name: string;
  expected_qty: number;
  actual_qty: number;
  status: ComponentTrafficStatus;
  variance: number; // actual - expected
  deficit: number;  // expected - actual (if shortage)
}

export interface GatekeeperEvaluationResult {
  canApprove: boolean;
  hasShortage: boolean;
  components: ComponentEvaluation[];
  shortages: ComponentEvaluation[];
  totalExpected: number;
  totalActual: number;
}

export interface WastageEvaluationResult {
  actualFabricYards: number;
  expectedFabricYards: number;
  wastagePct: number;
  wastageCap: number;
  exceededCap: boolean;
}

/**
 * Determine traffic-light status:
 * - GREEN (MATCH): Actual == Expected
 * - YELLOW (EXCESS): Actual > Expected
 * - RED (SHORTAGE): Actual < Expected
 */
export function evaluateComponentStatus(expectedQty: number, actualQty: number): ComponentTrafficStatus {
  if (actualQty < expectedQty) {
    return 'SHORTAGE'; // RED
  }
  if (actualQty > expectedQty) {
    return 'EXCESS'; // YELLOW
  }
  return 'MATCH'; // GREEN
}

/**
 * Evaluates the full component batch matrix for an order.
 * If any component has RED status, gatekeeper hard-stop blocks approval.
 */
export function evaluateGatekeeper(
  items: Array<{
    component_id: number;
    component_name: string;
    expected_qty: number;
    actual_qty: number;
  }>
): GatekeeperEvaluationResult {
  const evaluatedComponents: ComponentEvaluation[] = items.map((item) => {
    const status = evaluateComponentStatus(item.expected_qty, item.actual_qty);
    const variance = item.actual_qty - item.expected_qty;
    const deficit = Math.max(0, item.expected_qty - item.actual_qty);

    return {
      component_id: item.component_id,
      component_name: item.component_name,
      expected_qty: item.expected_qty,
      actual_qty: item.actual_qty,
      status,
      variance,
      deficit,
    };
  });

  const shortages = evaluatedComponents.filter((comp) => comp.status === 'SHORTAGE');
  const hasShortage = shortages.length > 0;
  const canApprove = !hasShortage;

  const totalExpected = evaluatedComponents.reduce((acc, c) => acc + c.expected_qty, 0);
  const totalActual = evaluatedComponents.reduce((acc, c) => acc + c.actual_qty, 0);

  return {
    canApprove,
    hasShortage,
    components: evaluatedComponents,
    shortages,
    totalExpected,
    totalActual,
  };
}

/**
 * Computes fabric wastage percentage:
 * Wastage % = ((Actual Fabric Used - Expected Fabric) / Expected Fabric) * 100
 * Expected Fabric = Target Batch Qty * Std Fabric Yards
 */
export function calculateWastage(
  targetQty: number,
  stdFabricYdsPerPc: number,
  actualFabricYards: number,
  wastageCap: number
): WastageEvaluationResult {
  const expectedFabricYards = targetQty * stdFabricYdsPerPc;
  if (expectedFabricYards <= 0) {
    return {
      actualFabricYards,
      expectedFabricYards: 0,
      wastagePct: 0,
      wastageCap,
      exceededCap: false,
    };
  }

  const rawWastage = ((actualFabricYards - expectedFabricYards) / expectedFabricYards) * 100;
  // Round to 2 decimal places
  const wastagePct = Math.round(rawWastage * 100) / 100;
  const exceededCap = wastagePct > wastageCap;

  return {
    actualFabricYards,
    expectedFabricYards: Math.round(expectedFabricYards * 100) / 100,
    wastagePct,
    wastageCap,
    exceededCap,
  };
}

