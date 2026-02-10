/**
 * Dry-run report formatting
 * Renders simulation results to the terminal with ANSI colors,
 * Unicode bar charts, mini orderbook, and price scale diagram
 */

import chalk from "chalk";
import { formatEther } from "viem";
import type { OrderDesc, PerpetualInfo } from "../contracts/Exchange.js";
import { OrderType } from "../contracts/Exchange.js";
import { pnsToPrice, lnsToLot, hdthsToLeverage } from "../trading/orders.js";
import type { DryRunResult, AccountSnapshot } from "./dry-run.js";

// ============ Color helpers ============

const success = (s: string) => chalk.green.bold(s);
const fail = (s: string) => chalk.red.bold(s);
const warn = (s: string) => chalk.yellow(s);
const positive = (s: string) => chalk.green(s);
const negative = (s: string) => chalk.red(s);
const long = (s: string) => chalk.green(s);
const short = (s: string) => chalk.red(s);
const header = (s: string) => chalk.bold(s);
const dim = (s: string) => chalk.dim(s);

// ============ Constants ============

const SEPARATOR = "═".repeat(52);
const THIN_SEP = "─".repeat(52);
const BAR_WIDTH = 30;
const BOOK_BAR_WIDTH = 20;
const SCALE_WIDTH = 44;

// ============ Utilities ============

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
  return price.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function positionSide(posType: number): string {
  return posType === 0 ? "LONG" : "SHORT";
}

function colorSide(posType: number): string {
  return posType === 0 ? long("LONG") : short("SHORT");
}

// ============ Bar Charts ============

/**
 * Render a horizontal balance bar comparing pre and post values
 */
function balanceBar(pre: bigint, post: bigint): string {
  const preNum = Number(pre);
  const postNum = Number(post);
  const maxVal = Math.max(preNum, postNum, 1); // avoid divide-by-zero

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

// ============ Mini Orderbook ============

/**
 * Print a mini orderbook visualization from perpInfo
 */
function printMiniOrderbook(
  perpInfo: PerpetualInfo,
  priceDecimals: bigint,
  lotDecimals: bigint,
  fillPricePNS?: bigint,
): void {
  const numOrders = Number(perpInfo.numOrders);
  if (numOrders === 0) return;

  const basePNS = perpInfo.basePricePNS;

  // ONS→price: add basePricePNS then convert
  const maxBid = Number(perpInfo.maxBidPriceONS);
  const minBid = Number(perpInfo.minBidPriceONS);
  const maxAsk = Number(perpInfo.maxAskPriceONS);
  const minAsk = Number(perpInfo.minAskPriceONS);

  // Skip if all ONS values are zero (no resting orders on one/both sides)
  if (maxBid === 0 && minBid === 0 && maxAsk === 0 && minAsk === 0) return;

  const toPrice = (ons: number) =>
    pnsToPrice(BigInt(ons) + basePNS, priceDecimals);

  console.log();
  console.log(header("Orderbook Spread:"));
  console.log(dim(`  ${numOrders} resting orders`));

  // Compute price range for bar scaling
  const allPrices: number[] = [];
  if (maxAsk > 0) allPrices.push(toPrice(maxAsk));
  if (minAsk > 0) allPrices.push(toPrice(minAsk));
  if (maxBid > 0) allPrices.push(toPrice(maxBid));
  if (minBid > 0) allPrices.push(toPrice(minBid));

  if (allPrices.length < 2) return;

  const rangeMin = Math.min(...allPrices);
  const rangeMax = Math.max(...allPrices);
  const range = rangeMax - rangeMin || 1;

  const scaleBar = (price: number): number =>
    Math.max(1, Math.round(((price - rangeMin) / range) * BOOK_BAR_WIDTH));

  // Ask side (worst = maxAsk, best = minAsk)
  if (maxAsk > 0) {
    const worstAskPrice = toPrice(maxAsk);
    const barLen = scaleBar(worstAskPrice);
    console.log(
      short(`  ASK  ${"█".repeat(barLen)}${"░".repeat(BOOK_BAR_WIDTH - barLen)}  ${formatPrice(worstAskPrice)}`) +
      dim(" (worst)")
    );
  }
  if (minAsk > 0) {
    const bestAskPrice = toPrice(minAsk);
    const barLen = scaleBar(bestAskPrice);
    console.log(
      short(`  ASK  ${"█".repeat(barLen)}${"░".repeat(BOOK_BAR_WIDTH - barLen)}  ${formatPrice(bestAskPrice)}`) +
      dim(" (best)")
    );
  }

  // Spread
  if (minAsk > 0 && maxBid > 0) {
    const bestAskP = toPrice(minAsk);
    const bestBidP = toPrice(maxBid);
    const spread = bestAskP - bestBidP;
    const spreadPct = ((spread / bestBidP) * 100).toFixed(2);
    console.log(dim(`       ─── spread: ${formatPrice(spread)} (${spreadPct}%) ───`));
  }

  // Bid side (best = maxBid, worst = minBid)
  if (maxBid > 0) {
    const bestBidPrice = toPrice(maxBid);
    const barLen = scaleBar(bestBidPrice);
    console.log(
      long(`  BID  ${"█".repeat(barLen)}${"░".repeat(BOOK_BAR_WIDTH - barLen)}  ${formatPrice(bestBidPrice)}`) +
      dim(" (best)")
    );
  }
  if (minBid > 0) {
    const worstBidPrice = toPrice(minBid);
    const barLen = scaleBar(worstBidPrice);
    console.log(
      long(`  BID  ${"█".repeat(barLen)}${"░".repeat(BOOK_BAR_WIDTH - barLen)}  ${formatPrice(worstBidPrice)}`) +
      dim(" (worst)")
    );
  }

  // Fill price indicator
  if (fillPricePNS && fillPricePNS > 0n) {
    const fillPrice = pnsToPrice(fillPricePNS, priceDecimals);
    console.log(warn(`       ▲ fill: ${formatPrice(fillPrice)}`));
  }

  // Open interest
  const longOI = lnsToLot(perpInfo.longOpenInterestLNS, lotDecimals);
  const shortOI = lnsToLot(perpInfo.shortOpenInterestLNS, lotDecimals);
  if (longOI > 0 || shortOI > 0) {
    const maxOI = Math.max(longOI, shortOI, 0.001);
    const longBar = Math.round((longOI / maxOI) * BOOK_BAR_WIDTH);
    const shortBar = Math.round((shortOI / maxOI) * BOOK_BAR_WIDTH);

    console.log();
    console.log(dim("  Open Interest:"));
    console.log(
      long(`  LONG  ${"█".repeat(longBar)}${"░".repeat(BOOK_BAR_WIDTH - longBar)}`) +
      `  ${longOI.toFixed(2)} lots`
    );
    console.log(
      short(`  SHORT ${"█".repeat(shortBar)}${"░".repeat(BOOK_BAR_WIDTH - shortBar)}`) +
      `  ${shortOI.toFixed(2)} lots`
    );
  }
}

// ============ Price Scale Diagram ============

/**
 * Print a price scale diagram showing entry, mark, and estimated liquidation
 */
function printPriceScale(
  perpInfo: PerpetualInfo,
  postPosition: AccountSnapshot["position"],
  priceDecimals: bigint,
  leverage: number,
): void {
  if (!postPosition || postPosition.lotLNS === 0n) return;

  const entry = pnsToPrice(postPosition.pricePNS, priceDecimals);
  const mark = pnsToPrice(perpInfo.markPNS, priceDecimals);
  const isLong = postPosition.positionType === 0;

  // Estimate liquidation price
  const liq = isLong
    ? entry * (1 - 1 / leverage)
    : entry * (1 + 1 / leverage);

  if (liq <= 0 || leverage <= 1) return;

  // Build labeled points sorted by price
  type Point = { label: string; price: number };
  const points: Point[] = [
    { label: "LIQ", price: liq },
    { label: "ENTRY", price: entry },
    { label: "MARK", price: mark },
  ].sort((a, b) => a.price - b.price);

  const pMin = points[0].price;
  const pMax = points[points.length - 1].price;
  const range = pMax - pMin || 1;

  // Calculate positions on the scale (0 to SCALE_WIDTH)
  const positions = points.map((p) => ({
    ...p,
    pos: Math.round(((p.price - pMin) / range) * SCALE_WIDTH),
  }));

  // Enforce minimum spacing to prevent label overlap
  for (let i = 1; i < positions.length; i++) {
    const prevLabelLen = positions[i - 1].label.length + 1; // +1 for gap
    const minSpacing = Math.max(4, prevLabelLen);
    if (positions[i].pos - positions[i - 1].pos < minSpacing) {
      positions[i].pos = positions[i - 1].pos + minSpacing;
    }
  }
  // Clamp max
  if (positions[positions.length - 1].pos > SCALE_WIDTH) {
    positions[positions.length - 1].pos = SCALE_WIDTH;
  }

  // Ensure enough buffer space for labels/prices at the rightmost position
  const bufLen = SCALE_WIDTH + 20; // extra room for labels at the right edge

  // Build label line
  let labelLine = " ".repeat(bufLen);
  const labelArr = labelLine.split("");
  for (const pt of positions) {
    const offset = 4 + pt.pos; // 4 = indent
    for (let i = 0; i < pt.label.length && offset + i < labelArr.length; i++) {
      labelArr[offset + i] = pt.label[i];
    }
  }
  labelLine = labelArr.join("").trimEnd();

  // Build scale line
  let scaleLine = "    " + "─".repeat(SCALE_WIDTH + 1);
  const scaleArr = scaleLine.split("");
  scaleArr[4] = "├";
  scaleArr[4 + SCALE_WIDTH] = "┤";
  for (const pt of positions) {
    const idx = 4 + pt.pos;
    if (idx > 4 && idx < 4 + SCALE_WIDTH) {
      scaleArr[idx] = "┼";
    }
  }
  scaleLine = scaleArr.join("");

  // Build price line
  let priceLine = " ".repeat(bufLen);
  const priceArr = priceLine.split("");
  for (const pt of positions) {
    const priceStr = formatPrice(pt.price);
    const offset = 4 + pt.pos;
    for (let i = 0; i < priceStr.length && offset + i < priceArr.length; i++) {
      priceArr[offset + i] = priceStr[i];
    }
  }
  priceLine = priceArr.join("").trimEnd();

  console.log();
  console.log(header("Price Scale:"));
  console.log(labelLine);
  console.log(scaleLine);
  console.log(dim(priceLine));

  // Distance to liquidation
  const distToLiq = Math.abs(entry - liq);
  const distPct = ((distToLiq / entry) * 100).toFixed(1);
  const direction = isLong ? "below" : "above";
  console.log(
    dim(`  Distance to liq: ${formatPrice(distToLiq)} (${distPct}%) ${direction} entry`)
  );
}

// ============ Main Report ============

/**
 * Print the dry-run report to console
 */
export function printDryRunReport(
  result: DryRunResult,
  orderDesc: OrderDesc,
  perpName: string,
  priceDecimals: bigint,
  lotDecimals: bigint,
): void {
  const price = pnsToPrice(orderDesc.pricePNS, priceDecimals);
  const size = lnsToLot(orderDesc.lotLNS, lotDecimals);
  const leverage = hdthsToLeverage(orderDesc.leverageHdths);
  const isIOC = orderDesc.immediateOrCancel;

  console.log();
  console.log(warn("DRY RUN") + dim(" - No real transaction will be sent"));
  console.log(dim(SEPARATOR));

  // Order details
  console.log();
  console.log(header("Order:"));
  console.log(`  Market:    ${perpName}-PERP ${dim(`(perpId: ${orderDesc.perpId})`)}`);

  const otName = orderTypeName(orderDesc.orderType);
  const isLongOrder = orderDesc.orderType === OrderType.OpenLong || orderDesc.orderType === OrderType.CloseLong;
  const otColored = isLongOrder ? long(otName) : short(otName);
  console.log(`  Type:      ${otColored}`);
  console.log(`  Size:      ${size.toFixed(5)} lots`);
  console.log(`  Price:     ${formatPrice(price)}`);
  console.log(`  Leverage:  ${leverage}x`);
  if (isIOC) console.log(`  Execution: ${dim("IOC (market order)")}`);
  if (orderDesc.postOnly) console.log(`  Execution: ${dim("Post-only")}`);
  if (orderDesc.fillOrKill) console.log(`  Execution: ${dim("Fill-or-kill")}`);

  // Simulation result
  console.log();
  console.log(dim(THIN_SEP));
  const sim = result.simulate;

  if (sim.success) {
    console.log(`Simulation:  ${success("SUCCESS")}`);
    console.log(`  Order ID:  ${sim.orderId}`);
    if (sim.gasEstimate > 0n) {
      console.log(`  Gas Est:   ${dim(sim.gasEstimate.toLocaleString())}`);
    }
  } else {
    console.log(`Simulation:  ${fail("FAILED")}`);
    console.log(`  Reason:    ${fail(String(sim.revertReason))}`);
    console.log();
    console.log(dim(SEPARATOR));
    console.log(fail("This trade would revert if sent on-chain."));
    return;
  }

  // Fork results (if available)
  if (result.fork) {
    const f = result.fork;
    console.log();
    console.log(dim(THIN_SEP));
    console.log(header("Fork Simulation (Anvil):"));

    // Gas
    console.log();
    console.log(header("Gas:"));
    console.log(`  Gas Used:   ${f.gasUsed.toLocaleString()}`);
    if (f.gasPrice > 0n) {
      console.log(`  Gas Price:  ${dim(formatEther(f.gasPrice) + " MON/gas")}`);
    }
    console.log(`  Gas Cost:   ${dim(formatEther(f.gasCostWei) + " MON")}`);

    // Account changes
    console.log();
    console.log(header("Account Changes:"));
    printAccountDiff(f.preState, f.postState);

    // Balance bar chart
    console.log(balanceBar(f.preState.balanceCNS, f.postState.balanceCNS));

    // Position changes
    console.log();
    console.log(header("Position Changes:"));
    printPositionDiff(f.preState, f.postState, priceDecimals, lotDecimals);

    // Mini orderbook
    if (f.perpInfo) {
      const fillPrice = f.postState.position?.pricePNS;
      printMiniOrderbook(f.perpInfo, priceDecimals, lotDecimals, fillPrice);

      // Price scale diagram
      printPriceScale(f.perpInfo, f.postState.position, priceDecimals, leverage);
    }

    // Events
    if (f.events.length > 0) {
      console.log();
      console.log(header("Events:"));
      for (const ev of f.events) {
        const argsStr = Object.entries(ev.args)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        console.log(dim(`  ${ev.eventName}(${argsStr})`));
      }
    }

    // ETH balance change
    const ethDiff = f.postState.ethBalance - f.preState.ethBalance;
    if (ethDiff !== 0n) {
      console.log();
      const ethDiffColor = ethDiff > 0n ? positive : negative;
      console.log(
        `MON Balance:  ${formatEther(f.preState.ethBalance)} -> ${formatEther(f.postState.ethBalance)} (${ethDiffColor(formatEther(ethDiff))})`
      );
    }
  } else {
    console.log();
    console.log(dim("(Anvil not available — showing eth_call results only)"));
    console.log(dim("Install Foundry for full state diff: https://getfoundry.sh"));
  }

  console.log();
  console.log(dim(SEPARATOR));
  console.log(dim("To execute this trade for real, run the same command without --dry-run"));
}

function printAccountDiff(pre: AccountSnapshot, post: AccountSnapshot): void {
  const balPre = formatCNS(pre.balanceCNS);
  const balPost = formatCNS(post.balanceCNS);
  const balDiffRaw = post.balanceCNS - pre.balanceCNS;
  const balDiff = formatSignedCNS(balDiffRaw);
  const balDiffColor = balDiffRaw >= 0n ? positive : negative;

  console.log(`  Balance:        ${balPre} -> ${balPost} AUSD (${balDiffColor(balDiff)})`);

  const lockedPre = formatCNS(pre.lockedBalanceCNS);
  const lockedPost = formatCNS(post.lockedBalanceCNS);
  const lockedDiffRaw = post.lockedBalanceCNS - pre.lockedBalanceCNS;
  const lockedDiff = formatSignedCNS(lockedDiffRaw);

  console.log(`  Locked Balance: ${lockedPre} -> ${lockedPost} AUSD (${dim(lockedDiff)})`);
}

function printPositionDiff(
  pre: AccountSnapshot,
  post: AccountSnapshot,
  priceDecimals: bigint,
  lotDecimals: bigint,
): void {
  // Before
  if (pre.position) {
    const side = colorSide(pre.position.positionType);
    const lots = lnsToLot(pre.position.lotLNS, lotDecimals);
    const entryPrice = pnsToPrice(pre.position.pricePNS, priceDecimals);
    const deposit = formatCNS(pre.position.depositCNS);
    console.log(`  Before: ${side} ${lots.toFixed(5)} lots @ ${formatPrice(entryPrice)} avg entry, margin: ${deposit} AUSD`);
  } else {
    console.log(`  Before: ${dim("No position")}`);
  }

  // After
  if (post.position) {
    const side = colorSide(post.position.positionType);
    const lots = lnsToLot(post.position.lotLNS, lotDecimals);
    const entryPrice = pnsToPrice(post.position.pricePNS, priceDecimals);
    const deposit = formatCNS(post.position.depositCNS);
    console.log(`  After:  ${side} ${lots.toFixed(5)} lots @ ${formatPrice(entryPrice)} avg entry, margin: ${deposit} AUSD`);
  } else {
    console.log(`  After:  ${dim("No position")}`);
  }
}
