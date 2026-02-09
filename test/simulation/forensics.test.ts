/**
 * Transaction forensics tests
 * Unit tests for calldata decoding, revert mapping, match extraction, and report rendering
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { encodeFunctionData } from "viem";
import { ExchangeAbi } from "../../src/sdk/contracts/abi.js";
import { OrderType, type PerpetualInfo } from "../../src/sdk/contracts/Exchange.js";
import { priceToPNS, lotToLNS, leverageToHdths } from "../../src/sdk/trading/orders.js";
import type { AccountSnapshot, DecodedEvent } from "../../src/sdk/simulation/dry-run.js";

// Disable chalk colors for deterministic test output
beforeAll(() => {
  process.env.NO_COLOR = "1";
});

// ============ Calldata Decoding ============

describe("Calldata decoding", () => {
  let decodeExchangeCalldata: typeof import("../../src/sdk/simulation/forensics.js").decodeExchangeCalldata;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const mod = await import("../../src/sdk/simulation/forensics.js");
    decodeExchangeCalldata = mod.decodeExchangeCalldata;
  });

  it("should decode execOrder calldata and extract OrderDesc", () => {
    const orderDesc = {
      orderDescId: 0n,
      perpId: 16n,
      orderType: OrderType.OpenLong,
      orderId: 0n,
      pricePNS: priceToPNS(50000, 1n),
      lotLNS: lotToLNS(0.1, 5n),
      expiryBlock: 0n,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: true,
      maxMatches: 0n,
      leverageHdths: leverageToHdths(10),
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "execOrder",
      args: [orderDesc],
    });

    const result = decodeExchangeCalldata(data);
    expect(result).not.toBeNull();
    expect(result!.functionName).toBe("execOrder");
    expect(result!.orderDesc).toBeDefined();
    expect(result!.orderDesc!.perpId).toBe(16n);
    expect(result!.orderDesc!.immediateOrCancel).toBe(true);
  });

  it("should decode depositCollateral calldata without orderDesc", () => {
    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "depositCollateral",
      args: [1000000n],
    });

    const result = decodeExchangeCalldata(data);
    expect(result).not.toBeNull();
    expect(result!.functionName).toBe("depositCollateral");
    expect(result!.orderDesc).toBeUndefined();
    expect(result!.orderDescs).toBeUndefined();
  });

  it("should decode execOrders calldata and extract orderDescs array", () => {
    const orderDescs = [
      {
        orderDescId: 0n,
        perpId: 16n,
        orderType: OrderType.OpenLong,
        orderId: 0n,
        pricePNS: 500000n,
        lotLNS: 10000n,
        expiryBlock: 0n,
        postOnly: false,
        fillOrKill: false,
        immediateOrCancel: true,
        maxMatches: 0n,
        leverageHdths: 1000n,
        lastExecutionBlock: 0n,
        amountCNS: 0n,
      },
      {
        orderDescId: 0n,
        perpId: 32n,
        orderType: OrderType.OpenShort,
        orderId: 0n,
        pricePNS: 30000n,
        lotLNS: 50000n,
        expiryBlock: 0n,
        postOnly: false,
        fillOrKill: false,
        immediateOrCancel: false,
        maxMatches: 0n,
        leverageHdths: 500n,
        lastExecutionBlock: 0n,
        amountCNS: 0n,
      },
    ];

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "execOrders",
      args: [orderDescs, true],
    });

    const result = decodeExchangeCalldata(data);
    expect(result).not.toBeNull();
    expect(result!.functionName).toBe("execOrders");
    expect(result!.orderDescs).toBeDefined();
    expect(result!.orderDescs!.length).toBe(2);
    expect(result!.orderDescs![0].perpId).toBe(16n);
    expect(result!.orderDescs![1].perpId).toBe(32n);
  });

  it("should return null for unknown function selector", () => {
    // Random 4 bytes that don't match any known function
    const data = "0xdeadbeef" as `0x${string}`;
    const result = decodeExchangeCalldata(data);
    expect(result).toBeNull();
  });
});

// ============ Revert Reason Mapping ============

describe("Revert reason mapping", () => {
  let mapRevertReason: typeof import("../../src/sdk/simulation/forensics.js").mapRevertReason;

  beforeEach(async () => {
    const mod = await import("../../src/sdk/simulation/forensics.js");
    mapRevertReason = mod.mapRevertReason;
  });

  it("should map InsufficientBalance to correct explanation", () => {
    const result = mapRevertReason("InsufficientBalance");
    expect(result.explanation).toContain("Not enough collateral");
    expect(result.isMatchingFailure).toBe(false);
    expect(result.suggestion).toBeDefined();
  });

  it("should map PostOnlyFailed to matching failure", () => {
    const result = mapRevertReason("PostOnlyFailed");
    expect(result.explanation).toContain("Post-only");
    expect(result.isMatchingFailure).toBe(true);
  });

  it("should map FillOrKillFailed to matching failure", () => {
    const result = mapRevertReason("FillOrKillFailed");
    expect(result.explanation).toContain("completely filled");
    expect(result.isMatchingFailure).toBe(true);
  });

  it("should return sensible fallback for unknown reason", () => {
    const result = mapRevertReason("SomeWeirdError");
    expect(result.explanation).toContain("SomeWeirdError");
    expect(result.rawReason).toBe("SomeWeirdError");
    expect(result.isMatchingFailure).toBe(false);
  });

  it("should handle case-insensitive matching", () => {
    const result = mapRevertReason("insufficientbalance");
    expect(result.explanation).toContain("Not enough collateral");
  });
});

// ============ Match Extraction ============

describe("Match extraction", () => {
  let extractMatches: typeof import("../../src/sdk/simulation/forensics.js").extractMatches;
  let computeAvgFillPrice: typeof import("../../src/sdk/simulation/forensics.js").computeAvgFillPrice;

  beforeEach(async () => {
    const mod = await import("../../src/sdk/simulation/forensics.js");
    extractMatches = mod.extractMatches;
    computeAvgFillPrice = mod.computeAvgFillPrice;
  });

  it("should extract matches from MakerOrderFilled events", () => {
    const events: DecodedEvent[] = [
      {
        eventName: "OrderRequest",
        args: { perpId: 16n, accountId: 1n },
      },
      {
        eventName: "MakerOrderFilled",
        args: {
          perpId: 16n,
          accountId: 5n,
          orderId: 42n,
          pricePNS: 985000n,
          lotLNS: 50000n,
          feeCNS: 500000n,
          lockedBalanceCNS: 0n,
          amountCNS: 0n,
          balanceCNS: 0n,
        },
      },
      {
        eventName: "MakerOrderFilled",
        args: {
          perpId: 16n,
          accountId: 7n,
          orderId: 99n,
          pricePNS: 986000n,
          lotLNS: 30000n,
          feeCNS: 300000n,
          lockedBalanceCNS: 0n,
          amountCNS: 0n,
          balanceCNS: 0n,
        },
      },
    ];

    const matches = extractMatches(events);
    expect(matches.length).toBe(2);
    expect(matches[0].makerAccountId).toBe(5n);
    expect(matches[0].makerOrderId).toBe(42n);
    expect(matches[0].pricePNS).toBe(985000n);
    expect(matches[0].lotLNS).toBe(50000n);
    expect(matches[0].feeCNS).toBe(500000n);
    expect(matches[1].makerAccountId).toBe(7n);
  });

  it("should return empty array when no MakerOrderFilled events", () => {
    const events: DecodedEvent[] = [
      { eventName: "OrderRequest", args: { perpId: 16n } },
      { eventName: "OrderPlaced", args: { orderId: 1n } },
    ];

    const matches = extractMatches(events);
    expect(matches).toEqual([]);
  });

  it("should compute volume-weighted average fill price", () => {
    const matches = [
      { makerAccountId: 1n, makerOrderId: 1n, pricePNS: 1000000n, lotLNS: 60000n, feeCNS: 0n },
      { makerAccountId: 2n, makerOrderId: 2n, pricePNS: 1010000n, lotLNS: 40000n, feeCNS: 0n },
    ];

    // Weighted avg: (1000000*60000 + 1010000*40000) / (60000+40000)
    // = (60000000000 + 40400000000) / 100000 = 1004000 PNS
    // With priceDecimals=1: 1004000 / 10 = 100400.0
    const avgPrice = computeAvgFillPrice(matches, 1n);
    expect(avgPrice).toBe(100400);
  });

  it("should return null for empty matches", () => {
    const avgPrice = computeAvgFillPrice([], 1n);
    expect(avgPrice).toBeNull();
  });
});

// ============ Report Rendering ============

describe("Forensics report rendering", () => {
  let printForensicsReport: typeof import("../../src/sdk/simulation/forensics-report.js").printForensicsReport;
  let forensicsResultToJson: typeof import("../../src/sdk/simulation/forensics-report.js").forensicsResultToJson;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const mod = await import("../../src/sdk/simulation/forensics-report.js");
    printForensicsReport = mod.printForensicsReport;
    forensicsResultToJson = mod.forensicsResultToJson;
  });

  const makeState = (overrides?: Partial<AccountSnapshot>): AccountSnapshot => ({
    balanceCNS: 1000000000n,
    lockedBalanceCNS: 0n,
    position: null,
    ethBalance: 1000000000000000000n,
    ...overrides,
  });

  const makePerpInfo = (): PerpetualInfo => ({
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
  });

  it("should render successful trade report", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printForensicsReport({
      txHash: "0xabc123def456789012345678901234567890123456789012345678901234abcd" as `0x${string}`,
      blockNumber: 12345n,
      from: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      to: "0x2222222222222222222222222222222222222222" as `0x${string}`,
      isDelegated: false,
      accountAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      decodedInput: {
        functionName: "execOrder",
        args: {},
        orderDesc: {
          orderDescId: 0n,
          perpId: 16n,
          orderType: OrderType.OpenLong,
          orderId: 0n,
          pricePNS: 985000n,
          lotLNS: 10000n,
          expiryBlock: 0n,
          postOnly: false,
          fillOrKill: false,
          immediateOrCancel: true,
          maxMatches: 0n,
          leverageHdths: 1000n,
          lastExecutionBlock: 0n,
          amountCNS: 0n,
        },
      },
      originalSuccess: true,
      originalEvents: [
        { eventName: "OrderRequest", args: { perpId: 16n } },
        { eventName: "MakerOrderFilled", args: { perpId: 16n, accountId: 5n, orderId: 42n, pricePNS: 985000n, lotLNS: 10000n, feeCNS: 50000n, lockedBalanceCNS: 0n, amountCNS: 0n, balanceCNS: 0n } },
      ],
      originalGasUsed: 350000n,
      replaySuccess: true,
      replayEvents: [
        { eventName: "OrderRequest", args: { perpId: 16n } },
        { eventName: "MakerOrderFilled", args: { perpId: 16n, accountId: 5n, orderId: 42n, pricePNS: 985000n, lotLNS: 10000n, feeCNS: 50000n, lockedBalanceCNS: 0n, amountCNS: 0n, balanceCNS: 0n } },
      ],
      preState: makeState(),
      postState: makeState({
        balanceCNS: 900000000n,
        lockedBalanceCNS: 100000000n,
        position: {
          positionType: 0,
          lotLNS: 10000n,
          pricePNS: 985000n,
          depositCNS: 100000000n,
          pnlCNS: 0n,
        },
      }),
      perpId: 16n,
      perpName: "BTC",
      perpInfo: makePerpInfo(),
      matches: [
        { makerAccountId: 5n, makerOrderId: 42n, pricePNS: 985000n, lotLNS: 10000n, feeCNS: 50000n },
      ],
      fillPrice: 98500,
      totalFilledLots: 0.1,
      failure: null,
    });

    const output = logs.join("\n");
    expect(output).toContain("TRANSACTION FORENSICS");
    expect(output).toContain("12345"); // block
    expect(output).toContain("SUCCESS");
    expect(output).toContain("Open Long");
    expect(output).toContain("BTC");
    expect(output).toContain("Match Details");
    expect(output).toContain("98,500");
    expect(output).toContain("Summary");
  });

  it("should render failed trade report with failure analysis", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printForensicsReport({
      txHash: "0xabc123def456789012345678901234567890123456789012345678901234abcd" as `0x${string}`,
      blockNumber: 12345n,
      from: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      to: "0x2222222222222222222222222222222222222222" as `0x${string}`,
      isDelegated: false,
      accountAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      decodedInput: {
        functionName: "execOrder",
        args: {},
        orderDesc: {
          orderDescId: 0n,
          perpId: 16n,
          orderType: OrderType.OpenLong,
          orderId: 0n,
          pricePNS: 985000n,
          lotLNS: 10000n,
          expiryBlock: 0n,
          postOnly: false,
          fillOrKill: false,
          immediateOrCancel: true,
          maxMatches: 0n,
          leverageHdths: 1000n,
          lastExecutionBlock: 0n,
          amountCNS: 0n,
        },
      },
      originalSuccess: false,
      originalEvents: [],
      originalGasUsed: 100000n,
      replaySuccess: false,
      replayEvents: [],
      preState: makeState(),
      postState: makeState(),
      perpId: 16n,
      perpName: "BTC",
      perpInfo: makePerpInfo(),
      matches: [],
      fillPrice: null,
      totalFilledLots: null,
      failure: {
        rawReason: "InsufficientBalance",
        explanation: "Not enough collateral for this trade",
        suggestion: "Deposit more collateral before trading",
        isMatchingFailure: false,
      },
    });

    const output = logs.join("\n");
    expect(output).toContain("REVERTED");
    expect(output).toContain("Failure Analysis");
    expect(output).toContain("InsufficientBalance");
    expect(output).toContain("Not enough collateral");
    expect(output).toContain("Deposit more collateral");
  });

  it("should skip order/match sections for non-order transactions", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printForensicsReport({
      txHash: "0xabc123def456789012345678901234567890123456789012345678901234abcd" as `0x${string}`,
      blockNumber: 12345n,
      from: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      to: "0x2222222222222222222222222222222222222222" as `0x${string}`,
      isDelegated: false,
      accountAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      decodedInput: {
        functionName: "depositCollateral",
        args: { amountCNS: 1000000n },
      },
      originalSuccess: true,
      originalEvents: [],
      originalGasUsed: 50000n,
      replaySuccess: true,
      replayEvents: [],
      preState: makeState({ balanceCNS: 0n }),
      postState: makeState({ balanceCNS: 1000000n }),
      perpId: null,
      perpName: null,
      perpInfo: null,
      matches: [],
      fillPrice: null,
      totalFilledLots: null,
      failure: null,
    });

    const output = logs.join("\n");
    expect(output).toContain("TRANSACTION FORENSICS");
    expect(output).toContain("depositCollateral");
    expect(output).not.toContain("Match Details");
    expect(output).not.toContain("Position Changes");
  });

  it("should handle null/missing fields gracefully", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    // Minimal result with many nulls
    printForensicsReport({
      txHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      blockNumber: 0n,
      from: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      isDelegated: false,
      accountAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      decodedInput: null,
      originalSuccess: true,
      originalEvents: [],
      originalGasUsed: 0n,
      replaySuccess: true,
      replayEvents: [],
      preState: makeState(),
      postState: makeState(),
      perpId: null,
      perpName: null,
      perpInfo: null,
      matches: [],
      fillPrice: null,
      totalFilledLots: null,
      failure: null,
    });

    const output = logs.join("\n");
    expect(output).toContain("TRANSACTION FORENSICS");
    expect(output).toContain("Unable to decode");
  });

  it("should show DelegatedAccount in header when isDelegated", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    printForensicsReport({
      txHash: "0xabc123def456789012345678901234567890123456789012345678901234abcd" as `0x${string}`,
      blockNumber: 100n,
      from: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      to: "0x2222222222222222222222222222222222222222" as `0x${string}`,
      isDelegated: true,
      accountAddress: "0x2222222222222222222222222222222222222222" as `0x${string}`,
      decodedInput: null,
      originalSuccess: true,
      originalEvents: [],
      originalGasUsed: 0n,
      replaySuccess: true,
      replayEvents: [],
      preState: makeState(),
      postState: makeState(),
      perpId: null,
      perpName: null,
      perpInfo: null,
      matches: [],
      fillPrice: null,
      totalFilledLots: null,
      failure: null,
    });

    const output = logs.join("\n");
    expect(output).toContain("DelegatedAccount");
  });
});

// ============ JSON Serialization ============

describe("Forensics result JSON serialization", () => {
  let forensicsResultToJson: typeof import("../../src/sdk/simulation/forensics-report.js").forensicsResultToJson;

  beforeEach(async () => {
    const mod = await import("../../src/sdk/simulation/forensics-report.js");
    forensicsResultToJson = mod.forensicsResultToJson;
  });

  it("should convert BigInts to strings", () => {
    const result = forensicsResultToJson({
      txHash: "0xabc" as `0x${string}`,
      blockNumber: 12345n,
      from: "0x111" as `0x${string}`,
      to: "0x222" as `0x${string}`,
      isDelegated: false,
      accountAddress: "0x111" as `0x${string}`,
      decodedInput: null,
      originalSuccess: true,
      originalEvents: [],
      originalGasUsed: 350000n,
      replaySuccess: true,
      replayEvents: [],
      preState: { balanceCNS: 1000n, lockedBalanceCNS: 0n, position: null, ethBalance: 1000000000000000000n },
      postState: { balanceCNS: 900n, lockedBalanceCNS: 100n, position: null, ethBalance: 1000000000000000000n },
      perpId: 16n,
      perpName: "BTC",
      perpInfo: null,
      matches: [],
      fillPrice: null,
      totalFilledLots: null,
      failure: null,
    });

    expect(result.blockNumber).toBe("12345");
    expect(result.originalGasUsed).toBe("350000");
    expect(result.perpId).toBe("16");
    expect((result.preState as any).balanceCNS).toBe("1000");

    // Should be valid JSON (no BigInt serialization errors)
    const json = JSON.stringify(result);
    expect(json).toBeTruthy();
  });
});

// ============ CLI Command Registration ============

describe("Debug CLI command registration", () => {
  it("should register debug command on program", async () => {
    const { Command } = await import("commander");
    const { registerDebugCommand } = await import("../../src/cli/debug.js");

    const program = new Command();
    registerDebugCommand(program);

    const debugCmd = program.commands.find((c) => c.name() === "debug");
    expect(debugCmd).toBeDefined();
    expect(debugCmd!.description()).toContain("Analyze");

    // Should have --json option
    const jsonOption = debugCmd!.options.find((o) => o.long === "--json");
    expect(jsonOption).toBeDefined();

    // Should have --rpc option
    const rpcOption = debugCmd!.options.find((o) => o.long === "--rpc");
    expect(rpcOption).toBeDefined();

    // Should have --exchange option
    const exchangeOption = debugCmd!.options.find((o) => o.long === "--exchange");
    expect(exchangeOption).toBeDefined();
  });
});

// ============ Anvil blockNumber Support ============

describe("Anvil blockNumber support", () => {
  it("should accept blockNumber in startAnvilFork opts type", async () => {
    const { startAnvilFork } = await import("../../src/sdk/simulation/anvil.js");
    expect(typeof startAnvilFork).toBe("function");
    // Type check: the function signature accepts blockNumber
    // (actual Anvil execution is not tested here — requires Anvil binary)
  });
});

// ============ Exported Functions ============

describe("Forensics module exports", () => {
  it("should export analyzeTransaction from SDK", async () => {
    const sdk = await import("../../src/sdk/index.js");
    expect(typeof sdk.analyzeTransaction).toBe("function");
  });

  it("should export printForensicsReport from SDK", async () => {
    const sdk = await import("../../src/sdk/index.js");
    expect(typeof sdk.printForensicsReport).toBe("function");
  });

  it("should export forensicsResultToJson from SDK", async () => {
    const sdk = await import("../../src/sdk/index.js");
    expect(typeof sdk.forensicsResultToJson).toBe("function");
  });

  it("should export snapshotAccount from dry-run", async () => {
    const mod = await import("../../src/sdk/simulation/dry-run.js");
    expect(typeof mod.snapshotAccount).toBe("function");
  });

  it("should export decodeLogs from dry-run", async () => {
    const mod = await import("../../src/sdk/simulation/dry-run.js");
    expect(typeof mod.decodeLogs).toBe("function");
  });
});
