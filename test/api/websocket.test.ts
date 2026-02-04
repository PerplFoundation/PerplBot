import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Mock WebSocket before importing the client
class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  url: string;

  constructor(url: string, _options?: unknown) {
    super();
    this.url = url;
    // Simulate async connection
    setTimeout(() => this.emit("open"), 0);
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });
}

// Mock the ws module
vi.mock("ws", () => ({
  default: MockWebSocket,
}));

// Import after mocking
import { PerplWebSocketClient } from "../../src/sdk/api/websocket.js";

describe("PerplWebSocketClient", () => {
  let wsClient: PerplWebSocketClient;
  const wsUrl = "wss://testnet.perpl.xyz";
  const chainId = 10143;

  beforeEach(() => {
    vi.useFakeTimers();
    wsClient = new PerplWebSocketClient(wsUrl, chainId);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates client with config", () => {
      expect(wsClient).toBeDefined();
      expect(wsClient.isConnected()).toBe(false);
    });
  });

  describe("connectMarketData", () => {
    it("connects to market data endpoint", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      expect(wsClient.isConnected()).toBe(true);
    });

    it("emits connect event", async () => {
      const connectHandler = vi.fn();
      wsClient.on("connect", connectHandler);

      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      expect(connectHandler).toHaveBeenCalled();
    });
  });

  describe("subscribeOrderBook", () => {
    it("sends subscription message", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      wsClient.subscribeOrderBook(16);

      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        JSON.stringify({
          mt: 5,
          subs: [{ stream: "order-book@16", subscribe: true }],
        })
      );
    });
  });

  describe("subscribeTrades", () => {
    it("sends subscription message", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      wsClient.subscribeTrades(16);

      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        JSON.stringify({
          mt: 5,
          subs: [{ stream: "trades@16", subscribe: true }],
        })
      );
    });
  });

  describe("subscribeMarketState", () => {
    it("sends subscription with chain ID", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      wsClient.subscribeMarketState();

      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        JSON.stringify({
          mt: 5,
          subs: [{ stream: `market-state@${chainId}`, subscribe: true }],
        })
      );
    });
  });

  describe("subscribeHeartbeat", () => {
    it("sends heartbeat subscription", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      wsClient.subscribeHeartbeat();

      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        JSON.stringify({
          mt: 5,
          subs: [{ stream: `heartbeat@${chainId}`, subscribe: true }],
        })
      );
    });
  });

  describe("disconnect", () => {
    it("closes WebSocket connection", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      wsClient.disconnect();

      expect(wsClient.isConnected()).toBe(false);
    });
  });

  describe("message handling", () => {
    it("emits order-book on L2BookSnapshot (mt: 15)", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const handler = vi.fn();
      wsClient.on("order-book", handler);

      // Get the mock WebSocket instance and emit message
      const mockWs = (wsClient as any).ws;
      const message = {
        mt: 15,
        sid: 1,
        at: { b: 1000, t: Date.now() },
        bid: [{ p: 100, s: 10, o: 1 }],
        ask: [{ p: 101, s: 10, o: 1 }],
      };
      mockWs.emit("message", Buffer.from(JSON.stringify(message)));

      expect(handler).toHaveBeenCalledWith(message);
    });

    it("emits order-book on L2BookUpdate (mt: 16)", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const handler = vi.fn();
      wsClient.on("order-book", handler);

      const mockWs = (wsClient as any).ws;
      const message = { mt: 16, bid: [], ask: [] };
      mockWs.emit("message", Buffer.from(JSON.stringify(message)));

      expect(handler).toHaveBeenCalledWith(message);
    });

    it("emits trades on TradesSnapshot (mt: 17)", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const handler = vi.fn();
      wsClient.on("trades", handler);

      const mockWs = (wsClient as any).ws;
      const trades = [{ p: 100, s: 10, sd: 1 }];
      mockWs.emit("message", Buffer.from(JSON.stringify({ mt: 17, d: trades })));

      expect(handler).toHaveBeenCalledWith(trades);
    });

    it("emits market-state on MarketStateUpdate (mt: 9)", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const handler = vi.fn();
      wsClient.on("market-state", handler);

      const mockWs = (wsClient as any).ws;
      const state = { 16: { mrk: 100000 } };
      mockWs.emit("message", Buffer.from(JSON.stringify({ mt: 9, d: state })));

      expect(handler).toHaveBeenCalledWith(state);
    });

    it("emits heartbeat on Heartbeat (mt: 100)", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const handler = vi.fn();
      wsClient.on("heartbeat", handler);

      const mockWs = (wsClient as any).ws;
      mockWs.emit("message", Buffer.from(JSON.stringify({ mt: 100, h: 12345 })));

      expect(handler).toHaveBeenCalledWith(12345);
    });

    it("emits wallet on WalletSnapshot (mt: 19)", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const handler = vi.fn();
      wsClient.on("wallet", handler);

      const mockWs = (wsClient as any).ws;
      const accounts = [{ in: 1, id: 100, fr: false, fw: true, b: "1000", lb: "0" }];
      mockWs.emit("message", Buffer.from(JSON.stringify({ mt: 19, as: accounts })));

      expect(handler).toHaveBeenCalledWith(accounts);
    });

    it("emits orders on OrdersSnapshot (mt: 23)", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const handler = vi.fn();
      wsClient.on("orders", handler);

      const mockWs = (wsClient as any).ws;
      const orders = [{ oid: 1, mkt: 16, st: 2 }];
      mockWs.emit("message", Buffer.from(JSON.stringify({ mt: 23, d: orders })));

      expect(handler).toHaveBeenCalledWith(orders);
    });

    it("emits positions on PositionsSnapshot (mt: 26)", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const handler = vi.fn();
      wsClient.on("positions", handler);

      const mockWs = (wsClient as any).ws;
      const positions = [{ pid: 1, mkt: 16, st: 1 }];
      mockWs.emit("message", Buffer.from(JSON.stringify({ mt: 26, d: positions })));

      expect(handler).toHaveBeenCalledWith(positions);
    });

    it("emits fills on FillsUpdate (mt: 25)", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const handler = vi.fn();
      wsClient.on("fills", handler);

      const mockWs = (wsClient as any).ws;
      const fills = [{ oid: 1, mkt: 16, s: 100 }];
      mockWs.emit("message", Buffer.from(JSON.stringify({ mt: 25, d: fills })));

      expect(handler).toHaveBeenCalledWith(fills);
    });
  });

  describe("order submission", () => {
    it("submitOrder sends order request", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const requestId = wsClient.submitOrder({
        rq: 12345,
        mkt: 16,
        acc: 100,
        t: 1, // OpenLong
        p: 100000,
        s: 1000,
        fl: 4, // IOC
        lv: 1000,
        lb: 50000,
      });

      expect(requestId).toBe(12345);
      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        expect.stringContaining('"mt":22')
      );
    });

    it("openLong sends correct order", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      vi.useRealTimers(); // Need real Date.now()

      const requestId = wsClient.openLong({
        marketId: 16,
        accountId: 100,
        size: 1000,
        leverage: 1000,
        lastBlock: 50000,
      });

      expect(typeof requestId).toBe("number");
      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        expect.stringContaining('"t":1') // OpenLong
      );
    });

    it("openShort sends correct order", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      vi.useRealTimers();

      wsClient.openShort({
        marketId: 16,
        accountId: 100,
        size: 1000,
        leverage: 1000,
        lastBlock: 50000,
      });

      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        expect.stringContaining('"t":2') // OpenShort
      );
    });

    it("closeLong sends correct order", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      vi.useRealTimers();

      wsClient.closeLong({
        marketId: 16,
        accountId: 100,
        positionId: 50,
        size: 1000,
        lastBlock: 50000,
      });

      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        expect.stringContaining('"t":3') // CloseLong
      );
    });

    it("closeShort sends correct order", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      vi.useRealTimers();

      wsClient.closeShort({
        marketId: 16,
        accountId: 100,
        positionId: 50,
        size: 1000,
        lastBlock: 50000,
      });

      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        expect.stringContaining('"t":4') // CloseShort
      );
    });

    it("cancelOrder sends cancel request", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      vi.useRealTimers();

      wsClient.cancelOrder(16, 100, 999, 50000);

      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        expect.stringContaining('"t":5') // Cancel
      );
      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        expect.stringContaining('"oid":999')
      );
    });
  });

  describe("subscription response handling", () => {
    it("stores subscription IDs from response", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const mockWs = (wsClient as any).ws;
      mockWs.emit(
        "message",
        Buffer.from(
          JSON.stringify({
            mt: 6,
            subs: [{ stream: "order-book@16", sid: 12345 }],
          })
        )
      );

      const subscriptions = (wsClient as any).subscriptions as Map<string, number>;
      expect(subscriptions.get("order-book@16")).toBe(12345);
    });
  });

  describe("ping/pong", () => {
    it("sends periodic pings", async () => {
      vi.useRealTimers();
      const connectPromise = wsClient.connectMarketData();

      // Wait for connection
      await new Promise((r) => setTimeout(r, 10));
      await connectPromise;

      // Fast-forward 30 seconds
      vi.useFakeTimers();
      vi.advanceTimersByTime(30000);

      expect(MockWebSocket.prototype.send).toHaveBeenCalledWith(
        expect.stringContaining('"mt":1')
      );
    });
  });

  describe("error handling", () => {
    it("emits error on WebSocket error", async () => {
      const errorHandler = vi.fn();
      wsClient.on("error", errorHandler);

      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();

      try {
        await connectPromise;
      } catch {
        // Ignore connection errors
      }

      const mockWs = (wsClient as any).ws;
      if (mockWs) {
        const error = new Error("WebSocket error");
        mockWs.emit("error", error);
        expect(errorHandler).toHaveBeenCalledWith(error);
      }
    });

    it("emits error on invalid JSON message", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const errorHandler = vi.fn();
      wsClient.on("error", errorHandler);

      const mockWs = (wsClient as any).ws;
      mockWs.emit("message", Buffer.from("not valid json"));

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe("disconnect handling", () => {
    it("emits disconnect event with code", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const disconnectHandler = vi.fn();
      wsClient.on("disconnect", disconnectHandler);

      const mockWs = (wsClient as any).ws;
      mockWs.emit("close", 1000);

      expect(disconnectHandler).toHaveBeenCalledWith(1000);
    });

    it("emits auth-expired on code 3401", async () => {
      const connectPromise = wsClient.connectMarketData();
      await vi.runAllTimersAsync();
      await connectPromise;

      const authExpiredHandler = vi.fn();
      wsClient.on("auth-expired", authExpiredHandler);

      const mockWs = (wsClient as any).ws;
      mockWs.emit("close", 3401);

      expect(authExpiredHandler).toHaveBeenCalled();
    });
  });
});
