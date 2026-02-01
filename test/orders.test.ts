/**
 * Tests for order construction utilities
 */

import { describe, it, expect } from "vitest";
import {
  priceToPNS,
  pnsToPrice,
  lotToLNS,
  lnsToLot,
  leverageToHdths,
  hdthsToLeverage,
  OrderBuilder,
  marketLong,
  marketShort,
  limitLong,
  limitShort,
  closePosition,
  PRICE_DECIMALS,
  LOT_DECIMALS,
} from "../src/sdk/trading/orders.js";
import { OrderType } from "../src/sdk/contracts/Exchange.js";

describe("Price Conversions", () => {
  it("converts price to PNS format", () => {
    expect(priceToPNS(45000)).toBe(45000000000n);
    expect(priceToPNS(0.5)).toBe(500000n);
    expect(priceToPNS(100.123456)).toBe(100123456n);
  });

  it("converts PNS to human-readable price", () => {
    expect(pnsToPrice(45000000000n)).toBe(45000);
    expect(pnsToPrice(500000n)).toBe(0.5);
    expect(pnsToPrice(100123456n)).toBeCloseTo(100.123456);
  });

  it("handles custom decimal precision", () => {
    expect(priceToPNS(100, 8n)).toBe(10000000000n);
    expect(pnsToPrice(10000000000n, 8n)).toBe(100);
  });
});

describe("Lot Conversions", () => {
  it("converts lot to LNS format", () => {
    expect(lotToLNS(1)).toBe(100000000n);
    expect(lotToLNS(0.1)).toBe(10000000n);
    expect(lotToLNS(0.00001)).toBe(1000n);
  });

  it("converts LNS to human-readable lot", () => {
    expect(lnsToLot(100000000n)).toBe(1);
    expect(lnsToLot(10000000n)).toBe(0.1);
    expect(lnsToLot(1000n)).toBe(0.00001);
  });
});

describe("Leverage Conversions", () => {
  it("converts leverage to hundredths", () => {
    expect(leverageToHdths(1)).toBe(100n);
    expect(leverageToHdths(10)).toBe(1000n);
    expect(leverageToHdths(2.5)).toBe(250n);
  });

  it("converts hundredths to leverage", () => {
    expect(hdthsToLeverage(100n)).toBe(1);
    expect(hdthsToLeverage(1000n)).toBe(10);
    expect(hdthsToLeverage(250n)).toBe(2.5);
  });
});

describe("OrderBuilder", () => {
  const perpId = 0n;

  it("builds an open long order", () => {
    const order = OrderBuilder.forPerp(perpId)
      .openLong()
      .price(45000)
      .lot(0.1)
      .leverage(10)
      .build();

    expect(order.perpId).toBe(perpId);
    expect(order.orderType).toBe(OrderType.OpenLong);
    expect(order.pricePNS).toBe(45000000000n);
    expect(order.lotLNS).toBe(10000000n);
    expect(order.leverageHdths).toBe(1000n);
    expect(order.postOnly).toBe(false);
  });

  it("builds an open short order with post-only", () => {
    const order = OrderBuilder.forPerp(perpId)
      .openShort()
      .price(2500)
      .lot(1)
      .leverage(5)
      .postOnly()
      .build();

    expect(order.orderType).toBe(OrderType.OpenShort);
    expect(order.postOnly).toBe(true);
    expect(order.leverageHdths).toBe(500n);
  });

  it("builds a close long order", () => {
    const order = OrderBuilder.forPerp(perpId)
      .closeLong()
      .price(46000)
      .lot(0.1)
      .leverage(1) // Required but not used
      .build();

    expect(order.orderType).toBe(OrderType.CloseLong);
    expect(order.pricePNS).toBe(46000000000n);
  });

  it("builds a close short order", () => {
    const order = OrderBuilder.forPerp(perpId)
      .closeShort()
      .price(2400)
      .lot(1)
      .leverage(1)
      .build();

    expect(order.orderType).toBe(OrderType.CloseShort);
  });

  it("builds a cancel order", () => {
    const order = OrderBuilder.forPerp(perpId)
      .cancel(123n)
      .pricePNS(0n)
      .lotLNS(0n)
      .build();

    expect(order.orderType).toBe(OrderType.Cancel);
    expect(order.orderId).toBe(123n);
  });

  it("builds a change order", () => {
    const order = OrderBuilder.forPerp(perpId)
      .change(456n)
      .price(45500)
      .lot(0.2)
      .leverage(10)
      .build();

    expect(order.orderType).toBe(OrderType.Change);
    expect(order.orderId).toBe(456n);
  });

  it("supports fill-or-kill", () => {
    const order = OrderBuilder.forPerp(perpId)
      .openLong()
      .price(45000)
      .lot(0.1)
      .leverage(10)
      .fillOrKill()
      .build();

    expect(order.fillOrKill).toBe(true);
  });

  it("supports immediate-or-cancel", () => {
    const order = OrderBuilder.forPerp(perpId)
      .openLong()
      .price(45000)
      .lot(0.1)
      .leverage(10)
      .immediateOrCancel()
      .build();

    expect(order.immediateOrCancel).toBe(true);
  });

  it("throws when perp ID is missing", () => {
    expect(() =>
      new OrderBuilder(undefined as any).openLong().price(45000).lot(0.1).build()
    ).toThrow();
  });

  it("throws when order type is missing", () => {
    expect(() =>
      OrderBuilder.forPerp(perpId).price(45000).lot(0.1).build()
    ).toThrow("Order type is required");
  });

  it("throws when price is missing", () => {
    expect(() =>
      OrderBuilder.forPerp(perpId).openLong().lot(0.1).build()
    ).toThrow("Price is required");
  });

  it("throws when lot is missing", () => {
    expect(() =>
      OrderBuilder.forPerp(perpId).openLong().price(45000).build()
    ).toThrow("Lot size is required");
  });
});

describe("Order Factory Functions", () => {
  const perpId = 0n;

  it("creates market long order", () => {
    const order = marketLong({
      perpId,
      price: 45000,
      size: 0.1,
      leverage: 10,
    });

    expect(order.orderType).toBe(OrderType.OpenLong);
    expect(order.immediateOrCancel).toBe(true);
    expect(order.leverageHdths).toBe(1000n);
  });

  it("creates market short order", () => {
    const order = marketShort({
      perpId,
      price: 45000,
      size: 0.1,
      leverage: 10,
    });

    expect(order.orderType).toBe(OrderType.OpenShort);
    expect(order.immediateOrCancel).toBe(true);
  });

  it("creates limit long order", () => {
    const order = limitLong({
      perpId,
      price: 44000,
      size: 0.1,
      leverage: 10,
    });

    expect(order.orderType).toBe(OrderType.OpenLong);
    expect(order.immediateOrCancel).toBe(false);
    expect(order.postOnly).toBe(false);
  });

  it("creates limit long order with post-only", () => {
    const order = limitLong({
      perpId,
      price: 44000,
      size: 0.1,
      leverage: 10,
      postOnly: true,
    });

    expect(order.postOnly).toBe(true);
  });

  it("creates limit short order", () => {
    const order = limitShort({
      perpId,
      price: 46000,
      size: 0.1,
      leverage: 10,
    });

    expect(order.orderType).toBe(OrderType.OpenShort);
  });

  it("creates close position order for long", () => {
    const order = closePosition({
      perpId,
      isLong: true,
      price: 46000,
      size: 0.1,
    });

    expect(order.orderType).toBe(OrderType.CloseLong);
  });

  it("creates close position order for short", () => {
    const order = closePosition({
      perpId,
      isLong: false,
      price: 44000,
      size: 0.1,
    });

    expect(order.orderType).toBe(OrderType.CloseShort);
  });
});
