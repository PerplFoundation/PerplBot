/**
 * Strategy simulation report renderer
 * Prints a terminal report with ANSI colors, Unicode bars, and tables
 */

import chalk from "chalk";
import { formatEther } from "viem";
import { OrderType } from "../contracts/Exchange.js";
import { pnsToPrice, lnsToLot } from "../trading/orders.js";
import type { StrategySimResult, OrderResult } from "./strategy-sim.js";
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

function orderTypeName(ot: OrderType): string {
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

function statusLabel(status: string): string {
  switch (status) {
    case "filled": return success("FILLED");
    case "resting": return warn("RESTING");
    case "failed": return fail("FAILED");
    default: return dim(status);
  }
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

// ============ Main Report ============

export function printStrategySimReport(result: StrategySimResult): void {
  const {
    strategyType,
    perpName,
    perpInfo,
    priceDecimals,
    lotDecimals,
    midPrice,
    gridConfig,
    mmConfig,
    orderResults,
    totalOrders,
    filledOrders,
    restingOrders,
    failedOrders,
    totalFilledLots,
    totalFeesCNS,
    preState,
    postState,
    gasUsed,
    gasPrice,
    gasCostWei,
    gridMetrics,
  } = result;

  const market = `${perpName ?? "?"}-PERP`;
  const stratLabel = strategyType === "grid" ? "GRID" : "MARKET MAKER";

  // Header
  console.log();
  console.log(warn("STRATEGY DRY RUN") + dim(` - ${stratLabel} on ${market}`));
  console.log(dim(SEPARATOR));

  // Strategy config summary
  console.log();
  console.log(header("Strategy Config:"));
  if (strategyType === "grid" && gridConfig) {
    const center = gridConfig.centerPrice ?? midPrice;
    console.log(`  Type:       ${stratLabel}`);
    console.log(`  Center:     $${formatPrice(center)}`);
    console.log(`  Levels:     ${gridConfig.gridLevels} above + ${gridConfig.gridLevels} below`);
    console.log(`  Spacing:    $${formatPrice(gridConfig.gridSpacing)}`);
    console.log(`  Size:       ${gridConfig.orderSize} lots/level`);
    console.log(`  Leverage:   ${gridConfig.leverage}x`);
    if (gridConfig.postOnly) console.log(`  Execution:  ${dim("Post-only")}`);
  } else if (strategyType === "mm" && mmConfig) {
    console.log(`  Type:       ${stratLabel}`);
    console.log(`  Size:       ${mmConfig.orderSize} lots/side`);
    console.log(`  Spread:     ${(mmConfig.spreadPercent * 100).toFixed(2)}%`);
    console.log(`  Max Pos:    ${mmConfig.maxPosition} lots`);
    console.log(`  Leverage:   ${mmConfig.leverage}x`);
    if (mmConfig.postOnly) console.log(`  Execution:  ${dim("Post-only")}`);
  }

  // Market state
  console.log();
  console.log(dim(THIN_SEP));
  console.log(header("Market State:"));
  console.log(`  Mark Price: $${formatPrice(midPrice)}`);

  const basePNS = perpInfo.basePricePNS;
  if (perpInfo.maxBidPriceONS > 0n) {
    const bestBid = pnsToPrice(perpInfo.maxBidPriceONS + basePNS, priceDecimals);
    console.log(`  Best Bid:   $${formatPrice(bestBid)}`);
  }
  if (perpInfo.minAskPriceONS > 0n) {
    const bestAsk = pnsToPrice(perpInfo.minAskPriceONS + basePNS, priceDecimals);
    console.log(`  Best Ask:   $${formatPrice(bestAsk)}`);
  }

  if (perpInfo.maxBidPriceONS > 0n && perpInfo.minAskPriceONS > 0n) {
    const bestBid = pnsToPrice(perpInfo.maxBidPriceONS + basePNS, priceDecimals);
    const bestAsk = pnsToPrice(perpInfo.minAskPriceONS + basePNS, priceDecimals);
    const spread = bestAsk - bestBid;
    const spreadPct = ((spread / bestBid) * 100).toFixed(2);
    console.log(`  Spread:     $${formatPrice(spread)} (${spreadPct}%)`);
  }

  // OI bars
  const longOI = lnsToLot(perpInfo.longOpenInterestLNS, lotDecimals);
  const shortOI = lnsToLot(perpInfo.shortOpenInterestLNS, lotDecimals);
  if (longOI > 0 || shortOI > 0) {
    const maxOI = Math.max(longOI, shortOI, 0.001);
    const longBar = Math.round((longOI / maxOI) * 20);
    const shortBar = Math.round((shortOI / maxOI) * 20);
    console.log();
    console.log(dim("  Open Interest:"));
    console.log(
      longColor(`  LONG  ${"█".repeat(longBar)}${"░".repeat(20 - longBar)}`) +
      `  ${longOI.toFixed(2)} lots`
    );
    console.log(
      shortColor(`  SHORT ${"█".repeat(shortBar)}${"░".repeat(20 - shortBar)}`) +
      `  ${shortOI.toFixed(2)} lots`
    );
  }

  // Order results table
  console.log();
  console.log(dim(THIN_SEP));
  console.log(header("Order Results:"));
  console.log(
    dim("  #   Type          Price          Size       Status      Fill Price    Fees")
  );
  console.log(dim("  " + "─".repeat(76)));

  for (const or of orderResults) {
    const idx = String(or.index + 1).padStart(2);
    const typeName = orderTypeName(or.orderType);
    const isLong = or.orderType === OrderType.OpenLong || or.orderType === OrderType.CloseLong;
    const typeColored = isLong ? longColor(typeName.padEnd(12)) : shortColor(typeName.padEnd(12));
    const price = `$${formatPrice(pnsToPrice(or.pricePNS, priceDecimals))}`.padStart(12);
    const size = lnsToLot(or.lotLNS, lotDecimals).toFixed(5).padStart(10);
    const status = statusLabel(or.status);
    const fillPrice = or.avgFillPrice !== null
      ? `$${formatPrice(or.avgFillPrice)}`.padStart(12)
      : dim("—".padStart(12));
    const fees = or.totalFeesCNS > 0n
      ? `$${formatCNS(or.totalFeesCNS)}`.padStart(8)
      : dim("—".padStart(8));

    console.log(`  ${idx}  ${typeColored} ${price}  ${size}  ${status}  ${fillPrice}  ${fees}`);
  }

  // Fill summary
  console.log();
  console.log(dim(THIN_SEP));
  console.log(header("Fill Summary:"));
  console.log(`  Total Orders:    ${totalOrders}`);
  console.log(`  Filled:          ${success(String(filledOrders))}`);
  console.log(`  Resting:         ${warn(String(restingOrders))}`);
  console.log(`  Failed:          ${failedOrders > 0 ? fail(String(failedOrders)) : dim("0")}`);
  console.log(`  Filled Lots:     ${totalFilledLots.toFixed(5)}`);
  console.log(`  Total Fees:      $${formatCNS(totalFeesCNS)} USDC`);
  console.log(`  Fee Rates:       taker ${result.takerFeePer100K}/100k, maker ${result.makerFeePer100K}/100k`);

  // Account changes
  console.log();
  console.log(dim(THIN_SEP));
  console.log(header("Account Changes:"));
  printAccountDiff(preState, postState);
  console.log(balanceBar(preState.balanceCNS, postState.balanceCNS));

  // Position changes
  console.log();
  console.log(header("Position Changes:"));
  printPositionDiff(preState, postState, priceDecimals, lotDecimals);

  // Gas costs
  console.log();
  console.log(dim(THIN_SEP));
  console.log(header("Gas:"));
  console.log(`  Gas Used:   ${gasUsed.toLocaleString()}`);
  if (gasPrice > 0n) {
    console.log(`  Gas Price:  ${dim(formatEther(gasPrice) + " MON/gas")}`);
  }
  console.log(`  Gas Cost:   ${dim(formatEther(gasCostWei) + " MON")}`);

  // Grid metrics
  if (gridMetrics) {
    console.log();
    console.log(dim(THIN_SEP));
    console.log(header("Grid Metrics:"));
    console.log(`  Capital Required:     $${formatPrice(gridMetrics.totalCapital)}`);
    console.log(`  Profit/Round-Trip:    $${formatPrice(gridMetrics.profitPerRoundTrip)}`);
    console.log(
      `  Breakeven Trips:     ${gridMetrics.breakevenRoundTrips === Infinity ? dim("Never (fees > profit)") : gridMetrics.breakevenRoundTrips}`
    );
    console.log(`  Max Position:         ${gridMetrics.maxPositionSize.toFixed(5)} lots`);
  }

  console.log();
  console.log(dim(SEPARATOR));
  console.log(dim("This was a simulation on a forked chain. No real trades were executed."));
}

function printAccountDiff(pre: AccountSnapshot, post: AccountSnapshot): void {
  const balPre = formatCNS(pre.balanceCNS);
  const balPost = formatCNS(post.balanceCNS);
  const balDiffRaw = post.balanceCNS - pre.balanceCNS;
  const balDiff = formatSignedCNS(balDiffRaw);
  const balDiffColor = balDiffRaw >= 0n ? positive : negative;

  console.log(`  Balance:        ${balPre} -> ${balPost} USDC (${balDiffColor(balDiff)})`);

  const lockedPre = formatCNS(pre.lockedBalanceCNS);
  const lockedPost = formatCNS(post.lockedBalanceCNS);
  const lockedDiffRaw = post.lockedBalanceCNS - pre.lockedBalanceCNS;
  const lockedDiff = formatSignedCNS(lockedDiffRaw);

  console.log(`  Locked Balance: ${lockedPre} -> ${lockedPost} USDC (${dim(lockedDiff)})`);
}

function printPositionDiff(
  pre: AccountSnapshot,
  post: AccountSnapshot,
  priceDecimals: bigint,
  lotDecimals: bigint,
): void {
  if (pre.position) {
    const side = colorSide(pre.position.positionType);
    const lots = lnsToLot(pre.position.lotLNS, lotDecimals);
    const entryPrice = pnsToPrice(pre.position.pricePNS, priceDecimals);
    const deposit = formatCNS(pre.position.depositCNS);
    console.log(`  Before: ${side} ${lots.toFixed(5)} lots @ ${formatPrice(entryPrice)} avg entry, margin: ${deposit} USDC`);
  } else {
    console.log(`  Before: ${dim("No position")}`);
  }

  if (post.position) {
    const side = colorSide(post.position.positionType);
    const lots = lnsToLot(post.position.lotLNS, lotDecimals);
    const entryPrice = pnsToPrice(post.position.pricePNS, priceDecimals);
    const deposit = formatCNS(post.position.depositCNS);
    console.log(`  After:  ${side} ${lots.toFixed(5)} lots @ ${formatPrice(entryPrice)} avg entry, margin: ${deposit} USDC`);
  } else {
    console.log(`  After:  ${dim("No position")}`);
  }
}

// ============ JSON Serialization ============

/**
 * Convert StrategySimResult to a JSON-serializable object (BigInt → string)
 */
export function strategySimResultToJson(result: StrategySimResult): Record<string, unknown> {
  const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
  return JSON.parse(JSON.stringify(result, replacer));
}
