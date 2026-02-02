/**
 * Direct trading command - Trade directly from owner wallet without DelegatedAccount
 */

import type { Command } from "commander";
import {
  loadEnvConfig,
  validateOwnerConfig,
  OwnerWallet,
  Exchange,
  PERPETUALS,
  priceToPNS,
  lotToLNS,
  leverageToHdths,
  pnsToPrice,
  lnsToLot,
} from "../sdk/index.js";
import { OrderType, type OrderDesc } from "../sdk/contracts/Exchange.js";
import { ERC20Abi, ExchangeAbi } from "../sdk/contracts/abi.js";
import { encodeFunctionData } from "viem";

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

export function registerDirectCommand(program: Command): void {
  const direct = program
    .command("direct")
    .description("Trade directly from owner wallet (no DelegatedAccount)");

  // Direct status
  direct
    .command("status")
    .description("Show owner wallet's direct exchange account status")
    .action(async () => {
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

      console.log("Fetching direct account status...\n");

      try {
        // Get account by owner address
        let accountInfo;
        try {
          accountInfo = await exchange.getAccountByAddress(owner.address);
        } catch {
          // Account doesn't exist
          console.log("=== Owner Wallet ===");
          console.log(`Address: ${owner.address}`);
          console.log("\nNo direct exchange account found.");
          console.log("Use 'direct deposit' to create one.");

          const ownerEthBalance = await owner.getEthBalance();
          const ownerTokenBalance = await owner.getTokenBalance(
            config.chain.collateralToken
          );
          console.log("\n=== Owner Wallet Balances ===");
          console.log(`ETH: ${Number(ownerEthBalance) / 1e18}`);
          console.log(`USD stable: ${Number(ownerTokenBalance) / 1e6}`);
          return;
        }

        if (accountInfo.accountId === 0n) {
          console.log("=== Owner Wallet ===");
          console.log(`Address: ${owner.address}`);
          console.log("\nNo direct exchange account found.");
          console.log("Use 'direct deposit' to create one.");
          return;
        }

        console.log("=== Direct Exchange Account ===");
        console.log(`Owner: ${owner.address}`);
        console.log(`Account ID: ${accountInfo.accountId}`);
        console.log(`Balance: ${Number(accountInfo.balanceCNS) / 1e6} USD stable`);
        console.log(`Locked: ${Number(accountInfo.lockedBalanceCNS) / 1e6} USD stable`);
        console.log(
          `Available: ${Number(accountInfo.balanceCNS - accountInfo.lockedBalanceCNS) / 1e6} USD stable`
        );

        // Get positions
        console.log("\n=== Positions ===");

        for (const [name, perpId] of Object.entries(PERPETUALS)) {
          const { position, markPrice } = await exchange.getPosition(
            perpId,
            accountInfo.accountId
          );

          if (position.lotLNS > 0n) {
            const perpInfo = await exchange.getPerpetualInfo(perpId);
            const priceDecimals = Number(perpInfo.priceDecimals);
            const lotDecimals = Number(perpInfo.lotDecimals);

            const size = lnsToLot(position.lotLNS, BigInt(lotDecimals));
            const entryPrice = pnsToPrice(position.pricePNS, BigInt(priceDecimals));
            const currentPrice = pnsToPrice(markPrice, BigInt(priceDecimals));
            const pnl = Number(position.pnlCNS) / 1e6;

            const posType = Number(position.positionType) === 0 ? "LONG" : "SHORT";

            console.log(`\n${name}:`);
            console.log(`  Type: ${posType}`);
            console.log(`  Size: ${size.toFixed(lotDecimals)}`);
            console.log(`  Entry Price: $${entryPrice.toFixed(2)}`);
            console.log(`  Mark Price: $${currentPrice.toFixed(2)}`);
            console.log(`  PnL: $${pnl.toFixed(2)}`);
          }
        }

        // Owner wallet balances
        const ownerEthBalance = await owner.getEthBalance();
        const ownerTokenBalance = await owner.getTokenBalance(
          config.chain.collateralToken
        );

        console.log("\n=== Owner Wallet Balances ===");
        console.log(`ETH: ${Number(ownerEthBalance) / 1e18}`);
        console.log(`USD stable: ${Number(ownerTokenBalance) / 1e6}`);
      } catch (error) {
        console.error("Failed to fetch status:", error);
        process.exit(1);
      }
    });

  // Direct deposit
  direct
    .command("deposit")
    .description("Deposit collateral to direct exchange account (creates if needed)")
    .requiredOption("--amount <amount>", "Amount to deposit in USD stable")
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

      const amount = parseFloat(options.amount);
      const amountCNS = BigInt(Math.round(amount * 1e6));

      // Check if account exists
      let accountExists = false;
      let accountInfo;
      try {
        accountInfo = await exchange.getAccountByAddress(owner.address);
        accountExists = accountInfo.accountId > 0n;
      } catch {
        accountExists = false;
      }

      if (!accountExists) {
        console.log(`Creating direct exchange account with ${amount} USD stable...`);

        // Approve tokens
        const account = owner.walletClient.account;
        if (!account) throw new Error("No account");

        console.log("Approving tokens...");
        const approveHash = await owner.walletClient.writeContract({
          address: config.chain.collateralToken,
          abi: ERC20Abi,
          functionName: "approve",
          args: [config.chain.exchangeAddress, amountCNS],
          account,
          chain: owner.walletClient.chain,
        });
        console.log(`Approve tx: ${approveHash}`);
        await owner.publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Create account
        console.log("Creating account...");
        const createHash = await owner.walletClient.writeContract({
          address: config.chain.exchangeAddress,
          abi: ExchangeAbi,
          functionName: "createAccount",
          args: [amountCNS],
          account,
          chain: owner.walletClient.chain,
        });
        console.log(`Create account tx: ${createHash}`);

        // Get new account ID
        await owner.publicClient.waitForTransactionReceipt({ hash: createHash });
        const newAccountInfo = await exchange.getAccountByAddress(owner.address);
        console.log(`Account created with ID: ${newAccountInfo.accountId}`);
      } else {
        console.log(`Depositing ${amount} USD stable to account ${accountInfo!.accountId}...`);

        const account = owner.walletClient.account;
        if (!account) throw new Error("No account");

        // Approve tokens
        console.log("Approving tokens...");
        const approveHash = await owner.walletClient.writeContract({
          address: config.chain.collateralToken,
          abi: ERC20Abi,
          functionName: "approve",
          args: [config.chain.exchangeAddress, amountCNS],
          account,
          chain: owner.walletClient.chain,
        });
        console.log(`Approve tx: ${approveHash}`);
        await owner.publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Deposit
        console.log("Depositing...");
        const depositHash = await owner.walletClient.writeContract({
          address: config.chain.exchangeAddress,
          abi: ExchangeAbi,
          functionName: "depositCollateral",
          args: [amountCNS],
          account,
          chain: owner.walletClient.chain,
        });
        console.log(`Deposit tx: ${depositHash}`);
      }
    });

  // Direct open position
  direct
    .command("open")
    .description("Open a position directly from owner wallet")
    .requiredOption("--perp <name>", "Perpetual to trade (btc, eth, sol, mon, zec)")
    .requiredOption("--side <side>", "Position side (long or short)")
    .requiredOption("--size <amount>", "Position size")
    .requiredOption("--price <price>", "Limit price")
    .option("--leverage <multiplier>", "Leverage multiplier", "1")
    .option("--ioc", "Immediate-or-cancel order")
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

      const perpId = resolvePerpId(options.perp);
      const side = options.side.toLowerCase();
      const size = parseFloat(options.size);
      const price = parseFloat(options.price);
      const leverage = parseFloat(options.leverage);

      // Get perpetual info for decimals
      const perpInfo = await exchange.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      console.log(`Opening ${side} position (direct)...`);
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
        const txHash = await exchange.execOrder(orderDesc);
        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Trade failed:", error);
        process.exit(1);
      }
    });

  // Direct close position
  direct
    .command("close")
    .description("Close a position directly from owner wallet")
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

      const perpId = resolvePerpId(options.perp);
      const side = options.side.toLowerCase();
      const size = parseFloat(options.size);
      const price = parseFloat(options.price);

      // Get perpetual info for decimals
      const perpInfo = await exchange.getPerpetualInfo(perpId);
      const priceDecimals = BigInt(perpInfo.priceDecimals);
      const lotDecimals = BigInt(perpInfo.lotDecimals);

      console.log(`Closing ${side} position (direct)...`);
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
        const txHash = await exchange.execOrder(orderDesc);
        console.log(`\nTransaction submitted: ${txHash}`);
      } catch (error) {
        console.error("Close failed:", error);
        process.exit(1);
      }
    });
}
