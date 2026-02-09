/**
 * Liquidation simulation tests
 * Tests pure math: price sweep, funding projection, edge cases
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import {
  simulateLiquidation,
  computeLiquidationPrice,
  type LiquidationSimResult,
} from "../../src/sdk/simulation/liquidation.js";
import { PositionType, type PositionInfo, type PerpetualInfo } from "../../src/sdk/contracts/Exchange.js";
import { priceToPNS, lotToLNS, PRICE_DECIMALS, LOT_DECIMALS } from "../../src/sdk/trading/orders.js";
import { amountToCNS } from "../../src/sdk/trading/positions.js";

// Disable chalk colors for deterministic test output
beforeAll(() => {
  process.env.NO_COLOR = "1";
});

// ============ Test helpers ============

function makePosition(overrides: Partial<PositionInfo> = {}): PositionInfo {
  return {
    accountId: 1n,
    nextNodeId: 0n,
    prevNodeId: 0n,
    positionType: PositionType.Long,
    depositCNS: amountToCNS(10000),    // $10,000 collateral
    pricePNS: priceToPNS(100000, 1n),  // $100,000 entry
    lotLNS: lotToLNS(1, 5n),           // 1.0 BTC
    entryBlock: 1000n,
    pnlCNS: 0n,
    deltaPnlCNS: 0n,
    premiumPnlCNS: 0n,
    ...overrides,
  };
}

function makePerpInfo(overrides: Partial<PerpetualInfo> = {}): PerpetualInfo {
  return {
    name: "BTC",
    symbol: "BTC",
    priceDecimals: 1n,
    lotDecimals: 5n,
    markPNS: priceToPNS(100000, 1n),   // $100,000 mark
    markTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    oraclePNS: priceToPNS(100000, 1n), // $100,000 oracle
    longOpenInterestLNS: lotToLNS(50, 5n),
    shortOpenInterestLNS: lotToLNS(45, 5n),
    fundingStartBlock: 0n,
    fundingRatePct100k: 3200,  // 0.032% per 8h
    synthPerpPricePNS: 0n,
    paused: false,
    basePricePNS: 0n,
    maxBidPriceONS: 0n,
    minBidPriceONS: 0n,
    maxAskPriceONS: 0n,
    minAskPriceONS: 0n,
    numOrders: 0n,
    ...overrides,
  };
}

// ============ computeLiquidationPrice tests ============

describe("computeLiquidationPrice", () => {
  it("should compute liq price for long 10x", () => {
    // entry=$100k, size=1, collateral=$10k (10x), MM=5%
    const liqPrice = computeLiquidationPrice(100000, 1, 10000, true, 0.05);
    // At liq: equity = 10000 + (liq - 100000) = 0.05 * liq
    // 10000 + liq - 100000 = 0.05 * liq
    // 0.95 * liq = 90000
    // liq = 90000 / 0.95 ≈ 94736.84
    expect(liqPrice).toBeCloseTo(94736.84, 0);
  });

  it("should compute liq price for short 10x", () => {
    // entry=$100k, size=1, collateral=$10k (10x), MM=5%
    const liqPrice = computeLiquidationPrice(100000, 1, 10000, false, 0.05);
    // At liq: equity = 10000 + (100000 - liq) = 0.05 * liq
    // 110000 - liq = 0.05 * liq
    // 110000 = 1.05 * liq
    // liq = 110000 / 1.05 ≈ 104761.90
    expect(liqPrice).toBeCloseTo(104761.90, 0);
  });

  it("should compute liq price for long 5x", () => {
    const liqPrice = computeLiquidationPrice(100000, 1, 20000, true, 0.05);
    // 0.95 * liq = 80000, liq ≈ 84210.53
    expect(liqPrice).toBeCloseTo(84210.53, 0);
  });

  it("should compute liq price for long 2x", () => {
    const liqPrice = computeLiquidationPrice(100000, 1, 50000, true, 0.05);
    // 0.95 * liq = 50000, liq ≈ 52631.58
    expect(liqPrice).toBeCloseTo(52631.58, 0);
  });

  it("should clamp to zero for extreme long collateral", () => {
    // Fully collateralized: collateral equals notional
    const liqPrice = computeLiquidationPrice(100000, 1, 100000, true, 0.05);
    // 0.95 * liq = 0, liq = 0
    expect(liqPrice).toBe(0);
  });

  it("should return 0 for zero-size position", () => {
    expect(computeLiquidationPrice(100000, 0, 10000, true, 0.05)).toBe(0);
  });
});

// ============ simulateLiquidation tests ============

describe("simulateLiquidation", () => {
  it("should return correct position context for long", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo();

    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    expect(result.perpName).toBe("BTC");
    expect(result.positionType).toBe("long");
    expect(result.entryPrice).toBe(100000);
    expect(result.size).toBe(1);
    expect(result.collateral).toBe(10000);
    expect(result.currentMarkPrice).toBe(100000);
  });

  it("should compute correct PnL when mark is above entry (long)", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo({
      markPNS: priceToPNS(105000, 1n),
      oraclePNS: priceToPNS(105000, 1n),
    });

    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    expect(result.currentPnl).toBeCloseTo(5000, 1);
    expect(result.currentEquity).toBeCloseTo(15000, 1);
  });

  it("should compute correct PnL when mark is below entry (long)", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo({
      markPNS: priceToPNS(95000, 1n),
      oraclePNS: priceToPNS(95000, 1n),
    });

    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    expect(result.currentPnl).toBeCloseTo(-5000, 1);
    expect(result.currentEquity).toBeCloseTo(5000, 1);
  });

  it("should compute correct metrics for short position", () => {
    const position = makePosition({ positionType: PositionType.Short });
    const perpInfo = makePerpInfo({
      markPNS: priceToPNS(95000, 1n),
      oraclePNS: priceToPNS(95000, 1n),
    });

    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    expect(result.positionType).toBe("short");
    expect(result.currentPnl).toBeCloseTo(5000, 1); // short profits when price drops
    expect(result.currentEquity).toBeCloseTo(15000, 1);
  });

  it("should compute liquidation price for 10x long", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo();

    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    // Should match our computeLiquidationPrice math
    expect(result.liquidationPrice).toBeCloseTo(94736.84, 0);
    expect(result.distancePct).toBeGreaterThan(0);
    expect(result.distanceUsd).toBeGreaterThan(0);
  });

  it("should generate correct number of price points", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo();

    const result = simulateLiquidation(16n, position, perpInfo, "BTC", {
      priceSteps: 40,
    });

    // priceSteps + 1 (inclusive of both endpoints)
    expect(result.pricePoints).toHaveLength(41);
  });

  it("should mark points below liq price as liquidatable (long)", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo();

    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    // Points well below liq price should be liquidatable
    const belowLiq = result.pricePoints.filter(p => p.price < result.liquidationPrice - 100);
    for (const pt of belowLiq) {
      expect(pt.isLiquidatable).toBe(true);
    }

    // Points well above liq price should be safe
    const aboveLiq = result.pricePoints.filter(p => p.price > result.liquidationPrice + 100);
    for (const pt of aboveLiq) {
      expect(pt.isLiquidatable).toBe(false);
    }
  });

  it("should mark points above liq price as liquidatable (short)", () => {
    const position = makePosition({ positionType: PositionType.Short });
    const perpInfo = makePerpInfo();

    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    // For short: liquidation when price rises above liq price
    const aboveLiq = result.pricePoints.filter(p => p.price > result.liquidationPrice + 100);
    for (const pt of aboveLiq) {
      expect(pt.isLiquidatable).toBe(true);
    }

    const belowLiq = result.pricePoints.filter(p => p.price < result.liquidationPrice - 100);
    for (const pt of belowLiq) {
      expect(pt.isLiquidatable).toBe(false);
    }
  });

  it("should project funding for long at positive rate (pays)", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo({ fundingRatePct100k: 3200 }); // 0.032% per 8h

    const result = simulateLiquidation(16n, position, perpInfo, "BTC", {
      fundingHours: 24,
      fundingSteps: 3,
    });

    expect(result.fundingProjections).toHaveLength(3);
    // Long pays at positive rate
    expect(result.fundingPerHour).toBeGreaterThan(0);

    // Funding accrued increases over time
    for (let i = 1; i < result.fundingProjections.length; i++) {
      expect(result.fundingProjections[i].fundingAccrued)
        .toBeGreaterThan(result.fundingProjections[i - 1].fundingAccrued);
    }

    // Liq price drifts closer (higher for long) as funding erodes collateral
    for (let i = 1; i < result.fundingProjections.length; i++) {
      expect(result.fundingProjections[i].adjustedLiqPrice)
        .toBeGreaterThan(result.fundingProjections[i - 1].adjustedLiqPrice);
    }
  });

  it("should project funding for short at positive rate (receives)", () => {
    const position = makePosition({ positionType: PositionType.Short });
    const perpInfo = makePerpInfo({ fundingRatePct100k: 3200 }); // 0.032% per 8h

    const result = simulateLiquidation(16n, position, perpInfo, "BTC", {
      fundingHours: 24,
      fundingSteps: 3,
    });

    // Short receives at positive rate
    expect(result.fundingPerHour).toBeLessThan(0); // negative = receiving

    // Liq price drifts further away (higher for short receiving = safer)
    for (let i = 1; i < result.fundingProjections.length; i++) {
      expect(result.fundingProjections[i].adjustedLiqPrice)
        .toBeGreaterThan(result.fundingProjections[i - 1].adjustedLiqPrice);
    }
  });

  it("should skip funding projection when rate is zero", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo({ fundingRatePct100k: 0 });

    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    expect(result.fundingProjections).toHaveLength(0);
    expect(result.fundingPerHour).toBe(0);
  });

  it("should include open interest from perpInfo", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo({
      longOpenInterestLNS: lotToLNS(50, 5n),
      shortOpenInterestLNS: lotToLNS(45, 5n),
    });

    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    expect(result.longOI).toBeCloseTo(50, 1);
    expect(result.shortOI).toBeCloseTo(45, 1);
  });

  it("should use custom config when provided", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo();

    const result = simulateLiquidation(16n, position, perpInfo, "BTC", {
      priceRangePct: 10,
      priceSteps: 20,
      maintenanceMargin: 0.10,
    });

    expect(result.pricePoints).toHaveLength(21);
    expect(result.maintenanceMargin).toBe(0.10);

    // Higher MM = liq price closer to current price
    const resultDefault = simulateLiquidation(16n, position, perpInfo, "BTC");
    expect(result.liquidationPrice).toBeGreaterThan(resultDefault.liquidationPrice);
  });
});

// ============ Report tests ============

describe("Liquidation report", () => {
  let printLiquidationReport: typeof import("../../src/sdk/simulation/liquidation-report.js").printLiquidationReport;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const mod = await import("../../src/sdk/simulation/liquidation-report.js");
    printLiquidationReport = mod.printLiquidationReport;
  });

  it("should not throw when printing a long position report", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo();
    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => printLiquidationReport(result)).not.toThrow();
    expect(logs.length).toBeGreaterThan(5);
  });

  it("should not throw when printing a short position report", () => {
    const position = makePosition({ positionType: PositionType.Short });
    const perpInfo = makePerpInfo();
    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    expect(() => printLiquidationReport(result)).not.toThrow();
  });

  it("should include key information in output", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo();
    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printLiquidationReport(result);

    const output = logs.join("\n");
    expect(output).toContain("BTC-PERP");
    expect(output).toContain("LONG");
    expect(output).toContain("Liq Price");
    expect(output).toContain("Price Sweep");
  });

  it("should handle zero funding rate", () => {
    const position = makePosition();
    const perpInfo = makePerpInfo({ fundingRatePct100k: 0 });
    const result = simulateLiquidation(16n, position, perpInfo, "BTC");

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    expect(() => printLiquidationReport(result)).not.toThrow();
    const output = logs.join("\n");
    expect(output).toContain("zero");
  });
});
