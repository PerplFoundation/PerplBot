/**
 * Forensics report renderer
 * Prints a human-readable forensics report to the terminal
 */

import chalk from "chalk";
import { formatEther } from "viem";
import { OrderType } from "../contracts/Exchange.js";
import { pnsToPrice, lnsToLot, hdthsToLeverage } from "../trading/orders.js";
import type { ForensicsResult, MatchInfo } from "./forensics.js";
import type { AccountSnapshot } from "./dry-run.js";

// ============ Color helpers ============

const success = (s: string) => chalk.green.bold(s);
const fail = (s: string) => chalk.red.bold(s);
const warn = (s: string) => chalk.yellow(s);
const positive = (s: string) => chalk.green(s);
const negative = (s: string) => chalk.red(s);
const longColor = (s: string) => chalk.green(s);
const shortColor = (s: string) => chalk.red(s);
const header = (s: string) => chalk.bold(s);
const dim = (s: string) => chalk.dim(s);

// ============ Constants ============

const SEPARATOR = "═".repeat(60);
const THIN_SEP = "─".repeat(60);
const BAR_WIDTH = 30;

// ============ Utilities ============

function formatCNS(value: bigint): string {
  const num = Number(value) / 1e6;
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSignedCNS(value: bigint): string {
  const num = Number(value) / 1e6;
  const sign = num >= 0 ? "+" : "";
  return sign + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function orderTypeName(ot: number): string {
  switch (ot) {
    case OrderType.OpenLong: return "Open Long";
    case OrderType.OpenShort: return "Open Short";
    case OrderType.CloseLong: return "Close Long";
    case OrderType.CloseShort: return "Close Short";
    case OrderType.Cancel: return "Cancel";
    case OrderType.Change: return "Change";
    default: return `Unknown(${ot})`;
  }
}

function colorSide(posType: number): string {
  return posType === 0 ? longColor("LONG") : shortColor("SHORT");
}

function balanceBar(pre: bigint, post: bigint): string {
  const preNum = Number(pre);
  const postNum = Number(post);
  const maxVal = Math.max(preNum, postNum, 1);

  const preLen = Math.round((preNum / maxVal) * BAR_WIDTH);
  const postLen = Math.round((postNum / maxVal) * BAR_WIDTH);

  const preFull = "█".repeat(preLen);
  const preShade = "░".repeat(BAR_WIDTH - preLen);
  const postFull = "█".repeat(postLen);
  const postShade = "░".repeat(BAR_WIDTH - postLen);

  const diff = postNum - preNum;
  const colorPost = diff >= 0 ? positive : negative;

  return (
    `  ${dim("Before:")} ${dim(preFull + preShade)}\n` +
    `  ${dim("After:")}  ${colorPost(postFull + postShade)}`
  );
}

// ============ Report Sections ============

function printHeader(result: ForensicsResult): void {
  console.log();
  console.log(header("TRANSACTION FORENSICS"));
  console.log(dim(SEPARATOR));
  console.log(`  Hash:     ${dim(result.txHash)}`);
  console.log(`  Block:    ${result.blockNumber}`);
  console.log(`  From:     ${dim(result.from)}`);
  console.log(`  To:       ${dim(result.to)}${result.isDelegated ? dim(" (DelegatedAccount)") : ""}`);
  console.log(`  Status:   ${result.originalSuccess ? success("SUCCESS") : fail("REVERTED")}`);
  console.log(`  Gas Used: ${result.originalGasUsed.toLocaleString()}`);
}

function printWhatWasAttempted(result: ForensicsResult): void {
  if (!result.decodedInput) {
    console.log();
    console.log(header("What Was Attempted:"));
    console.log(dim("  Unable to decode transaction calldata"));
    return;
  }

  const { functionName, orderDesc, orderDescs } = result.decodedInput;
  const priceDecimals = result.perpInfo?.priceDecimals ?? 1n;
  const lotDecimals = result.perpInfo?.lotDecimals ?? 5n;
  const perpName = result.perpName ?? "Unknown";

  console.log();
  console.log(header("What Was Attempted:"));

  if (orderDesc) {
    const ot = orderTypeName(Number(orderDesc.orderType));
    const price = pnsToPrice(orderDesc.pricePNS, priceDecimals);
    const size = lnsToLot(orderDesc.lotLNS, lotDecimals);
    const leverage = hdthsToLeverage(orderDesc.leverageHdths);

    const isLong = orderDesc.orderType === OrderType.OpenLong || orderDesc.orderType === OrderType.CloseLong;
    const otColored = isLong ? longColor(ot) : shortColor(ot);

    let flags = "";
    if (orderDesc.immediateOrCancel) flags += " IOC";
    if (orderDesc.postOnly) flags += " Post-only";
    if (orderDesc.fillOrKill) flags += " Fill-or-kill";

    console.log(`  ${otColored} ${size.toFixed(5)} ${perpName} @ $${formatPrice(price)}, ${leverage}x leverage${flags ? dim(flags) : ""}`);
  } else if (orderDescs && orderDescs.length > 0) {
    console.log(`  Batch of ${orderDescs.length} orders (execOrders)`);
    for (let i = 0; i < Math.min(orderDescs.length, 5); i++) {
      const od = orderDescs[i];
      const ot = orderTypeName(Number(od.orderType));
      const price = pnsToPrice(od.pricePNS, priceDecimals);
      const size = lnsToLot(od.lotLNS, lotDecimals);
      console.log(dim(`    ${i + 1}. ${ot} ${size.toFixed(5)} @ $${formatPrice(price)}`));
    }
    if (orderDescs.length > 5) {
      console.log(dim(`    ... and ${orderDescs.length - 5} more`));
    }
  } else {
    console.log(`  ${functionName}()`);
  }
}

function printFailureAnalysis(result: ForensicsResult): void {
  if (!result.failure) return;

  console.log();
  console.log(dim(THIN_SEP));
  console.log(fail("Failure Analysis:"));
  console.log(`  Reason:      ${fail(result.failure.rawReason)}`);
  console.log(`  Explanation: ${result.failure.explanation}`);
  if (result.failure.suggestion) {
    console.log(`  Suggestion:  ${warn(result.failure.suggestion)}`);
  }
}

function printMatchDetails(result: ForensicsResult): void {
  if (result.matches.length === 0) return;

  const priceDecimals = result.perpInfo?.priceDecimals ?? 1n;
  const lotDecimals = result.perpInfo?.lotDecimals ?? 5n;

  console.log();
  console.log(dim(THIN_SEP));
  console.log(header("Match Details:"));

  for (let i = 0; i < result.matches.length; i++) {
    const m = result.matches[i];
    const price = pnsToPrice(m.pricePNS, priceDecimals);
    const lots = lnsToLot(m.lotLNS, lotDecimals);
    const fee = formatCNS(m.feeCNS);
    console.log(
      `  Fill ${i + 1}: ${lots.toFixed(5)} lots @ $${formatPrice(price)}` +
      dim(` | maker #${m.makerAccountId} order #${m.makerOrderId} | fee: ${fee} USDC`)
    );
  }

  // Totals
  if (result.fillPrice !== null) {
    console.log();
    console.log(`  Avg Fill Price: $${formatPrice(result.fillPrice)}`);
  }
  if (result.totalFilledLots !== null) {
    console.log(`  Total Filled:   ${result.totalFilledLots.toFixed(5)} lots`);
  }
  const totalFees = result.matches.reduce((sum, m) => sum + m.feeCNS, 0n);
  if (totalFees > 0n) {
    console.log(`  Total Fees:     ${formatCNS(totalFees)} USDC`);
  }
}

function printAccountChanges(result: ForensicsResult): void {
  const { preState, postState } = result;

  console.log();
  console.log(dim(THIN_SEP));
  console.log(header("Account Changes:"));

  const balPre = formatCNS(preState.balanceCNS);
  const balPost = formatCNS(postState.balanceCNS);
  const balDiffRaw = postState.balanceCNS - preState.balanceCNS;
  const balDiff = formatSignedCNS(balDiffRaw);
  const balDiffColor = balDiffRaw >= 0n ? positive : negative;
  console.log(`  Balance:        ${balPre} -> ${balPost} USDC (${balDiffColor(balDiff)})`);

  const lockedPre = formatCNS(preState.lockedBalanceCNS);
  const lockedPost = formatCNS(postState.lockedBalanceCNS);
  const lockedDiffRaw = postState.lockedBalanceCNS - preState.lockedBalanceCNS;
  const lockedDiff = formatSignedCNS(lockedDiffRaw);
  console.log(`  Locked Balance: ${lockedPre} -> ${lockedPost} USDC (${dim(lockedDiff)})`);

  // Balance bar
  console.log(balanceBar(preState.balanceCNS, postState.balanceCNS));
}

function printPositionChanges(result: ForensicsResult): void {
  const priceDecimals = result.perpInfo?.priceDecimals ?? 1n;
  const lotDecimals = result.perpInfo?.lotDecimals ?? 5n;
  const { preState, postState } = result;

  console.log();
  console.log(header("Position Changes:"));

  if (preState.position) {
    const side = colorSide(preState.position.positionType);
    const lots = lnsToLot(preState.position.lotLNS, lotDecimals);
    const entry = pnsToPrice(preState.position.pricePNS, priceDecimals);
    const deposit = formatCNS(preState.position.depositCNS);
    console.log(`  Before: ${side} ${lots.toFixed(5)} lots @ ${formatPrice(entry)} avg entry, margin: ${deposit} USDC`);
  } else {
    console.log(`  Before: ${dim("No position")}`);
  }

  if (postState.position) {
    const side = colorSide(postState.position.positionType);
    const lots = lnsToLot(postState.position.lotLNS, lotDecimals);
    const entry = pnsToPrice(postState.position.pricePNS, priceDecimals);
    const deposit = formatCNS(postState.position.depositCNS);
    console.log(`  After:  ${side} ${lots.toFixed(5)} lots @ ${formatPrice(entry)} avg entry, margin: ${deposit} USDC`);
  } else {
    console.log(`  After:  ${dim("No position")}`);
  }
}

function printEvents(result: ForensicsResult): void {
  const events = result.replayEvents.length > 0 ? result.replayEvents : result.originalEvents;
  if (events.length === 0) return;

  console.log();
  console.log(header("Events:"));
  for (const ev of events) {
    const argsStr = Object.entries(ev.args)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    console.log(dim(`  ${ev.eventName}(${argsStr})`));
  }
}

function printSummary(result: ForensicsResult): void {
  const priceDecimals = result.perpInfo?.priceDecimals ?? 1n;
  const lotDecimals = result.perpInfo?.lotDecimals ?? 5n;
  const perpName = result.perpName ?? "Unknown";

  console.log();
  console.log(dim(THIN_SEP));
  console.log(header("Summary:"));

  if (!result.decodedInput?.orderDesc) {
    if (result.originalSuccess) {
      console.log(`  ${result.decodedInput?.functionName ?? "Transaction"} completed successfully.`);
    } else {
      console.log(`  Transaction reverted.`);
    }
    return;
  }

  const od = result.decodedInput.orderDesc;
  const ot = orderTypeName(Number(od.orderType));
  const size = lnsToLot(od.lotLNS, lotDecimals);
  const leverage = hdthsToLeverage(od.leverageHdths);

  if (result.originalSuccess && result.matches.length > 0) {
    const totalFees = result.matches.reduce((sum, m) => sum + m.feeCNS, 0n);
    const feeStr = formatCNS(totalFees);
    const price = result.fillPrice !== null ? `$${formatPrice(result.fillPrice)}` : "N/A";

    console.log(
      `  Your ${ot.toLowerCase()} for ${size.toFixed(5)} ${perpName} was ` +
      `filled against ${result.matches.length} maker(s) at avg ${price}. ` +
      `Total fees: ${feeStr} USDC.`
    );

    if (result.postState.position) {
      const posLots = lnsToLot(result.postState.position.lotLNS, lotDecimals);
      const posEntry = pnsToPrice(result.postState.position.pricePNS, priceDecimals);
      const side = result.postState.position.positionType === 0 ? "long" : "short";
      console.log(
        `  You now hold a ${leverage}x ${side} of ${posLots.toFixed(5)} ${perpName} at $${formatPrice(posEntry)}.`
      );
    }
  } else if (result.originalSuccess && result.matches.length === 0) {
    console.log(`  Your ${ot.toLowerCase()} for ${size.toFixed(5)} ${perpName} was placed on the book (no immediate fills).`);
  } else {
    console.log(`  Your ${ot.toLowerCase()} for ${size.toFixed(5)} ${perpName} failed.`);
    if (result.failure?.suggestion) {
      console.log(`  Suggestion: ${result.failure.suggestion}`);
    }
  }
}

// ============ Main Report ============

/**
 * Print the full forensics report to console.
 */
export function printForensicsReport(result: ForensicsResult): void {
  printHeader(result);
  printWhatWasAttempted(result);

  if (result.failure) {
    printFailureAnalysis(result);
  }

  if (result.matches.length > 0) {
    printMatchDetails(result);
  }

  printAccountChanges(result);

  // Only show position changes for order-type transactions
  if (result.decodedInput?.orderDesc || result.decodedInput?.orderDescs) {
    printPositionChanges(result);
  }

  printEvents(result);
  printSummary(result);

  console.log();
  console.log(dim(SEPARATOR));
}

/**
 * Serialize a ForensicsResult to JSON-safe object (BigInts as strings).
 */
export function forensicsResultToJson(result: ForensicsResult): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(result, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}
