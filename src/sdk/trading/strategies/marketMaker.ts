/**
 * Simple market making strategy
 * Places orders at the best bid and offer
 */

import type { OrderDesc } from "../../contracts/Exchange.js";
import { OrderBuilder, priceToPNS, lotToLNS } from "../orders.js";

/**
 * Market maker configuration
 */
export interface MarketMakerConfig {
  /** Perpetual ID to trade */
  perpId: bigint;
  /** Order size per side */
  orderSize: number;
  /** Spread from mid price (as a decimal, e.g., 0.001 = 0.1%) */
  spreadPercent: number;
  /** Leverage for positions */
  leverage: number;
  /** Maximum position size before skewing quotes */
  maxPosition: number;
  /** Whether to use post-only orders */
  postOnly?: boolean;
  /** Price decimals (default 6) */
  priceDecimals?: bigint;
  /** Lot decimals (default 8) */
  lotDecimals?: bigint;
}

/**
 * Current market state
 */
export interface MarketState {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
}

/**
 * Current position state
 */
export interface PositionState {
  size: number; // Positive for long, negative for short
}

/**
 * Quote update from the market maker
 */
export interface QuoteUpdate {
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  bidOrder?: OrderDesc;
  askOrder?: OrderDesc;
}

/**
 * Simple market maker strategy
 * Quotes around the mid price with position-based skew
 */
export class MarketMakerStrategy {
  private config: MarketMakerConfig;
  private currentBidOrderId?: bigint;
  private currentAskOrderId?: bigint;

  constructor(config: MarketMakerConfig) {
    this.config = config;
  }

  /**
   * Calculate quotes based on market state and current position
   */
  calculateQuotes(market: MarketState, position: PositionState): QuoteUpdate {
    const { spreadPercent, orderSize, maxPosition } = this.config;
    const { midPrice } = market;

    // Base spread
    const halfSpread = midPrice * spreadPercent;

    // Position-based skew: if long, widen ask spread (encourage selling)
    // if short, widen bid spread (encourage buying)
    const positionRatio = Math.abs(position.size) / maxPosition;
    const skewFactor = Math.min(positionRatio * 0.5, 0.5); // Max 50% additional spread

    let bidSkew = 0;
    let askSkew = 0;

    if (position.size > 0) {
      // Long position - skew to sell
      askSkew = -halfSpread * skewFactor; // Tighten ask
      bidSkew = -halfSpread * skewFactor; // Widen bid
    } else if (position.size < 0) {
      // Short position - skew to buy
      bidSkew = halfSpread * skewFactor; // Tighten bid
      askSkew = halfSpread * skewFactor; // Widen ask
    }

    // Adjust order size based on position
    let bidSize = orderSize;
    let askSize = orderSize;

    if (position.size >= maxPosition) {
      bidSize = 0; // Stop buying
    } else if (position.size <= -maxPosition) {
      askSize = 0; // Stop selling
    }

    const bidPrice = midPrice - halfSpread + bidSkew;
    const askPrice = midPrice + halfSpread + askSkew;

    return {
      bidPrice,
      bidSize,
      askPrice,
      askSize,
    };
  }

  /**
   * Generate orders for the calculated quotes
   */
  generateOrders(quotes: QuoteUpdate): { bidOrder?: OrderDesc; askOrder?: OrderDesc } {
    const priceDecimals = this.config.priceDecimals ?? 6n;
    const lotDecimals = this.config.lotDecimals ?? 8n;

    let bidOrder: OrderDesc | undefined;
    let askOrder: OrderDesc | undefined;

    if (quotes.bidSize > 0) {
      const builder = OrderBuilder.forPerp(this.config.perpId)
        .openLong()
        .pricePNS(priceToPNS(quotes.bidPrice, priceDecimals))
        .lotLNS(lotToLNS(quotes.bidSize, lotDecimals))
        .leverage(this.config.leverage);

      if (this.config.postOnly) {
        builder.postOnly();
      }

      bidOrder = builder.build();
    }

    if (quotes.askSize > 0) {
      const builder = OrderBuilder.forPerp(this.config.perpId)
        .openShort()
        .pricePNS(priceToPNS(quotes.askPrice, priceDecimals))
        .lotLNS(lotToLNS(quotes.askSize, lotDecimals))
        .leverage(this.config.leverage);

      if (this.config.postOnly) {
        builder.postOnly();
      }

      askOrder = builder.build();
    }

    return { bidOrder, askOrder };
  }

  /**
   * Get cancel orders for current quotes
   */
  getCancelOrders(): OrderDesc[] {
    const orders: OrderDesc[] = [];
    const priceDecimals = this.config.priceDecimals ?? 6n;

    if (this.currentBidOrderId !== undefined) {
      orders.push(
        OrderBuilder.forPerp(this.config.perpId)
          .cancel(this.currentBidOrderId)
          .pricePNS(0n)
          .lotLNS(0n)
          .build()
      );
    }

    if (this.currentAskOrderId !== undefined) {
      orders.push(
        OrderBuilder.forPerp(this.config.perpId)
          .cancel(this.currentAskOrderId)
          .pricePNS(0n)
          .lotLNS(0n)
          .build()
      );
    }

    return orders;
  }

  /**
   * Track order placement
   */
  trackOrders(bidOrderId?: bigint, askOrderId?: bigint): void {
    this.currentBidOrderId = bidOrderId;
    this.currentAskOrderId = askOrderId;
  }

  /**
   * Check if quotes need updating based on price movement
   */
  shouldUpdateQuotes(
    oldMid: number,
    newMid: number,
    threshold: number = 0.0005 // 0.05% default
  ): boolean {
    const change = Math.abs(newMid - oldMid) / oldMid;
    return change >= threshold;
  }

  /**
   * Calculate theoretical P&L from market making
   */
  calculateTheoreticalPnL(
    tradesCompleted: number,
    averageSpreadCaptured: number,
    averageSize: number,
    fees: { maker: number; taker: number }
  ): number {
    // Revenue from spread
    const spreadRevenue = tradesCompleted * averageSpreadCaptured * averageSize;

    // Fees paid (assume maker on entry, variable on exit)
    const feesPaid =
      tradesCompleted * averageSize * (fees.maker + (fees.maker + fees.taker) / 2);

    return spreadRevenue - feesPaid;
  }
}

/**
 * Create a simple market maker with default settings
 */
export function createSimpleMarketMaker(
  perpId: bigint,
  orderSize: number,
  leverage: number = 1
): MarketMakerStrategy {
  return new MarketMakerStrategy({
    perpId,
    orderSize,
    spreadPercent: 0.001, // 0.1% spread
    leverage,
    maxPosition: orderSize * 10,
    postOnly: true,
  });
}
