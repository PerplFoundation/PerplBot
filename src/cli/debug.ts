/**
 * Debug command — Transaction forensics / trade analysis
 * Paste a tx hash → replay on fork → explain what happened
 */

import type { Command } from "commander";
import type { Address, Hash } from "viem";
import {
  loadEnvConfig,
  isAnvilInstalled,
} from "../sdk/index.js";
import {
  analyzeTransaction,
} from "../sdk/simulation/forensics.js";
import {
  printForensicsReport,
  forensicsResultToJson,
} from "../sdk/simulation/forensics-report.js";

export function registerDebugCommand(program: Command): void {
  program
    .command("debug <txhash>")
    .description("Analyze a transaction — replay on fork, decode events, explain what happened")
    .option("--rpc <url>", "RPC URL override")
    .option("--exchange <addr>", "Exchange address override")
    .option("--json", "Output raw JSON instead of formatted report")
    .action(async (txhash: string, options) => {
      // Validate tx hash format
      if (!/^0x[0-9a-fA-F]{64}$/.test(txhash)) {
        console.error("Invalid transaction hash. Expected 0x-prefixed 64-char hex string.");
        process.exit(1);
      }

      // Check Anvil availability
      if (!await isAnvilInstalled()) {
        console.error(
          "Anvil is required for transaction forensics.\n" +
          "Install Foundry: https://getfoundry.sh"
        );
        process.exit(1);
      }

      const config = loadEnvConfig();
      const rpcUrl = options.rpc ?? config.chain.rpcUrl;
      const exchangeAddress = (options.exchange ?? config.chain.exchangeAddress) as Address;

      console.log("Analyzing transaction...");

      try {
        const result = await analyzeTransaction(
          rpcUrl,
          exchangeAddress,
          txhash as Hash,
          config.chain,
        );

        if (options.json) {
          console.log(JSON.stringify(forensicsResultToJson(result), null, 2));
        } else {
          printForensicsReport(result);
        }
      } catch (error: any) {
        console.error("Forensics analysis failed:", error.message || error);
        process.exit(1);
      }
    });
}
