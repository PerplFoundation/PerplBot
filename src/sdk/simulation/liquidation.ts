/**
 * Liquidation simulator — pure math, no fork needed.
 *
 * Sweeps mark price over a range, computes PnL/equity/margin at each point,
 * finds exact liquidation price, and projects funding impact over time.
 */

import { PositionType, type PositionInfo, type PerpetualInfo } from "../contracts/Exchange.js";
import { pnsToPrice, lnsToLot, PRICE_DECIMALS, LOT_DECIMALS } from "../trading/orders.js";
import { cnsToAmount } from "../trading/positions.js";

// ============ Configuration ============

export interface LiquidationSimConfig {
  /** How far to sweep each direction from current price (%) */
  priceRangePct: number;
  /** Number of price points in the sweep */
  priceSteps: number;
  /** Hours of funding to project */
  fundingHours: number;
  /** Number of time checkpoints for funding */
  fundingSteps: number;
  /** Maintenance margin fraction */
  maintenanceMargin: number;
}

export const DEFAULT_LIQUIDATION_CONFIG: LiquidationSimConfig = {
  priceRangePct: 30,
  priceSteps: 60,
  fundingHours: 24,
  fundingSteps: 6,
  maintenanceMargin: 0.05,
};

// ============ Result types ============

export interface PricePoint {
  price: number;
  pnl: number;
  equity: number;
  marginRatio: number;
  leverage: number;
  isLiquidatable: boolean;
}

export interface FundingProjection {
  hours: number;
  fundingAccrued: number;
  adjustedEquity: number;
  adjustedLiqPrice: number;
}

export interface LiquidationSimResult {
  // Position context
  perpId: bigint;
  perpName: string;
  positionType: "long" | "short";
  entryPrice: number;
  size: number;
  collateral: number;
  currentMarkPrice: number;
  oraclePrice: number;
  currentPnl: number;
  currentEquity: number;
  currentLeverage: number;
  currentMarginRatio: number;

  // Liquidation analysis
  liquidationPrice: number;
  distancePct: number;
  distanceUsd: number;

  // Price sweep
  pricePoints: PricePoint[];

  // Funding projection
  fundingRate: number;        // Per 8h as percentage (e.g. 0.032 means 0.032%)
  fundingPerHour: number;     // USD per hour (positive = you pay)
  fundingProjections: FundingProjection[];

  // Open interest context
  longOI: number;
  shortOI: number;

  // Config used
  maintenanceMargin: number;
}

// ============ Core math ============

/**
 * Compute PnL at a given mark price
 */
function computePnl(
  entryPrice: number,
  markPrice: number,
  size: number,
  isLong: boolean,
): number {
  return isLong
    ? (markPrice - entryPrice) * size
    : (entryPrice - markPrice) * size;
}

/**
 * Compute exact liquidation price.
 *
 * At liquidation: equity = maintenanceMargin * notional
 *   equity = collateral + pnl
 *   notional = liqPrice * size
 *
 * For long: collateral + (liqPrice - entry) * size = mm * liqPrice * size
 *   liqPrice * size - mm * liqPrice * size = entry * size - collateral
 *   liqPrice * size * (1 - mm) = entry * size - collateral
 *   liqPrice = (entry * size - collateral) / (size * (1 - mm))
 *
 * For short: collateral + (entry - liqPrice) * size = mm * liqPrice * size
 *   collateral + entry * size - liqPrice * size = mm * liqPrice * size
 *   collateral + entry * size = liqPrice * size * (1 + mm)
 *   liqPrice = (collateral + entry * size) / (size * (1 + mm))
 */
export function computeLiquidationPrice(
  entryPrice: number,
  size: number,
  collateral: number,
  isLong: boolean,
  maintenanceMargin: number,
): number {
  if (size <= 0) return 0;

  if (isLong) {
    const liqPrice = (entryPrice * size - collateral) / (size * (1 - maintenanceMargin));
    return Math.max(0, liqPrice);
  } else {
    const liqPrice = (collateral + entryPrice * size) / (size * (1 + maintenanceMargin));
    return Math.max(0, liqPrice);
  }
}

/**
 * Compute a single price point in the sweep
 */
function computePricePoint(
  price: number,
  entryPrice: number,
  size: number,
  collateral: number,
  isLong: boolean,
  maintenanceMargin: number,
): PricePoint {
  const pnl = computePnl(entryPrice, price, size, isLong);
  const equity = collateral + pnl;
  const notional = price * size;
  const marginRatio = notional > 0 ? equity / notional : 0;
  const leverage = equity > 0 ? notional / equity : Infinity;
  const isLiquidatable = equity <= 0 || marginRatio < maintenanceMargin;

  return { price, pnl, equity, marginRatio, leverage, isLiquidatable };
}

// ============ Main simulation ============

/**
 * Run liquidation simulation on a position.
 * Pure math — no RPC calls, no fork.
 */
export function simulateLiquidation(
  perpId: bigint,
  position: PositionInfo,
  perpInfo: PerpetualInfo,
  perpName: string,
  userConfig: Partial<LiquidationSimConfig> = {},
  priceDecimals: bigint = PRICE_DECIMALS,
  lotDecimals: bigint = LOT_DECIMALS,
): LiquidationSimResult {
  const config = { ...DEFAULT_LIQUIDATION_CONFIG, ...userConfig };

  // Parse position
  const isLong = position.positionType === PositionType.Long;
  const entryPrice = pnsToPrice(position.pricePNS, priceDecimals);
  const size = lnsToLot(position.lotLNS, lotDecimals);
  const collateral = cnsToAmount(position.depositCNS);

  // Parse market state
  const currentMarkPrice = pnsToPrice(perpInfo.markPNS, priceDecimals);
  const oraclePrice = pnsToPrice(perpInfo.oraclePNS, priceDecimals);

  // Current position metrics
  const currentPnl = computePnl(entryPrice, currentMarkPrice, size, isLong);
  const currentEquity = collateral + currentPnl;
  const currentNotional = currentMarkPrice * size;
  const currentMarginRatio = currentNotional > 0 ? currentEquity / currentNotional : 0;
  const currentLeverage = currentEquity > 0 ? currentNotional / currentEquity : Infinity;

  // Liquidation price
  const liquidationPrice = computeLiquidationPrice(
    entryPrice, size, collateral, isLong, config.maintenanceMargin,
  );

  // Distance
  const distanceUsd = isLong
    ? currentMarkPrice - liquidationPrice
    : liquidationPrice - currentMarkPrice;
  const distancePct = currentMarkPrice > 0 ? (distanceUsd / currentMarkPrice) * 100 : 0;

  // Price sweep
  const lowPrice = currentMarkPrice * (1 - config.priceRangePct / 100);
  const highPrice = currentMarkPrice * (1 + config.priceRangePct / 100);
  const step = config.priceSteps > 0 ? (highPrice - lowPrice) / config.priceSteps : 0;

  const pricePoints: PricePoint[] = [];
  for (let i = 0; i <= config.priceSteps; i++) {
    const price = lowPrice + step * i;
    pricePoints.push(
      computePricePoint(price, entryPrice, size, collateral, isLong, config.maintenanceMargin),
    );
  }

  // Funding projection
  // fundingRatePct100k: int16, represents rate per 8h as pct * 100000
  // e.g. 3200 means 0.032% per 8h
  const fundingRatePct = Number(perpInfo.fundingRatePct100k) / 100000;
  const fundingRate = fundingRatePct; // percentage per 8h

  // Direction: positive rate means longs pay shorts
  // If long and rate positive → you pay. If short and rate positive → you receive.
  const paysFunding = isLong ? fundingRatePct > 0 : fundingRatePct < 0;
  const fundingPerHourAbs = Math.abs(fundingRatePct / 100) * currentNotional / 8;
  const fundingPerHour = fundingPerHourAbs === 0 ? 0 : (paysFunding ? fundingPerHourAbs : -fundingPerHourAbs);

  const fundingProjections: FundingProjection[] = [];
  if (config.fundingSteps > 0 && fundingPerHour !== 0) {
    const timeStep = config.fundingHours / config.fundingSteps;
    for (let i = 1; i <= config.fundingSteps; i++) {
      const hours = timeStep * i;
      const fundingAccrued = fundingPerHour * hours;
      const adjustedCollateral = collateral - fundingAccrued;
      const adjustedEquity = currentEquity - fundingAccrued;
      const adjustedLiqPrice = computeLiquidationPrice(
        entryPrice, size, adjustedCollateral, isLong, config.maintenanceMargin,
      );
      fundingProjections.push({ hours, fundingAccrued, adjustedEquity, adjustedLiqPrice });
    }
  }

  // Open interest
  const longOI = lnsToLot(perpInfo.longOpenInterestLNS, lotDecimals);
  const shortOI = lnsToLot(perpInfo.shortOpenInterestLNS, lotDecimals);

  return {
    perpId,
    perpName,
    positionType: isLong ? "long" : "short",
    entryPrice,
    size,
    collateral,
    currentMarkPrice,
    oraclePrice,
    currentPnl,
    currentEquity,
    currentLeverage,
    currentMarginRatio,
    liquidationPrice,
    distancePct,
    distanceUsd,
    pricePoints,
    fundingRate,
    fundingPerHour,
    fundingProjections,
    longOI,
    shortOI,
    maintenanceMargin: config.maintenanceMargin,
  };
}
