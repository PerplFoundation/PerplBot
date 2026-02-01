/**
 * Order construction utilities
 * Type-safe builders for Perpl exchange orders
 */

import { type OrderDesc, OrderType, type PerpetualInfo } from "../contracts/Exchange.js";

/**
 * Price precision constants
 * PNS = Price Normalized Scale (exchange internal format)
 */
export const PRICE_DECIMALS = 6n; // Standard price decimals
export const LOT_DECIMALS = 8n; // Standard lot decimals
export const LEVERAGE_DECIMALS = 2n; // Leverage in hundredths (100 = 1x)

/**
 * Convert a human-readable price to PNS format
 */
export function priceToPNS(price: number, priceDecimals: bigint = PRICE_DECIMALS): bigint {
  return BigInt(Math.round(price * Number(10n ** priceDecimals)));
}

/**
 * Convert PNS price to human-readable format
 */
export function pnsToPrice(pns: bigint, priceDecimals: bigint = PRICE_DECIMALS): number {
  return Number(pns) / Number(10n ** priceDecimals);
}

/**
 * Convert a human-readable lot size to LNS format
 */
export function lotToLNS(lot: number, lotDecimals: bigint = LOT_DECIMALS): bigint {
  return BigInt(Math.round(lot * Number(10n ** lotDecimals)));
}

/**
 * Convert LNS lot to human-readable format
 */
export function lnsToLot(lns: bigint, lotDecimals: bigint = LOT_DECIMALS): number {
  return Number(lns) / Number(10n ** lotDecimals);
}

/**
 * Convert leverage multiplier to hundredths format
 * e.g., 10x leverage = 1000
 */
export function leverageToHdths(leverage: number): bigint {
  return BigInt(Math.round(leverage * 100));
}

/**
 * Convert hundredths leverage to multiplier
 */
export function hdthsToLeverage(hdths: bigint): number {
  return Number(hdths) / 100;
}

/**
 * Order builder for type-safe order construction
 */
export class OrderBuilder {
  private orderDesc: Partial<OrderDesc> = {
    orderDescId: 0n,
    orderId: 0n,
    expiryBlock: 0n,
    postOnly: false,
    fillOrKill: false,
    immediateOrCancel: false,
    maxMatches: 0n,
    lastExecutionBlock: 0n,
    amountCNS: 0n,
  };

  /**
   * Create an order builder for a specific perpetual
   */
  constructor(perpId: bigint) {
    this.orderDesc.perpId = perpId;
  }

  /**
   * Create a new order builder
   */
  static forPerp(perpId: bigint): OrderBuilder {
    return new OrderBuilder(perpId);
  }

  /**
   * Set the order type
   */
  type(orderType: OrderType): this {
    this.orderDesc.orderType = orderType;
    return this;
  }

  /**
   * Configure as open long
   */
  openLong(): this {
    return this.type(OrderType.OpenLong);
  }

  /**
   * Configure as open short
   */
  openShort(): this {
    return this.type(OrderType.OpenShort);
  }

  /**
   * Configure as close long
   */
  closeLong(): this {
    return this.type(OrderType.CloseLong);
  }

  /**
   * Configure as close short
   */
  closeShort(): this {
    return this.type(OrderType.CloseShort);
  }

  /**
   * Configure as cancel order
   */
  cancel(orderId: bigint): this {
    this.orderDesc.orderType = OrderType.Cancel;
    this.orderDesc.orderId = orderId;
    return this;
  }

  /**
   * Configure as change order
   */
  change(orderId: bigint): this {
    this.orderDesc.orderType = OrderType.Change;
    this.orderDesc.orderId = orderId;
    return this;
  }

  /**
   * Set price in PNS format
   */
  pricePNS(price: bigint): this {
    this.orderDesc.pricePNS = price;
    return this;
  }

  /**
   * Set price from human-readable number
   */
  price(price: number, decimals: bigint = PRICE_DECIMALS): this {
    return this.pricePNS(priceToPNS(price, decimals));
  }

  /**
   * Set lot size in LNS format
   */
  lotLNS(lot: bigint): this {
    this.orderDesc.lotLNS = lot;
    return this;
  }

  /**
   * Set lot size from human-readable number
   */
  lot(size: number, decimals: bigint = LOT_DECIMALS): this {
    return this.lotLNS(lotToLNS(size, decimals));
  }

  /**
   * Set leverage in hundredths format
   */
  leverageHdths(leverage: bigint): this {
    this.orderDesc.leverageHdths = leverage;
    return this;
  }

  /**
   * Set leverage from multiplier (e.g., 10 for 10x)
   */
  leverage(multiplier: number): this {
    return this.leverageHdths(leverageToHdths(multiplier));
  }

  /**
   * Set expiry block
   */
  expiry(block: bigint): this {
    this.orderDesc.expiryBlock = block;
    return this;
  }

  /**
   * Mark as post-only order
   */
  postOnly(value = true): this {
    this.orderDesc.postOnly = value;
    return this;
  }

  /**
   * Mark as fill-or-kill order
   */
  fillOrKill(value = true): this {
    this.orderDesc.fillOrKill = value;
    return this;
  }

  /**
   * Mark as immediate-or-cancel order
   */
  immediateOrCancel(value = true): this {
    this.orderDesc.immediateOrCancel = value;
    return this;
  }

  /**
   * Set max matches for the order
   */
  maxMatches(count: bigint): this {
    this.orderDesc.maxMatches = count;
    return this;
  }

  /**
   * Set amount in collateral native scale (for certain order types)
   */
  amountCNS(amount: bigint): this {
    this.orderDesc.amountCNS = amount;
    return this;
  }

  /**
   * Build the order descriptor
   */
  build(): OrderDesc {
    // Validate required fields
    if (this.orderDesc.perpId === undefined) {
      throw new Error("Perp ID is required");
    }
    if (this.orderDesc.orderType === undefined) {
      throw new Error("Order type is required");
    }
    if (this.orderDesc.pricePNS === undefined) {
      throw new Error("Price is required");
    }
    if (this.orderDesc.lotLNS === undefined) {
      throw new Error("Lot size is required");
    }
    if (this.orderDesc.leverageHdths === undefined) {
      // Default to 1x leverage for opens, doesn't matter for closes
      this.orderDesc.leverageHdths = 100n;
    }

    return this.orderDesc as OrderDesc;
  }
}

/**
 * Create a market buy (open long) order
 */
export function marketLong(params: {
  perpId: bigint;
  price: number;
  size: number;
  leverage: number;
  priceDecimals?: bigint;
  lotDecimals?: bigint;
}): OrderDesc {
  return OrderBuilder.forPerp(params.perpId)
    .openLong()
    .price(params.price, params.priceDecimals)
    .lot(params.size, params.lotDecimals)
    .leverage(params.leverage)
    .immediateOrCancel()
    .build();
}

/**
 * Create a market sell (open short) order
 */
export function marketShort(params: {
  perpId: bigint;
  price: number;
  size: number;
  leverage: number;
  priceDecimals?: bigint;
  lotDecimals?: bigint;
}): OrderDesc {
  return OrderBuilder.forPerp(params.perpId)
    .openShort()
    .price(params.price, params.priceDecimals)
    .lot(params.size, params.lotDecimals)
    .leverage(params.leverage)
    .immediateOrCancel()
    .build();
}

/**
 * Create a limit buy (open long) order
 */
export function limitLong(params: {
  perpId: bigint;
  price: number;
  size: number;
  leverage: number;
  postOnly?: boolean;
  priceDecimals?: bigint;
  lotDecimals?: bigint;
}): OrderDesc {
  const builder = OrderBuilder.forPerp(params.perpId)
    .openLong()
    .price(params.price, params.priceDecimals)
    .lot(params.size, params.lotDecimals)
    .leverage(params.leverage);

  if (params.postOnly) {
    builder.postOnly();
  }

  return builder.build();
}

/**
 * Create a limit sell (open short) order
 */
export function limitShort(params: {
  perpId: bigint;
  price: number;
  size: number;
  leverage: number;
  postOnly?: boolean;
  priceDecimals?: bigint;
  lotDecimals?: bigint;
}): OrderDesc {
  const builder = OrderBuilder.forPerp(params.perpId)
    .openShort()
    .price(params.price, params.priceDecimals)
    .lot(params.size, params.lotDecimals)
    .leverage(params.leverage);

  if (params.postOnly) {
    builder.postOnly();
  }

  return builder.build();
}

/**
 * Create a close position order
 */
export function closePosition(params: {
  perpId: bigint;
  isLong: boolean;
  price: number;
  size: number;
  priceDecimals?: bigint;
  lotDecimals?: bigint;
}): OrderDesc {
  const builder = OrderBuilder.forPerp(params.perpId)
    .price(params.price, params.priceDecimals)
    .lot(params.size, params.lotDecimals)
    .leverage(1); // Doesn't matter for close

  if (params.isLong) {
    builder.closeLong();
  } else {
    builder.closeShort();
  }

  return builder.build();
}
