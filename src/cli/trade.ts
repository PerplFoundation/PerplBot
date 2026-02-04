/**
 * Trade command - Direct trading from owner wallet on Exchange
 */

import type { Command } from "commander";
import {
  loadEnvConfig,
  validateOwnerConfig,
  OwnerWallet,
  Exchange,
  HybridClient,
  PERPETUALS,
  priceToPNS,
  lotToLNS,
  leverageToHdths,
} from "../sdk/index.js";
import { OrderType, type OrderDesc } from "../sdk/contracts/Exchange.js";

// Market name to ID mapping
const PERP_NAMES: Record<string, bigint> = {
  btc: PERPETUALS.BTC,
  eth: PERPETUALS.ETH,
  sol: PERPETUALS.SOL,
  mon: PERPETUALS.MON,
  zec: PERPETUALS.ZEC,
};

function resolvePerpId(perp: string): bigint {
  const lower = perp.toLowerCase();
  if (PERP_NAMES[lower] !== undefined) {
    return PERP_NAMES[lower];
  }
  const parsed = parseInt(perp, 10);
  if (!isNaN(parsed)) {
    return BigInt(parsed);
  }
  throw new Error(`Unknown perpetual: ${perp}`);
}

export function registerTradeCommand(program: Command): void {
  const trade = program
    .command("trade")
    .description("Execute trades directly from owner wallet");

  // Open position
  trade
    .command("open")
    .description("Open a new position")
    .requiredOption("--perp <name>", "Perpetual to trade (btc, eth, sol, mon, zec)")
    .requiredOption("--side <side>", "Position side (long or short)")
    .requiredOption("--size <amount>", "Position size")
    .requiredOption("--price <price>", "Limit price")
    .option("--leverage <multiplier>", "Leverage multiplier", "1")
    .option("--ioc", "Immediate-or-cancel order (market order)")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        owner.publicClient,
        owner.walletClient
      );
      const client = new HybridClient({ exchange });

      const perpId = resolvePerpId(options.perp);
      const side = options.side.toLowerCase();
      const size = parseFloat(options.size);
      const price = parseFloat(options.price);
      const leverage = parseFloat(options.leverage);

      // Get perpetual info for decimals
      const perpInfo = await client.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      console.log(`Opening ${side} position...`);
      console.log(`  Perpetual ID: ${perpId}`);
      console.log(`  Size: ${size}`);
      console.log(`  Price: ${price}`);
      console.log(`  Leverage: ${leverage}x`);

      const orderType = side === "long" ? OrderType.OpenLong : OrderType.OpenShort;

      const orderDesc: OrderDesc = {
        orderDescId: 0n,
        perpId,
        orderType,
        orderId: 0n,
        pricePNS: priceToPNS(price, priceDecimals),
        lotLNS: lotToLNS(size, lotDecimals),
        expiryBlock: 0n,
        postOnly: false,
        fillOrKill: false,
        immediateOrCancel: options.ioc ?? false,
        maxMatches: 0n,
        leverageHdths: leverageToHdths(leverage),
        lastExecutionBlock: 0n,
        amountCNS: 0n,
      };

      try {
        const txHash = await client.execOrder(orderDesc);
        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Trade failed:", error);
        process.exit(1);
      }
    });

  // Close position
  trade
    .command("close")
    .description("Close an existing position")
    .requiredOption("--perp <name>", "Perpetual to trade (btc, eth, sol, mon, zec)")
    .requiredOption("--side <side>", "Position side to close (long or short)")
    .requiredOption("--size <amount>", "Size to close")
    .requiredOption("--price <price>", "Limit price")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        owner.publicClient,
        owner.walletClient
      );
      const client = new HybridClient({ exchange });

      const perpId = resolvePerpId(options.perp);
      const side = options.side.toLowerCase();
      const size = parseFloat(options.size);
      const price = parseFloat(options.price);

      // Get perpetual info for decimals
      const perpInfo = await client.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      console.log(`Closing ${side} position...`);
      console.log(`  Perpetual ID: ${perpId}`);
      console.log(`  Size: ${size}`);
      console.log(`  Price: ${price}`);

      const orderType = side === "long" ? OrderType.CloseLong : OrderType.CloseShort;

      const orderDesc: OrderDesc = {
        orderDescId: 0n,
        perpId,
        orderType,
        orderId: 0n,
        pricePNS: priceToPNS(price, priceDecimals),
        lotLNS: lotToLNS(size, lotDecimals),
        expiryBlock: 0n,
        postOnly: false,
        fillOrKill: false,
        immediateOrCancel: false,
        maxMatches: 0n,
        leverageHdths: 100n,
        lastExecutionBlock: 0n,
        amountCNS: 0n,
      };

      try {
        const txHash = await client.execOrder(orderDesc);
        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Close failed:", error);
        process.exit(1);
      }
    });

  // Cancel order
  trade
    .command("cancel")
    .description("Cancel an existing order")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
    .requiredOption("--order-id <id>", "Order ID to cancel")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        owner.publicClient,
        owner.walletClient
      );
      const client = new HybridClient({ exchange });

      const perpId = resolvePerpId(options.perp);
      const orderId = BigInt(options.orderId);

      console.log(`Cancelling order ${orderId} on perp ${perpId}...`);

      const orderDesc: OrderDesc = {
        orderDescId: 0n,
        perpId,
        orderType: OrderType.Cancel,
        orderId,
        pricePNS: 0n,
        lotLNS: 0n,
        expiryBlock: 0n,
        postOnly: false,
        fillOrKill: false,
        immediateOrCancel: false,
        maxMatches: 0n,
        leverageHdths: 0n,
        lastExecutionBlock: 0n,
        amountCNS: 0n,
      };

      try {
        const txHash = await client.execOrder(orderDesc);
        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Cancel failed:", error);
        process.exit(1);
      }
    });

  // Cancel all orders
  trade
    .command("cancel-all")
    .description("Cancel all open orders on a market")
    .requiredOption("--perp <name>", "Perpetual (btc, eth, sol, mon, zec)")
    .action(async (options) => {
      const config = loadEnvConfig();
      validateOwnerConfig(config);

      const owner = OwnerWallet.fromPrivateKey(
        config.ownerPrivateKey,
        config.chain
      );

      const exchange = new Exchange(
        config.chain.exchangeAddress,
        owner.publicClient,
        owner.walletClient
      );
      const client = new HybridClient({ exchange });

      const accountInfo = await client.getAccountByAddress(owner.address);
      const accountId = accountInfo.accountId;

      const perpId = resolvePerpId(options.perp);

      console.log(`Fetching open orders for perp ${perpId}...`);
      console.log(`Account ID: ${accountId}`);

      const orders = await client.getOpenOrders(perpId, accountId);

      if (orders.length === 0) {
        console.log("No open orders found.");
        return;
      }

      console.log(`Found ${orders.length} order(s) to cancel: ${orders.map(o => o.orderId).join(", ")}`);

      let cancelled = 0;
      for (const order of orders) {
        const orderDesc: OrderDesc = {
          orderDescId: 0n,
          perpId,
          orderType: OrderType.Cancel,
          orderId: order.orderId,
          pricePNS: 0n,
          lotLNS: 0n,
          expiryBlock: 0n,
          postOnly: false,
          fillOrKill: false,
          immediateOrCancel: false,
          maxMatches: 0n,
          leverageHdths: 0n,
          lastExecutionBlock: 0n,
          amountCNS: 0n,
        };

        try {
          console.log(`Cancelling order ${order.orderId}...`);
          const txHash = await client.execOrder(orderDesc);
          console.log(`  Tx: ${txHash}`);
          cancelled++;
        } catch (e: any) {
          console.log(`  Failed: ${e.shortMessage || e.message}`);
        }
      }

      console.log(`\nCancelled ${cancelled}/${orders.length} orders.`);
    });
}
