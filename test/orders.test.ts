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
    // With PRICE_DECIMALS=1: price * 10^1
    expect(priceToPNS(45000)).toBe(450000n);
    expect(priceToPNS(0.5)).toBe(5n);
    expect(priceToPNS(100.1)).toBe(1001n);
  });

  it("converts PNS to human-readable price", () => {
    // With PRICE_DECIMALS=1: pns / 10^1
    expect(pnsToPrice(450000n)).toBe(45000);
    expect(pnsToPrice(5n)).toBe(0.5);
    expect(pnsToPrice(1001n)).toBeCloseTo(100.1);
  });

  it("handles custom decimal precision", () => {
    expect(priceToPNS(100, 8n)).toBe(10000000000n);
    expect(pnsToPrice(10000000000n, 8n)).toBe(100);
  });
});

describe("Lot Conversions", () => {
  it("converts lot to LNS format", () => {
    // With LOT_DECIMALS=5: lot * 10^5
    expect(lotToLNS(1)).toBe(100000n);
    expect(lotToLNS(0.1)).toBe(10000n);
    expect(lotToLNS(0.00001)).toBe(1n);
  });

  it("converts LNS to human-readable lot", () => {
    // With LOT_DECIMALS=5: lns / 10^5
    expect(lnsToLot(100000n)).toBe(1);
    expect(lnsToLot(10000n)).toBe(0.1);
    expect(lnsToLot(1n)).toBe(0.00001);
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
    expect(order.pricePNS).toBe(450000n); // 45000 * 10^1
    expect(order.lotLNS).toBe(10000n); // 0.1 * 10^5
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
    expect(order.pricePNS).toBe(460000n); // 46000 * 10^1
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

describe("All Order Types with OrderBuilder", () => {
  // Test all order types from OrderType enum
  const perpId = 16n; // BTC

  describe("Open Orders", () => {
    it("builds OpenLong with all options", () => {
      const order = OrderBuilder.forPerp(perpId)
        .openLong()
        .price(50000)
        .lot(0.1)
        .leverage(10)
        .postOnly()
        .expiry(1000000n)
        .maxMatches(5n)
        .build();

      expect(order.orderType).toBe(OrderType.OpenLong);
      expect(order.postOnly).toBe(true);
      expect(order.expiryBlock).toBe(1000000n);
      expect(order.maxMatches).toBe(5n);
    });

    it("builds OpenShort with IOC (market order)", () => {
      const order = OrderBuilder.forPerp(perpId)
        .openShort()
        .price(50000)
        .lot(0.1)
        .leverage(5)
        .immediateOrCancel()
        .build();

      expect(order.orderType).toBe(OrderType.OpenShort);
      expect(order.immediateOrCancel).toBe(true);
      expect(order.postOnly).toBe(false);
    });

    it("builds OpenLong with fill-or-kill", () => {
      const order = OrderBuilder.forPerp(perpId)
        .openLong()
        .price(50000)
        .lot(0.5)
        .leverage(3)
        .fillOrKill()
        .build();

      expect(order.orderType).toBe(OrderType.OpenLong);
      expect(order.fillOrKill).toBe(true);
    });
  });

  describe("Close Orders", () => {
    it("builds CloseLong limit order", () => {
      const order = OrderBuilder.forPerp(perpId)
        .closeLong()
        .price(55000)
        .lot(0.1)
        .leverage(1)
        .build();

      expect(order.orderType).toBe(OrderType.CloseLong);
      expect(order.pricePNS).toBe(550000n); // 55000 * 10^1
    });

    it("builds CloseShort market order (IOC)", () => {
      const order = OrderBuilder.forPerp(perpId)
        .closeShort()
        .price(48000)
        .lot(0.1)
        .leverage(1)
        .immediateOrCancel()
        .build();

      expect(order.orderType).toBe(OrderType.CloseShort);
      expect(order.immediateOrCancel).toBe(true);
    });

    it("builds CloseLong with post-only", () => {
      const order = OrderBuilder.forPerp(perpId)
        .closeLong()
        .price(52000)
        .lot(0.05)
        .leverage(1)
        .postOnly()
        .build();

      expect(order.orderType).toBe(OrderType.CloseLong);
      expect(order.postOnly).toBe(true);
    });
  });

  describe("Cancel Order", () => {
    it("builds Cancel order with order ID", () => {
      const orderId = 12345n;
      const order = OrderBuilder.forPerp(perpId)
        .cancel(orderId)
        .pricePNS(0n)
        .lotLNS(0n)
        .build();

      expect(order.orderType).toBe(OrderType.Cancel);
      expect(order.orderId).toBe(orderId);
      expect(order.pricePNS).toBe(0n);
      expect(order.lotLNS).toBe(0n);
    });
  });

  describe("Change Order", () => {
    it("builds Change order to modify price", () => {
      const orderId = 67890n;
      const order = OrderBuilder.forPerp(perpId)
        .change(orderId)
        .price(51000) // New price
        .lot(0.1) // Same size
        .leverage(10)
        .build();

      expect(order.orderType).toBe(OrderType.Change);
      expect(order.orderId).toBe(orderId);
      expect(order.pricePNS).toBe(510000n); // 51000 * 10^1
    });

    it("builds Change order to modify size", () => {
      const orderId = 11111n;
      const order = OrderBuilder.forPerp(perpId)
        .change(orderId)
        .price(50000)
        .lot(0.2) // New size
        .leverage(10)
        .build();

      expect(order.orderType).toBe(OrderType.Change);
      expect(order.lotLNS).toBe(20000n); // 0.2 * 10^5
    });
  });
});

describe("All Markets", () => {
  // Test order construction for each market
  const markets = {
    BTC: { perpId: 16n, typicalPrice: 50000, typicalSize: 0.001 },
    ETH: { perpId: 32n, typicalPrice: 3000, typicalSize: 0.01 },
    SOL: { perpId: 48n, typicalPrice: 100, typicalSize: 1 },
    MON: { perpId: 64n, typicalPrice: 1, typicalSize: 100 },
    ZEC: { perpId: 256n, typicalPrice: 30, typicalSize: 1 },
  };

  Object.entries(markets).forEach(([name, { perpId, typicalPrice, typicalSize }]) => {
    describe(`${name} Market (perpId: ${perpId})`, () => {
      it(`creates limit long for ${name}`, () => {
        const order = limitLong({
          perpId,
          price: typicalPrice * 0.95, // 5% below
          size: typicalSize,
          leverage: 5,
          postOnly: true,
        });

        expect(order.perpId).toBe(perpId);
        expect(order.orderType).toBe(OrderType.OpenLong);
        expect(order.postOnly).toBe(true);
      });

      it(`creates limit short for ${name}`, () => {
        const order = limitShort({
          perpId,
          price: typicalPrice * 1.05, // 5% above
          size: typicalSize,
          leverage: 5,
          postOnly: true,
        });

        expect(order.perpId).toBe(perpId);
        expect(order.orderType).toBe(OrderType.OpenShort);
      });

      it(`creates market long for ${name}`, () => {
        const order = marketLong({
          perpId,
          price: typicalPrice * 1.1, // Max price
          size: typicalSize,
          leverage: 3,
        });

        expect(order.perpId).toBe(perpId);
        expect(order.orderType).toBe(OrderType.OpenLong);
        expect(order.immediateOrCancel).toBe(true);
      });

      it(`creates market short for ${name}`, () => {
        const order = marketShort({
          perpId,
          price: typicalPrice * 0.9, // Min price
          size: typicalSize,
          leverage: 3,
        });

        expect(order.perpId).toBe(perpId);
        expect(order.orderType).toBe(OrderType.OpenShort);
        expect(order.immediateOrCancel).toBe(true);
      });

      it(`creates close long for ${name}`, () => {
        const order = closePosition({
          perpId,
          isLong: true,
          price: typicalPrice * 1.05,
          size: typicalSize,
        });

        expect(order.perpId).toBe(perpId);
        expect(order.orderType).toBe(OrderType.CloseLong);
      });

      it(`creates close short for ${name}`, () => {
        const order = closePosition({
          perpId,
          isLong: false,
          price: typicalPrice * 0.95,
          size: typicalSize,
        });

        expect(order.perpId).toBe(perpId);
        expect(order.orderType).toBe(OrderType.CloseShort);
      });
    });
  });
});

describe("Order Execution Modes", () => {
  const perpId = 16n;

  describe("Post-Only Orders", () => {
    it("creates post-only limit long", () => {
      const order = OrderBuilder.forPerp(perpId)
        .openLong()
        .price(45000)
        .lot(0.1)
        .leverage(10)
        .postOnly(true)
        .build();

      expect(order.postOnly).toBe(true);
      expect(order.fillOrKill).toBe(false);
      expect(order.immediateOrCancel).toBe(false);
    });

    it("can disable post-only explicitly", () => {
      const order = OrderBuilder.forPerp(perpId)
        .openLong()
        .price(45000)
        .lot(0.1)
        .leverage(10)
        .postOnly(false)
        .build();

      expect(order.postOnly).toBe(false);
    });
  });

  describe("Fill-or-Kill Orders", () => {
    it("creates FOK order that must fill completely", () => {
      const order = OrderBuilder.forPerp(perpId)
        .openLong()
        .price(45000)
        .lot(1)
        .leverage(5)
        .fillOrKill(true)
        .build();

      expect(order.fillOrKill).toBe(true);
      expect(order.postOnly).toBe(false);
      expect(order.immediateOrCancel).toBe(false);
    });
  });

  describe("Immediate-or-Cancel (IOC/Market) Orders", () => {
    it("creates IOC long (market buy)", () => {
      const order = OrderBuilder.forPerp(perpId)
        .openLong()
        .price(46000) // Max price
        .lot(0.1)
        .leverage(10)
        .immediateOrCancel(true)
        .build();

      expect(order.immediateOrCancel).toBe(true);
      expect(order.postOnly).toBe(false);
      expect(order.fillOrKill).toBe(false);
    });

    it("creates IOC short (market sell)", () => {
      const order = OrderBuilder.forPerp(perpId)
        .openShort()
        .price(44000) // Min price
        .lot(0.1)
        .leverage(10)
        .immediateOrCancel(true)
        .build();

      expect(order.immediateOrCancel).toBe(true);
    });

    it("creates IOC close long (market close)", () => {
      const order = OrderBuilder.forPerp(perpId)
        .closeLong()
        .price(44000) // Min price for closing long
        .lot(0.1)
        .leverage(1)
        .immediateOrCancel(true)
        .build();

      expect(order.orderType).toBe(OrderType.CloseLong);
      expect(order.immediateOrCancel).toBe(true);
    });

    it("creates IOC close short (market close)", () => {
      const order = OrderBuilder.forPerp(perpId)
        .closeShort()
        .price(46000) // Max price for closing short
        .lot(0.1)
        .leverage(1)
        .immediateOrCancel(true)
        .build();

      expect(order.orderType).toBe(OrderType.CloseShort);
      expect(order.immediateOrCancel).toBe(true);
    });
  });

  describe("Default Limit Orders", () => {
    it("creates standard limit order with all flags false", () => {
      const order = OrderBuilder.forPerp(perpId)
        .openLong()
        .price(44000)
        .lot(0.1)
        .leverage(10)
        .build();

      expect(order.postOnly).toBe(false);
      expect(order.fillOrKill).toBe(false);
      expect(order.immediateOrCancel).toBe(false);
    });
  });
});

describe("Leverage Variations", () => {
  const perpId = 16n;

  const leverageLevels = [1, 2, 3, 5, 10, 20, 50, 100];

  leverageLevels.forEach((lev) => {
    it(`creates order with ${lev}x leverage`, () => {
      const order = OrderBuilder.forPerp(perpId)
        .openLong()
        .price(50000)
        .lot(0.1)
        .leverage(lev)
        .build();

      expect(order.leverageHdths).toBe(BigInt(lev * 100));
    });
  });

  it("handles fractional leverage", () => {
    const order = OrderBuilder.forPerp(perpId)
      .openLong()
      .price(50000)
      .lot(0.1)
      .leverage(1.5)
      .build();

    expect(order.leverageHdths).toBe(150n);
  });
});

describe("Price Decimals Handling", () => {
  const perpId = 16n;

  it("uses default decimals", () => {
    const order = limitLong({
      perpId,
      price: 50000,
      size: 0.1,
      leverage: 10,
    });

    expect(order.pricePNS).toBe(500000n); // 50000 * 10^1
  });

  it("uses custom price decimals", () => {
    const order = limitLong({
      perpId,
      price: 50000,
      size: 0.1,
      leverage: 10,
      priceDecimals: 8n,
    });

    expect(order.pricePNS).toBe(5000000000000n); // 50000 * 10^8
  });

  it("uses custom lot decimals", () => {
    const order = limitLong({
      perpId,
      price: 50000,
      size: 0.1,
      leverage: 10,
      lotDecimals: 6n,
    });

    expect(order.lotLNS).toBe(100000n); // 0.1 * 10^6
  });
});

describe("Edge Cases", () => {
  const perpId = 16n;

  it("handles very small lot sizes", () => {
    const order = OrderBuilder.forPerp(perpId)
      .openLong()
      .price(50000)
      .lot(0.00001) // Smallest unit with LOT_DECIMALS=5
      .leverage(10)
      .build();

    expect(order.lotLNS).toBe(1n); // 0.00001 * 10^5 = 1
  });

  it("handles very large prices", () => {
    const order = OrderBuilder.forPerp(perpId)
      .openLong()
      .price(1000000) // $1M
      .lot(0.001)
      .leverage(1)
      .build();

    expect(order.pricePNS).toBe(10000000n); // 1000000 * 10^1
  });

  it("handles zero expiry (no expiry)", () => {
    const order = OrderBuilder.forPerp(perpId)
      .openLong()
      .price(50000)
      .lot(0.1)
      .leverage(10)
      .expiry(0n)
      .build();

    expect(order.expiryBlock).toBe(0n);
  });

  it("handles amountCNS for collateral operations", () => {
    const order = OrderBuilder.forPerp(perpId)
      .openLong()
      .price(50000)
      .lot(0.1)
      .leverage(10)
      .amountCNS(100000000n) // 100 USD
      .build();

    expect(order.amountCNS).toBe(100000000n);
  });
});
