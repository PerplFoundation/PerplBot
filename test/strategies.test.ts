/**
 * Tests for trading strategies
 */

import { describe, it, expect } from "vitest";
import {
  generateGridLevels,
  createGridOrders,
  calculateGridMetrics,
  GridStrategy,
  type GridConfig,
} from "../src/sdk/trading/strategies/grid.js";
import {
  MarketMakerStrategy,
  createSimpleMarketMaker,
  type MarketMakerConfig,
  type MarketState,
  type PositionState,
} from "../src/sdk/trading/strategies/marketMaker.js";
import { OrderType } from "../src/sdk/contracts/Exchange.js";

describe("Grid Strategy", () => {
  describe("generateGridLevels", () => {
    it("generates correct number of levels", () => {
      const levels = generateGridLevels(45000, 5, 100);

      expect(levels).toHaveLength(10); // 5 above + 5 below
    });

    it("generates levels at correct prices", () => {
      const levels = generateGridLevels(45000, 3, 100);

      // Buy levels below: 44700, 44800, 44900
      // Sell levels above: 45100, 45200, 45300
      expect(levels.map((l) => l.price).sort((a, b) => a - b)).toEqual([
        44700, 44800, 44900, 45100, 45200, 45300,
      ]);
    });

    it("assigns correct sides", () => {
      const levels = generateGridLevels(45000, 2, 100);

      const buyLevels = levels.filter((l) => l.side === "buy");
      const sellLevels = levels.filter((l) => l.side === "sell");

      expect(buyLevels).toHaveLength(2);
      expect(sellLevels).toHaveLength(2);

      // Buy levels should be below center
      buyLevels.forEach((l) => expect(l.price).toBeLessThan(45000));

      // Sell levels should be above center
      sellLevels.forEach((l) => expect(l.price).toBeGreaterThan(45000));
    });
  });

  describe("createGridOrders", () => {
    const config: GridConfig = {
      perpId: 0n,
      centerPrice: 45000,
      gridLevels: 2,
      gridSpacing: 100,
      orderSize: 0.1,
      leverage: 10,
    };

    it("creates orders for all grid levels", () => {
      const orders = createGridOrders(config);

      expect(orders).toHaveLength(4); // 2 above + 2 below
    });

    it("creates open long orders for buy levels", () => {
      const orders = createGridOrders(config);
      const buyOrders = orders.filter((o) => o.orderType === OrderType.OpenLong);

      expect(buyOrders).toHaveLength(2);
    });

    it("creates open short orders for sell levels", () => {
      const orders = createGridOrders(config);
      const sellOrders = orders.filter((o) => o.orderType === OrderType.OpenShort);

      expect(sellOrders).toHaveLength(2);
    });

    it("sets correct leverage", () => {
      const orders = createGridOrders(config);

      orders.forEach((o) => {
        expect(o.leverageHdths).toBe(1000n); // 10x
      });
    });

    it("respects post-only setting", () => {
      const postOnlyConfig = { ...config, postOnly: true };
      const orders = createGridOrders(postOnlyConfig);

      orders.forEach((o) => {
        expect(o.postOnly).toBe(true);
      });
    });
  });

  describe("calculateGridMetrics", () => {
    const config: GridConfig = {
      perpId: 0n,
      centerPrice: 45000,
      gridLevels: 5,
      gridSpacing: 100,
      orderSize: 0.1,
      leverage: 10,
    };

    it("calculates total capital", () => {
      const metrics = calculateGridMetrics(config, 50, 20); // 0.05% taker, 0.02% maker

      // Margin per order: 45000 * 0.1 / 10 = 450
      // Total orders: 10
      // Total capital: 450 * 10 = 4500
      expect(metrics.totalCapital).toBeCloseTo(4500);
    });

    it("calculates profit per round trip", () => {
      const metrics = calculateGridMetrics(config, 50, 20);

      // Gross: 100 * 0.1 = 10
      // Notional: 45000 * 0.1 = 4500
      // Maker fee: 4500 * 20 / 100000 = 0.9
      // Taker fee: 4500 * 50 / 100000 = 2.25
      // Net: 10 - 0.9 - 2.25 = 6.85
      expect(metrics.profitPerRoundTrip).toBeCloseTo(6.85);
    });

    it("calculates max position size", () => {
      const metrics = calculateGridMetrics(config, 50, 20);

      expect(metrics.maxPositionSize).toBe(0.5); // 5 levels * 0.1
    });
  });

  describe("GridStrategy class", () => {
    const config: GridConfig = {
      perpId: 0n,
      centerPrice: 45000,
      gridLevels: 2,
      gridSpacing: 100,
      orderSize: 0.1,
      leverage: 10,
    };

    it("returns initial orders", () => {
      const strategy = new GridStrategy(config);
      const orders = strategy.getInitialOrders();

      expect(orders).toHaveLength(4);
    });

    it("returns grid levels", () => {
      const strategy = new GridStrategy(config);
      const levels = strategy.getLevels();

      expect(levels).toHaveLength(4);
    });

    it("tracks orders", () => {
      const strategy = new GridStrategy(config);
      strategy.trackOrder(1n, 44900);

      // Order should be tracked internally
      const cancelOrders = strategy.getCancelOrders();
      expect(cancelOrders.length).toBeGreaterThan(0);
    });
  });
});

describe("Market Maker Strategy", () => {
  describe("calculateQuotes", () => {
    const config: MarketMakerConfig = {
      perpId: 0n,
      orderSize: 0.1,
      spreadPercent: 0.001, // 0.1%
      leverage: 5,
      maxPosition: 1,
    };

    const strategy = new MarketMakerStrategy(config);

    const neutralMarket: MarketState = {
      bestBid: 44990,
      bestAsk: 45010,
      midPrice: 45000,
    };

    it("quotes around mid price", () => {
      const quotes = strategy.calculateQuotes(neutralMarket, { size: 0 });

      // Spread: 45000 * 0.001 = 45
      // Bid: 45000 - 45 = 44955
      // Ask: 45000 + 45 = 45045
      expect(quotes.bidPrice).toBeLessThan(45000);
      expect(quotes.askPrice).toBeGreaterThan(45000);
    });

    it("maintains spread width", () => {
      const quotes = strategy.calculateQuotes(neutralMarket, { size: 0 });

      const spreadWidth = quotes.askPrice - quotes.bidPrice;
      const expectedSpread = 45000 * 0.001 * 2;

      expect(spreadWidth).toBeCloseTo(expectedSpread);
    });

    it("skews quotes when long", () => {
      const longPosition: PositionState = { size: 0.5 }; // 50% of max
      const quotes = strategy.calculateQuotes(neutralMarket, longPosition);
      const neutralQuotes = strategy.calculateQuotes(neutralMarket, { size: 0 });

      // When long, should tighten ask (encourage selling)
      expect(quotes.askPrice).toBeLessThanOrEqual(neutralQuotes.askPrice);
    });

    it("skews quotes when short", () => {
      const shortPosition: PositionState = { size: -0.5 }; // 50% of max short
      const quotes = strategy.calculateQuotes(neutralMarket, shortPosition);
      const neutralQuotes = strategy.calculateQuotes(neutralMarket, { size: 0 });

      // When short, should tighten bid (encourage buying)
      expect(quotes.bidPrice).toBeGreaterThanOrEqual(neutralQuotes.bidPrice);
    });

    it("stops quoting bid when at max long", () => {
      const maxLong: PositionState = { size: 1 }; // At max
      const quotes = strategy.calculateQuotes(neutralMarket, maxLong);

      expect(quotes.bidSize).toBe(0);
      expect(quotes.askSize).toBeGreaterThan(0);
    });

    it("stops quoting ask when at max short", () => {
      const maxShort: PositionState = { size: -1 }; // At max short
      const quotes = strategy.calculateQuotes(neutralMarket, maxShort);

      expect(quotes.askSize).toBe(0);
      expect(quotes.bidSize).toBeGreaterThan(0);
    });
  });

  describe("generateOrders", () => {
    const config: MarketMakerConfig = {
      perpId: 0n,
      orderSize: 0.1,
      spreadPercent: 0.001,
      leverage: 5,
      maxPosition: 1,
      postOnly: true,
    };

    const strategy = new MarketMakerStrategy(config);

    it("generates bid and ask orders", () => {
      const quotes = {
        bidPrice: 44950,
        bidSize: 0.1,
        askPrice: 45050,
        askSize: 0.1,
      };

      const { bidOrder, askOrder } = strategy.generateOrders(quotes);

      expect(bidOrder).toBeDefined();
      expect(askOrder).toBeDefined();
      expect(bidOrder?.orderType).toBe(OrderType.OpenLong);
      expect(askOrder?.orderType).toBe(OrderType.OpenShort);
    });

    it("respects post-only setting", () => {
      const quotes = {
        bidPrice: 44950,
        bidSize: 0.1,
        askPrice: 45050,
        askSize: 0.1,
      };

      const { bidOrder, askOrder } = strategy.generateOrders(quotes);

      expect(bidOrder?.postOnly).toBe(true);
      expect(askOrder?.postOnly).toBe(true);
    });

    it("skips order when size is 0", () => {
      const quotes = {
        bidPrice: 44950,
        bidSize: 0, // No bid
        askPrice: 45050,
        askSize: 0.1,
      };

      const { bidOrder, askOrder } = strategy.generateOrders(quotes);

      expect(bidOrder).toBeUndefined();
      expect(askOrder).toBeDefined();
    });
  });

  describe("shouldUpdateQuotes", () => {
    const strategy = createSimpleMarketMaker(0n, 0.1);

    it("returns true when price moved significantly", () => {
      const shouldUpdate = strategy.shouldUpdateQuotes(45000, 45100, 0.001);

      expect(shouldUpdate).toBe(true);
    });

    it("returns false when price barely moved", () => {
      const shouldUpdate = strategy.shouldUpdateQuotes(45000, 45010, 0.001);

      expect(shouldUpdate).toBe(false);
    });
  });

  describe("createSimpleMarketMaker", () => {
    it("creates strategy with defaults", () => {
      const strategy = createSimpleMarketMaker(0n, 0.1);

      expect(strategy).toBeInstanceOf(MarketMakerStrategy);
    });

    it("creates strategy with custom leverage", () => {
      const strategy = createSimpleMarketMaker(0n, 0.1, 5);

      const quotes = strategy.calculateQuotes(
        { bestBid: 44990, bestAsk: 45010, midPrice: 45000 },
        { size: 0 }
      );
      const { bidOrder } = strategy.generateOrders(quotes);

      expect(bidOrder?.leverageHdths).toBe(500n);
    });
  });
});
