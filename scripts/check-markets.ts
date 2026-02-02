#!/usr/bin/env npx tsx
/**
 * Check which perpetual markets are available on the exchange
 */

import { config } from "dotenv";
import { loadEnvConfig, Exchange, pnsToPrice, ALL_PERP_IDS } from "../src/sdk/index.js";

config();

async function main() {
  const envConfig = loadEnvConfig();
  const exchange = new Exchange(
    envConfig.chain.exchangeAddress,
    // Create a simple public client
    (await import("viem")).createPublicClient({
      chain: envConfig.chain.chain,
      transport: (await import("viem")).http(envConfig.chain.rpcUrl),
    })
  );

  // Perpetual IDs from dex-sdk: https://github.com/PerplFoundation/dex-sdk/blob/main/crates/sdk/src/lib.rs
  console.log("Checking perpetual markets...\n");
  console.log(`Known IDs from dex-sdk: ${ALL_PERP_IDS.join(", ")}\n`);

  console.log("| ID  | Symbol | Mark Price | Oracle Price | Paused |");
  console.log("|-----|--------|------------|--------------|--------|");

  for (const perpId of ALL_PERP_IDS) {
    try {
      const info = await exchange.getPerpetualInfo(perpId);
      const markPrice = pnsToPrice(info.markPNS, info.priceDecimals);
      const oraclePrice = pnsToPrice(info.oraclePNS, info.priceDecimals);
      const markStr = markPrice > 0 ? `$${markPrice.toFixed(2)}` : "N/A";
      const oracleStr = oraclePrice > 0 ? `$${oraclePrice.toFixed(2)}` : "N/A";
      console.log(`| ${String(perpId).padEnd(3)} | ${info.symbol.padEnd(6)} | ${markStr.padEnd(10)} | ${oracleStr.padEnd(12)} | ${info.paused ? "Yes" : "No".padEnd(6)} |`);
    } catch (e: any) {
      // Market doesn't exist
      console.log(`| ${String(perpId).padEnd(3)} | not found |`);
    }
  }
}

main().catch(console.error);
