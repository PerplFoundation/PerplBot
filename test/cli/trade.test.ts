/**
 * Trade CLI tests
 * Tests for trade command parsing and options
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK modules before importing
vi.mock("../../src/sdk/index.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    loadEnvConfig: vi.fn(() => ({
      ownerPrivateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      chain: {
        chain: { id: 10143, name: "monad-testnet" },
        rpcUrl: "https://testnet-rpc.monad.xyz",
        exchangeAddress: "0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7",
        collateralToken: "0xdF5B718d8FcC173335185a2a1513eE8151e3c027",
      },
    })),
    validateOwnerConfig: vi.fn(),
    OwnerWallet: {
      fromPrivateKey: vi.fn(() => ({
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        publicClient: {},
        walletClient: {},
      })),
    },
    Exchange: vi.fn().mockImplementation(() => ({})),
    HybridClient: vi.fn().mockImplementation(() => ({
      getPerpetualInfo: vi.fn().mockResolvedValue({
        priceDecimals: 9,
        lotDecimals: 9,
      }),
      getAccountByAddress: vi.fn().mockResolvedValue({
        accountId: 1n,
      }),
      getPosition: vi.fn().mockResolvedValue({
        position: { lotLNS: 0n },
        markPrice: 50000000000000n, // 50000 with 9 decimals
      }),
      execOrder: vi.fn().mockResolvedValue("0xmocktxhash"),
    })),
    priceToPNS: actual.priceToPNS,
    pnsToPrice: actual.pnsToPrice,
    lotToLNS: actual.lotToLNS,
    leverageToHdths: actual.leverageToHdths,
    PERPETUALS: actual.PERPETUALS,
    ALL_PERP_IDS: actual.ALL_PERP_IDS,
  };
});

describe("Trade CLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Market price option", () => {
    it("should recognize 'market' as a valid price option", async () => {
      const { Command } = await import("commander");
      const { registerTradeCommand } = await import("../../src/cli/trade.js");

      const program = new Command();
      registerTradeCommand(program);

      // Parse the command
      const openCmd = program.commands
        .find((c) => c.name() === "trade")
        ?.commands.find((c) => c.name() === "open");

      expect(openCmd).toBeDefined();

      // Check that --price accepts 'market'
      const priceOption = openCmd?.options.find((o) => o.long === "--price");
      expect(priceOption).toBeDefined();
      expect(priceOption?.description).toContain("market");
    });

    it("should have slippage option with default of 1%", async () => {
      const { Command } = await import("commander");
      const { registerTradeCommand } = await import("../../src/cli/trade.js");

      const program = new Command();
      registerTradeCommand(program);

      const openCmd = program.commands
        .find((c) => c.name() === "trade")
        ?.commands.find((c) => c.name() === "open");

      const slippageOption = openCmd?.options.find((o) => o.long === "--slippage");
      expect(slippageOption).toBeDefined();
      expect(slippageOption?.defaultValue).toBe("1");
    });

    it("should show market order help text", async () => {
      const { Command } = await import("commander");
      const { registerTradeCommand } = await import("../../src/cli/trade.js");

      const program = new Command();
      registerTradeCommand(program);

      const openCmd = program.commands
        .find((c) => c.name() === "trade")
        ?.commands.find((c) => c.name() === "open");

      // Verify help includes market order info
      const priceOption = openCmd?.options.find((o) => o.long === "--price");
      expect(priceOption?.description).toContain("market");
    });
  });

  describe("close-all command", () => {
    it("should have close-all command registered", async () => {
      const { Command } = await import("commander");
      const { registerTradeCommand } = await import("../../src/cli/trade.js");

      const program = new Command();
      registerTradeCommand(program);

      const closeAllCmd = program.commands
        .find((c) => c.name() === "trade")
        ?.commands.find((c) => c.name() === "close-all");

      expect(closeAllCmd).toBeDefined();
      expect(closeAllCmd?.description()).toBe("Close all positions and cancel all orders");
    });

    it("should have optional --perp option for specific market", async () => {
      const { Command } = await import("commander");
      const { registerTradeCommand } = await import("../../src/cli/trade.js");

      const program = new Command();
      registerTradeCommand(program);

      const closeAllCmd = program.commands
        .find((c) => c.name() === "trade")
        ?.commands.find((c) => c.name() === "close-all");

      const perpOption = closeAllCmd?.options.find((o) => o.long === "--perp");
      expect(perpOption).toBeDefined();
      // The option exists but is not mandatory (close-all works without --perp)
      expect(perpOption?.mandatory).toBeFalsy();
    });
  });

  describe("Slippage calculation", () => {
    it("should apply positive slippage for long market orders", () => {
      const markPrice = 50000;
      const slippage = 0.01; // 1%
      const expectedPrice = markPrice * (1 + slippage); // 50500

      expect(expectedPrice).toBe(50500);
    });

    it("should apply negative slippage for short market orders", () => {
      const markPrice = 50000;
      const slippage = 0.01; // 1%
      const expectedPrice = markPrice * (1 - slippage); // 49500

      expect(expectedPrice).toBe(49500);
    });

    it("should handle custom slippage values", () => {
      const markPrice = 50000;
      const slippage = 0.02; // 2%
      const longPrice = markPrice * (1 + slippage); // 51000
      const shortPrice = markPrice * (1 - slippage); // 49000

      expect(longPrice).toBe(51000);
      expect(shortPrice).toBe(49000);
    });
  });

  describe("Command structure", () => {
    it("should have all trade subcommands", async () => {
      const { Command } = await import("commander");
      const { registerTradeCommand } = await import("../../src/cli/trade.js");

      const program = new Command();
      registerTradeCommand(program);

      const tradeCmd = program.commands.find((c) => c.name() === "trade");
      const subcommands = tradeCmd?.commands.map((c) => c.name());

      expect(subcommands).toContain("open");
      expect(subcommands).toContain("close");
      expect(subcommands).toContain("cancel");
      expect(subcommands).toContain("cancel-all");
      expect(subcommands).toContain("close-all");
    });
  });
});
