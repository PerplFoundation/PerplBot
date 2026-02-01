/**
 * Grid trading strategy
 * Places buy and sell orders at fixed price intervals
 */

import type { OrderDesc } from "../../contracts/Exchange.js";
import { OrderBuilder, priceToPNS, lotToLNS } from "../orders.js";

/**
 * Grid trading configuration
 */
export interface GridConfig {
  /** Perpetual ID to trade */
  perpId: bigint;
  /** Center price for the grid */
  centerPrice: number;
  /** Number of grid levels above and below center */
  gridLevels: number;
  /** Price spacing between levels (in price units) */
  gridSpacing: number;
  /** Order size per level */
  orderSize: number;
  /** Leverage for opening positions */
  leverage: number;
  /** Whether to use post-only orders */
  postOnly?: boolean;
  /** Price decimals (default 6) */
  priceDecimals?: bigint;
  /** Lot decimals (default 8) */
  lotDecimals?: bigint;
}

/**
 * Grid level information
 */
export interface GridLevel {
  price: number;
  side: "buy" | "sell";
  orderId?: bigint;
}

/**
 * Generate grid levels around a center price
 */
export function generateGridLevels(
  centerPrice: number,
  gridLevels: number,
  gridSpacing: number
): GridLevel[] {
  const levels: GridLevel[] = [];

  // Buy levels below center
  for (let i = 1; i <= gridLevels; i++) {
    levels.push({
      price: centerPrice - i * gridSpacing,
      side: "buy",
    });
  }

  // Sell levels above center
  for (let i = 1; i <= gridLevels; i++) {
    levels.push({
      price: centerPrice + i * gridSpacing,
      side: "sell",
    });
  }

  return levels.sort((a, b) => a.price - b.price);
}

/**
 * Create orders for a grid configuration
 */
export function createGridOrders(config: GridConfig): OrderDesc[] {
  const levels = generateGridLevels(
    config.centerPrice,
    config.gridLevels,
    config.gridSpacing
  );

  const priceDecimals = config.priceDecimals ?? 6n;
  const lotDecimals = config.lotDecimals ?? 8n;

  return levels.map((level) => {
    const builder = OrderBuilder.forPerp(config.perpId)
      .pricePNS(priceToPNS(level.price, priceDecimals))
      .lotLNS(lotToLNS(config.orderSize, lotDecimals))
      .leverage(config.leverage);

    if (level.side === "buy") {
      builder.openLong();
    } else {
      builder.openShort();
    }

    if (config.postOnly) {
      builder.postOnly();
    }

    return builder.build();
  });
}

/**
 * Calculate grid profitability metrics
 */
export interface GridMetrics {
  /** Total capital required */
  totalCapital: number;
  /** Expected profit per round trip */
  profitPerRoundTrip: number;
  /** Breakeven number of round trips to cover fees */
  breakevenRoundTrips: number;
  /** Maximum position size (if all buys or sells fill) */
  maxPositionSize: number;
}

/**
 * Calculate metrics for a grid configuration
 */
export function calculateGridMetrics(
  config: GridConfig,
  takerFeePer100K: number,
  makerFeePer100K: number
): GridMetrics {
  // Total capital: sum of margin for all levels
  const marginPerOrder = (config.centerPrice * config.orderSize) / config.leverage;
  const totalCapital = marginPerOrder * config.gridLevels * 2;

  // Profit per round trip: gridSpacing * orderSize - fees
  const notional = config.centerPrice * config.orderSize;
  const makerFee = (notional * makerFeePer100K) / 100_000;
  const takerFee = (notional * takerFeePer100K) / 100_000;

  // Assume maker on entry, taker on exit
  const feesPerRoundTrip = makerFee + takerFee;
  const grossProfit = config.gridSpacing * config.orderSize;
  const profitPerRoundTrip = grossProfit - feesPerRoundTrip;

  // Breakeven
  const breakevenRoundTrips =
    profitPerRoundTrip > 0 ? Math.ceil(totalCapital / profitPerRoundTrip) : Infinity;

  // Max position
  const maxPositionSize = config.orderSize * config.gridLevels;

  return {
    totalCapital,
    profitPerRoundTrip,
    breakevenRoundTrips,
    maxPositionSize,
  };
}

/**
 * Grid trading strategy class
 */
export class GridStrategy {
  private config: GridConfig;
  private levels: GridLevel[];
  private activeOrders: Map<bigint, GridLevel> = new Map();

  constructor(config: GridConfig) {
    this.config = config;
    this.levels = generateGridLevels(
      config.centerPrice,
      config.gridLevels,
      config.gridSpacing
    );
  }

  /**
   * Get all grid levels
   */
  getLevels(): GridLevel[] {
    return [...this.levels];
  }

  /**
   * Get initial orders to place
   */
  getInitialOrders(): OrderDesc[] {
    return createGridOrders(this.config);
  }

  /**
   * Track an order being placed
   */
  trackOrder(orderId: bigint, price: number): void {
    const level = this.levels.find((l) => Math.abs(l.price - price) < 0.01);
    if (level) {
      level.orderId = orderId;
      this.activeOrders.set(orderId, level);
    }
  }

  /**
   * Handle an order being filled - returns the counter order to place
   */
  onOrderFilled(orderId: bigint): OrderDesc | null {
    const level = this.activeOrders.get(orderId);
    if (!level) return null;

    this.activeOrders.delete(orderId);

    // Find the counter level (opposite side at next price)
    const priceDecimals = this.config.priceDecimals ?? 6n;
    const lotDecimals = this.config.lotDecimals ?? 8n;

    // If a buy filled, place a sell one level above
    // If a sell filled, place a buy one level below
    let counterPrice: number;
    let counterSide: "buy" | "sell";

    if (level.side === "buy") {
      counterPrice = level.price + this.config.gridSpacing;
      counterSide = "sell";
    } else {
      counterPrice = level.price - this.config.gridSpacing;
      counterSide = "buy";
    }

    const builder = OrderBuilder.forPerp(this.config.perpId)
      .pricePNS(priceToPNS(counterPrice, priceDecimals))
      .lotLNS(lotToLNS(this.config.orderSize, lotDecimals))
      .leverage(this.config.leverage);

    // For counter orders, we're closing the position we just opened
    if (counterSide === "buy") {
      builder.closeShort(); // Close the short we opened when sell filled
    } else {
      builder.closeLong(); // Close the long we opened when buy filled
    }

    if (this.config.postOnly) {
      builder.postOnly();
    }

    return builder.build();
  }

  /**
   * Cancel all active orders
   */
  getCancelOrders(): OrderDesc[] {
    const priceDecimals = this.config.priceDecimals ?? 6n;

    return Array.from(this.activeOrders.entries()).map(([orderId, level]) =>
      OrderBuilder.forPerp(this.config.perpId)
        .cancel(orderId)
        .pricePNS(priceToPNS(level.price, priceDecimals))
        .lotLNS(0n)
        .build()
    );
  }

  /**
   * Get strategy metrics
   */
  getMetrics(takerFeePer100K: number, makerFeePer100K: number): GridMetrics {
    return calculateGridMetrics(this.config, takerFeePer100K, makerFeePer100K);
  }
}
