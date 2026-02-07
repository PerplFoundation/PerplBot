/**
 * Dry-run simulation tests
 * Tests for report formatting, CLI flag registration, and simulation types
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { OrderType, type OrderDesc, type PerpetualInfo } from "../../src/sdk/contracts/Exchange.js";
import { priceToPNS, lotToLNS, leverageToHdths } from "../../src/sdk/trading/orders.js";

// Disable chalk colors for deterministic test output
beforeAll(() => {
  process.env.NO_COLOR = "1";
});

// ============ Report Formatting ============

describe("Dry-run report", () => {
  let printDryRunReport: typeof import("../../src/sdk/simulation/report.js").printDryRunReport;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const mod = await import("../../src/sdk/simulation/report.js");
    printDryRunReport = mod.printDryRunReport;
  });

  const makeOrderDesc = (overrides?: Partial<OrderDesc>): OrderDesc => ({
    orderDescId: 0n,
    perpId: 16n,
    orderType: OrderType.OpenLong,
    orderId: 0n,
    pricePNS: priceToPNS(50000, 1n),
    lotLNS: lotToLNS(1, 5n),
    expiryBlock: 0n,
    postOnly: false,
    fillOrKill: false,
    immediateOrCancel: true,
    maxMatches: 0n,
    leverageHdths: leverageToHdths(10),
    lastExecutionBlock: 0n,
    amountCNS: 0n,
    ...overrides,
  });

  it("should print success report for simulated trade", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: {
          success: true,
          perpId: 16n,
          orderId: 47n,
          gasEstimate: 342891n,
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("DRY RUN");
    expect(output).toContain("BTC-PERP");
    expect(output).toContain("Open Long");
    expect(output).toContain("SUCCESS");
    expect(output).toContain("47");
    expect(output).toContain("without --dry-run");
  });

  it("should print failure report with revert reason", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: {
          success: false,
          perpId: 0n,
          orderId: 0n,
          gasEstimate: 0n,
          revertReason: "Insufficient balance",
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("FAILED");
    expect(output).toContain("Insufficient balance");
    expect(output).toContain("would revert");
  });

  it("should print fork results when available", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: {
          success: true,
          perpId: 16n,
          orderId: 47n,
          gasEstimate: 342891n,
        },
        fork: {
          txHash: "0xabc123" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 50000000000n, // 50 gwei
          gasCostWei: 15000000000000000n,
          preState: {
            balanceCNS: 1000000000n, // 1000 USDC
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n, // 1 ETH
          },
          postState: {
            balanceCNS: 900000000n, // 900 USDC
            lockedBalanceCNS: 100000000n, // 100 USDC locked
            position: {
              positionType: 0, // Long
              lotLNS: 100000n, // 1.00000 lots
              pricePNS: 500000n,
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 985000000000000000n,
          },
          events: [
            { eventName: "OrderPlaced", args: { perpId: 16n, orderId: 47n } },
          ],
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("Fork Simulation (Anvil)");
    expect(output).toContain("Gas Used:");
    expect(output).toContain("Account Changes:");
    expect(output).toContain("Position Changes:");
    expect(output).toContain("Before: No position");
    expect(output).toContain("After:");
    expect(output).toContain("LONG");
    expect(output).toContain("OrderPlaced");
  });

  it("should show Foundry install hint when no fork available", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: {
          success: true,
          perpId: 16n,
          orderId: 47n,
          gasEstimate: 0n,
        },
      },
      makeOrderDesc(),
      "ETH",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("Anvil not available");
    expect(output).toContain("getfoundry.sh");
  });

  it("should handle close order types", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: {
          success: true,
          perpId: 16n,
          orderId: 5n,
          gasEstimate: 200000n,
        },
      },
      makeOrderDesc({ orderType: OrderType.CloseLong }),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("Close Long");
  });

  it("should display post-only and fill-or-kill flags", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: {
          success: true,
          perpId: 16n,
          orderId: 10n,
          gasEstimate: 200000n,
        },
      },
      makeOrderDesc({ postOnly: true, immediateOrCancel: false }),
      "ETH",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("Post-only");
  });

  // ============ Visualization Tests ============

  const makePerpInfo = (overrides?: Partial<PerpetualInfo>): PerpetualInfo => ({
    name: "BTC",
    symbol: "BTC",
    priceDecimals: 1n,
    lotDecimals: 5n,
    markPNS: 985000n,
    markTimestamp: 0n,
    oraclePNS: 985000n,
    longOpenInterestLNS: 500000n, // 5.00 lots
    shortOpenInterestLNS: 300000n, // 3.00 lots
    fundingStartBlock: 0n,
    fundingRatePct100k: 0,
    synthPerpPricePNS: 0n,
    paused: false,
    basePricePNS: 900000n, // base = 90,000.0
    maxBidPriceONS: 70500n, // 90000 + 7050 = 97,050.0
    minBidPriceONS: 60000n, // 90000 + 6000 = 96,000.0
    maxAskPriceONS: 72000n, // 90000 + 7200 = 97,200.0
    minAskPriceONS: 85000n, // 90000 + 8500 = 98,500.0
    numOrders: 12n,
    ...overrides,
  });

  it("should render balance bar chart with Unicode blocks", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 900000000n,
            lockedBalanceCNS: 100000000n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          events: [],
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("█");
    expect(output).toContain("Before:");
    expect(output).toContain("After:");
  });

  it("should render mini orderbook with ASK/BID/spread", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 900000000n,
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 971000n,
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
          perpInfo: makePerpInfo(),
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("ASK");
    expect(output).toContain("BID");
    expect(output).toContain("spread");
    expect(output).toContain("Orderbook Spread");
    expect(output).toContain("12 resting orders");
  });

  it("should render price scale with LIQ/ENTRY/MARK", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 900000000n,
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 971000n, // entry = 97,100.0
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
          perpInfo: makePerpInfo(),
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("LIQ");
    expect(output).toContain("ENTRY");
    expect(output).toContain("MARK");
    expect(output).toContain("Price Scale");
    expect(output).toContain("Distance to liq");
  });

  it("should gracefully degrade when perpInfo is undefined", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 900000000n,
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 500000n,
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
          // perpInfo intentionally omitted
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    // Should still render the basic report without orderbook/price scale
    expect(output).toContain("Fork Simulation (Anvil)");
    expect(output).toContain("Account Changes");
    expect(output).not.toContain("Orderbook Spread");
    expect(output).not.toContain("Price Scale");
  });

  // ============ Bar Chart Edge Cases ============

  it("should render bar chart with equal pre/post balances", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 500000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 500000000n, // same as pre
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          events: [],
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    // Both bars should be full width (equal) — no shade blocks in the bar chart
    expect(output).toContain("█");
    expect(output).toContain("Before:");
    expect(output).toContain("After:");
    // The balance bar lines should have full blocks and no shade (equal balances)
    const barLine = logs.find((l) => l.includes("Before:") && l.includes("█"));
    expect(barLine).toBeDefined();
    expect(barLine).not.toContain("░");
  });

  it("should render bar chart when balance increases (post > pre)", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 500000000n, // 500 USDC
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 500000n,
              depositCNS: 100000000n,
              pnlCNS: 50000000n,
            },
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 600000000n, // 600 USDC (increased after closing profitable position)
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          events: [],
        },
      },
      makeOrderDesc({ orderType: OrderType.CloseLong }),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    // After bar should be green (post > pre)
    expect(output).toContain("█");
    // Balance diff should show positive
    expect(output).toContain("+100.00");
  });

  it("should handle bar chart with zero pre-balance", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 0n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          events: [],
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("█");
    // Pre bar should be all shade (zero), post should be all full
    expect(output).toContain("░");
  });

  // ============ Orderbook Edge Cases ============

  it("should skip orderbook when numOrders is 0", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 900000000n,
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 971000n,
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
          perpInfo: makePerpInfo({ numOrders: 0n }),
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).not.toContain("Orderbook Spread");
    expect(output).not.toContain("resting orders");
  });

  it("should skip orderbook when all ONS values are zero", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 900000000n,
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 971000n,
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
          perpInfo: makePerpInfo({
            numOrders: 5n,
            maxBidPriceONS: 0n,
            minBidPriceONS: 0n,
            maxAskPriceONS: 0n,
            minAskPriceONS: 0n,
          }),
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    // Prints header + order count, but skips the actual bars
    expect(output).not.toContain("ASK");
    expect(output).not.toContain("BID");
  });

  it("should render open interest bars in orderbook", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 900000000n,
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 971000n,
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
          perpInfo: makePerpInfo({
            longOpenInterestLNS: 500000n, // 5.00 lots
            shortOpenInterestLNS: 300000n, // 3.00 lots
          }),
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("Open Interest");
    expect(output).toContain("LONG");
    expect(output).toContain("SHORT");
    expect(output).toContain("5.00 lots");
    expect(output).toContain("3.00 lots");
  });

  it("should show fill price indicator in orderbook", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 900000000n,
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 971000n, // fill at 97,100.0
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
          perpInfo: makePerpInfo(),
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("▲ fill:");
    expect(output).toContain("97,100");
  });

  // ============ Price Scale Edge Cases ============

  it("should render price scale for short position with liq above entry", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 900000000n,
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 1, // SHORT
              lotLNS: 100000n,
              pricePNS: 971000n, // entry = 97,100.0
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
          perpInfo: makePerpInfo(),
        },
      },
      makeOrderDesc({ orderType: OrderType.OpenShort }),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("Price Scale");
    expect(output).toContain("LIQ");
    expect(output).toContain("ENTRY");
    expect(output).toContain("MARK");
    // For shorts, liq is above entry
    expect(output).toContain("above entry");
  });

  it("should skip price scale when post position is null (position closed)", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 500000000n,
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 971000n,
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 600000000n,
            lockedBalanceCNS: 0n,
            position: null, // position closed
            ethBalance: 1000000000000000000n,
          },
          events: [],
          perpInfo: makePerpInfo(),
        },
      },
      makeOrderDesc({ orderType: OrderType.CloseLong }),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).not.toContain("Price Scale");
    expect(output).not.toContain("Distance to liq");
  });

  it("should skip price scale when leverage is 1x", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 900000000n,
            lockedBalanceCNS: 100000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 971000n,
              depositCNS: 100000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
          perpInfo: makePerpInfo(),
        },
      },
      makeOrderDesc({ leverageHdths: leverageToHdths(1) }), // 1x leverage
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    // liq price for 1x long = entry * (1 - 1/1) = 0, which is <= 0, so skipped
    expect(output).not.toContain("Price Scale");
  });

  it("should render price scale with correct distance percentage for 5x long", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    // 5x leverage: liq = entry * (1 - 1/5) = entry * 0.8
    // entry = 100,000.0 → liq = 80,000.0 → distance = 20,000 = 20.0%
    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 1000000000n,
            lockedBalanceCNS: 0n,
            position: null,
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 800000000n,
            lockedBalanceCNS: 200000000n,
            position: {
              positionType: 0,
              lotLNS: 100000n,
              pricePNS: 1000000n, // entry = 100,000.0
              depositCNS: 200000000n,
              pnlCNS: 0n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
          perpInfo: makePerpInfo({ markPNS: 1005000n }), // mark = 100,500.0
        },
      },
      makeOrderDesc({ leverageHdths: leverageToHdths(5) }),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("Price Scale");
    expect(output).toContain("20.0%");
    expect(output).toContain("below entry");
  });

  // ============ Order Type Coloring ============

  it("should display Open Short as order type", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
      },
      makeOrderDesc({ orderType: OrderType.OpenShort }),
      "ETH",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("Open Short");
  });

  it("should display fill-or-kill flag", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
      },
      makeOrderDesc({ fillOrKill: true, immediateOrCancel: false }),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    expect(output).toContain("Fill-or-kill");
  });

  // ============ Position Diff with pre-existing position ============

  it("should show position change from existing to modified position", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
        fork: {
          txHash: "0xabc" as `0x${string}`,
          receipt: {} as any,
          gasUsed: 300000n,
          gasPrice: 0n,
          gasCostWei: 0n,
          preState: {
            balanceCNS: 800000000n,
            lockedBalanceCNS: 200000000n,
            position: {
              positionType: 0, // LONG
              lotLNS: 50000n, // 0.50000 lots
              pricePNS: 950000n, // entry 95,000.0
              depositCNS: 200000000n,
              pnlCNS: 10000000n,
            },
            ethBalance: 1000000000000000000n,
          },
          postState: {
            balanceCNS: 700000000n,
            lockedBalanceCNS: 300000000n,
            position: {
              positionType: 0, // LONG (same side)
              lotLNS: 150000n, // 1.50000 lots (added to position)
              pricePNS: 970000n, // new avg entry 97,000.0
              depositCNS: 300000000n,
              pnlCNS: 5000000n,
            },
            ethBalance: 1000000000000000000n,
          },
          events: [],
        },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    // Before should show existing position
    expect(output).toContain("Before:");
    expect(output).toContain("0.50000 lots");
    expect(output).toContain("95,000");
    // After should show increased position
    expect(output).toContain("After:");
    expect(output).toContain("1.50000 lots");
    expect(output).toContain("97,000");
  });

  // ============ Unicode Separators ============

  it("should use Unicode box-drawing separators", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printDryRunReport(
      {
        simulate: { success: true, perpId: 16n, orderId: 47n, gasEstimate: 0n },
      },
      makeOrderDesc(),
      "BTC",
      1n,
      5n,
    );

    const output = logs.join("\n");
    // Should use Unicode box-drawing characters, not ASCII
    expect(output).toContain("═");
    expect(output).toContain("─");
  });
});

// ============ PerpetualInfo Orderbook Fields ============

describe("PerpetualInfo orderbook fields", () => {
  it("should include all 5 new orderbook fields in the interface", async () => {
    // Verify the type includes the new fields by constructing a valid object
    const perpInfo: PerpetualInfo = {
      name: "BTC",
      symbol: "BTC",
      priceDecimals: 1n,
      lotDecimals: 5n,
      markPNS: 985000n,
      markTimestamp: 0n,
      oraclePNS: 985000n,
      longOpenInterestLNS: 500000n,
      shortOpenInterestLNS: 300000n,
      fundingStartBlock: 0n,
      fundingRatePct100k: 0,
      synthPerpPricePNS: 0n,
      paused: false,
      basePricePNS: 900000n,
      maxBidPriceONS: 70500n,
      minBidPriceONS: 60000n,
      maxAskPriceONS: 72000n,
      minAskPriceONS: 85000n,
      numOrders: 12n,
    };

    expect(perpInfo.maxBidPriceONS).toBe(70500n);
    expect(perpInfo.minBidPriceONS).toBe(60000n);
    expect(perpInfo.maxAskPriceONS).toBe(72000n);
    expect(perpInfo.minAskPriceONS).toBe(85000n);
    expect(perpInfo.numOrders).toBe(12n);
  });
});

// ============ ForkResult perpInfo Field ============

describe("ForkResult perpInfo field", () => {
  it("should accept perpInfo as optional field on ForkResult", async () => {
    // Verify the simulation module exports work (type validated at compile time)
    const mod = await import("../../src/sdk/simulation/dry-run.js");
    expect(mod).toBeDefined();
    expect(typeof mod.simulateTrade).toBe("function");
  });

  it("should include perpInfo in ForkResult when provided", async () => {
    // Construct a ForkResult-shaped object with perpInfo
    const forkResult = {
      txHash: "0xabc" as `0x${string}`,
      receipt: {} as any,
      gasUsed: 300000n,
      gasPrice: 0n,
      gasCostWei: 0n,
      preState: {
        balanceCNS: 1000000000n,
        lockedBalanceCNS: 0n,
        position: null,
        ethBalance: 1000000000000000000n,
      },
      postState: {
        balanceCNS: 900000000n,
        lockedBalanceCNS: 100000000n,
        position: null,
        ethBalance: 1000000000000000000n,
      },
      events: [],
      perpInfo: {
        name: "BTC",
        symbol: "BTC",
        priceDecimals: 1n,
        lotDecimals: 5n,
        markPNS: 985000n,
        markTimestamp: 0n,
        oraclePNS: 985000n,
        longOpenInterestLNS: 500000n,
        shortOpenInterestLNS: 300000n,
        fundingStartBlock: 0n,
        fundingRatePct100k: 0,
        synthPerpPricePNS: 0n,
        paused: false,
        basePricePNS: 900000n,
        maxBidPriceONS: 70500n,
        minBidPriceONS: 60000n,
        maxAskPriceONS: 72000n,
        minAskPriceONS: 85000n,
        numOrders: 12n,
      },
    };

    expect(forkResult.perpInfo).toBeDefined();
    expect(forkResult.perpInfo!.numOrders).toBe(12n);
  });
});

// ============ CLI Flag Registration ============

describe("Trade CLI --dry-run flag", () => {
  it("should have --dry-run option on open command", async () => {
    const { Command } = await import("commander");

    // Re-import with mocked SDK
    vi.doMock("../../src/sdk/index.js", async (importOriginal) => {
      const actual = await importOriginal() as any;
      return {
        ...actual,
        loadEnvConfig: vi.fn(),
        validateOwnerConfig: vi.fn(),
        OwnerWallet: { fromPrivateKey: vi.fn() },
        Exchange: vi.fn(),
        HybridClient: vi.fn(),
        simulateTrade: vi.fn(),
        printDryRunReport: vi.fn(),
      };
    });

    const { registerTradeCommand } = await import("../../src/cli/trade.js");

    const program = new Command();
    registerTradeCommand(program);

    const openCmd = program.commands
      .find((c) => c.name() === "trade")
      ?.commands.find((c) => c.name() === "open");

    const dryRunOption = openCmd?.options.find((o) => o.long === "--dry-run");
    expect(dryRunOption).toBeDefined();
    expect(dryRunOption?.description).toContain("Simulate");
  });

  it("should have --dry-run option on close command", async () => {
    const { Command } = await import("commander");

    vi.doMock("../../src/sdk/index.js", async (importOriginal) => {
      const actual = await importOriginal() as any;
      return {
        ...actual,
        loadEnvConfig: vi.fn(),
        validateOwnerConfig: vi.fn(),
        OwnerWallet: { fromPrivateKey: vi.fn() },
        Exchange: vi.fn(),
        HybridClient: vi.fn(),
        simulateTrade: vi.fn(),
        printDryRunReport: vi.fn(),
      };
    });

    const { registerTradeCommand } = await import("../../src/cli/trade.js");

    const program = new Command();
    registerTradeCommand(program);

    const closeCmd = program.commands
      .find((c) => c.name() === "trade")
      ?.commands.find((c) => c.name() === "close");

    const dryRunOption = closeCmd?.options.find((o) => o.long === "--dry-run");
    expect(dryRunOption).toBeDefined();
  });
});

// ============ Anvil Module ============

describe("Anvil utilities", () => {
  it("should export isAnvilInstalled function", async () => {
    const { isAnvilInstalled } = await import("../../src/sdk/simulation/anvil.js");
    expect(typeof isAnvilInstalled).toBe("function");
  });

  it("should export startAnvilFork function", async () => {
    const { startAnvilFork } = await import("../../src/sdk/simulation/anvil.js");
    expect(typeof startAnvilFork).toBe("function");
  });

  it("should export stopAnvil function", async () => {
    const { stopAnvil } = await import("../../src/sdk/simulation/anvil.js");
    expect(typeof stopAnvil).toBe("function");
  });
});

// ============ Type Exports ============

describe("Simulation type exports", () => {
  it("should export simulateTrade from SDK", async () => {
    const sdk = await import("../../src/sdk/index.js");
    expect(typeof sdk.simulateTrade).toBe("function");
  });

  it("should export printDryRunReport from SDK", async () => {
    const sdk = await import("../../src/sdk/index.js");
    expect(typeof sdk.printDryRunReport).toBe("function");
  });

  it("should export isAnvilInstalled from SDK", async () => {
    const sdk = await import("../../src/sdk/index.js");
    expect(typeof sdk.isAnvilInstalled).toBe("function");
  });
});
