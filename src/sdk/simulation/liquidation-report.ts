/**
 * Liquidation simulation report
 * Visual terminal output with price sweep, funding projection, and summary
 */

import chalk from "chalk";
import type { LiquidationSimResult, PricePoint } from "./liquidation.js";

// ============ Color helpers ============

const success = (s: string) => chalk.green.bold(s);
const fail = (s: string) => chalk.red.bold(s);
const warn = (s: string) => chalk.yellow(s);
const positive = (s: string) => chalk.green(s);
const negative = (s: string) => chalk.red(s);
const header = (s: string) => chalk.bold(s);
const dim = (s: string) => chalk.dim(s);

// ============ Constants ============

const SEPARATOR = "═".repeat(52);
const THIN_SEP = "─".repeat(52);
const BAR_WIDTH = 24;

// ============ Utilities ============

function fmtPrice(price: number): string {
  return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsd(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedUsd(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return sign + fmtUsd(value);
}

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return sign + pct.toFixed(2) + "%";
}

function fmtSize(size: number): string {
  return size.toFixed(5);
}

function colorPnl(value: number, formatted: string): string {
  return value >= 0 ? positive(formatted) : negative(formatted);
}

function equityBar(equity: number, maxEquity: number, isLiquidatable: boolean): string {
  if (maxEquity <= 0) return "";
  const ratio = Math.max(0, equity) / maxEquity;
  const filled = Math.round(ratio * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return isLiquidatable ? chalk.red(bar) : chalk.green(bar);
}

// ============ Report sections ============

function printHeader(r: LiquidationSimResult): void {
  console.log(header(`\n${SEPARATOR}`));
  console.log(header(`  LIQUIDATION SIMULATOR — ${r.perpName}-PERP`));
  console.log(header(SEPARATOR));
}

function printPosition(r: LiquidationSimResult): void {
  const sideStr = r.positionType === "long" ? chalk.green("LONG") : chalk.red("SHORT");

  console.log(`\n  ${header("Position")}`);
  console.log(`  ${THIN_SEP}`);
  console.log(`  Side:         ${sideStr}`);
  console.log(`  Size:         ${fmtSize(r.size)} ${r.perpName}`);
  console.log(`  Entry Price:  ${fmtPrice(r.entryPrice)}`);
  console.log(`  Collateral:   ${fmtUsd(r.collateral)} USDC`);
  console.log(`  Leverage:     ${r.currentLeverage.toFixed(2)}x`);
}

function printMarket(r: LiquidationSimResult): void {
  console.log(`\n  ${header("Current Market")}`);
  console.log(`  ${THIN_SEP}`);
  console.log(`  Mark Price:   ${fmtPrice(r.currentMarkPrice)}`);
  console.log(`  Oracle Price: ${fmtPrice(r.oraclePrice)}`);
  console.log(`  PnL:          ${colorPnl(r.currentPnl, fmtSignedUsd(r.currentPnl))}`);
  console.log(`  Equity:       ${fmtUsd(r.currentEquity)} USDC`);
  console.log(`  Margin Ratio: ${(r.currentMarginRatio * 100).toFixed(2)}%`);
}

function printLiquidation(r: LiquidationSimResult): void {
  const safe = r.currentMarginRatio > r.maintenanceMargin;
  const mmPct = (r.maintenanceMargin * 100).toFixed(1);
  const marginPct = (r.currentMarginRatio * 100).toFixed(2);

  console.log(`\n  ${header("Liquidation")}`);
  console.log(`  ${THIN_SEP}`);
  console.log(`  Liq Price:    ${fmtPrice(r.liquidationPrice)}`);

  const distSign = r.positionType === "long" ? "-" : "+";
  console.log(`  Distance:     ${distSign}${Math.abs(r.distancePct).toFixed(2)}% (${fmtPrice(Math.abs(r.distanceUsd))})`);

  if (safe) {
    console.log(`  Status:       ${success("SAFE")} ${dim(`(margin ${marginPct}% > ${mmPct}% MM)`)}`);
  } else {
    console.log(`  Status:       ${fail("AT RISK")} ${warn(`(margin ${marginPct}% < ${mmPct}% MM)`)}`);
  }
}

function printPriceSweep(r: LiquidationSimResult): void {
  console.log(`\n  ${header("Price Sweep")}`);
  console.log(`  ${THIN_SEP}`);

  // Select ~10 representative points from the sweep
  const points = selectDisplayPoints(r);
  const maxEquity = Math.max(...points.map(p => p.equity), 1);

  for (const pt of points) {
    const priceStr = fmtPrice(pt.price).padStart(12);
    const bar = equityBar(pt.equity, maxEquity, pt.isLiquidatable);
    const eqStr = (pt.equity > 0 ? fmtUsd(pt.equity) : negative(fmtUsd(pt.equity))).padStart(10);
    const marginStr = pt.marginRatio > 0
      ? `${(pt.marginRatio * 100).toFixed(1)}%`
      : "---";

    let label = "  ";
    if (pt.label === "current") label = dim(" ← NOW");
    else if (pt.label === "liquidation") label = warn(" ← LIQ");

    console.log(`  ${priceStr}  ${bar}  ${eqStr}  ${marginStr.padStart(6)}${label}`);
  }
}

interface DisplayPoint extends PricePoint {
  label?: "current" | "liquidation";
}

function selectDisplayPoints(r: LiquidationSimResult): DisplayPoint[] {
  const all = r.pricePoints;
  if (all.length === 0) return [];

  // Always include: endpoints, current price neighborhood, liq price neighborhood
  const targets: { price: number; label?: "current" | "liquidation" }[] = [];

  // Endpoints
  targets.push({ price: all[0].price });
  targets.push({ price: all[all.length - 1].price });

  // Current mark price
  targets.push({ price: r.currentMarkPrice, label: "current" });

  // Liquidation price (if within range)
  const lowBound = all[0].price;
  const highBound = all[all.length - 1].price;
  if (r.liquidationPrice >= lowBound && r.liquidationPrice <= highBound) {
    targets.push({ price: r.liquidationPrice, label: "liquidation" });
  }

  // Fill in evenly spaced points
  const totalDisplay = 10;
  const step = (highBound - lowBound) / (totalDisplay - 1);
  for (let i = 1; i < totalDisplay - 1; i++) {
    targets.push({ price: lowBound + step * i });
  }

  // Deduplicate by finding closest sweep point for each target
  const used = new Set<number>();
  const result: DisplayPoint[] = [];

  // Sort targets by priority: labeled ones first, then by price
  const sorted = [...targets].sort((a, b) => {
    if (a.label && !b.label) return -1;
    if (!a.label && b.label) return 1;
    return a.price - b.price;
  });

  for (const target of sorted) {
    // Find closest sweep point
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < all.length; i++) {
      const dist = Math.abs(all[i].price - target.price);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (!used.has(bestIdx)) {
      used.add(bestIdx);
      result.push({ ...all[bestIdx], label: target.label });
    }
  }

  // Sort by price descending (high to low)
  result.sort((a, b) => b.price - a.price);
  return result;
}

function printFunding(r: LiquidationSimResult): void {
  if (r.fundingProjections.length === 0) {
    console.log(`\n  ${header("Funding")}`);
    console.log(`  ${THIN_SEP}`);
    console.log(`  ${dim("No funding accrual (rate is zero)")}`);
    return;
  }

  const direction = r.fundingPerHour > 0 ? "you pay" : "you receive";
  const rateStr = (Math.abs(r.fundingRate) * 100).toFixed(4);

  console.log(`\n  ${header(`Funding Projection (rate: ${r.fundingRate >= 0 ? "+" : "-"}${rateStr}%/8h, ${direction})`)}`);
  console.log(`  ${THIN_SEP}`);

  const baseLiqPrice = r.liquidationPrice;
  for (const fp of r.fundingProjections) {
    const hoursStr = `${fp.hours.toFixed(0)}h`.padStart(4);
    const costStr = fmtSignedUsd(-fp.fundingAccrued);
    const liqDelta = fp.adjustedLiqPrice - baseLiqPrice;
    const liqDeltaStr = liqDelta >= 0 ? `+${fmtPrice(liqDelta)}` : `-${fmtPrice(Math.abs(liqDelta))}`;
    const costColor = fp.fundingAccrued > 0 ? negative(costStr) : positive(costStr);
    console.log(`  ${hoursStr}:  ${costColor.padEnd(20)}  liq ${fmtPrice(fp.adjustedLiqPrice)} (${liqDeltaStr})`);
  }
}

function printSummary(r: LiquidationSimResult): void {
  console.log(`\n${header(SEPARATOR)}`);

  const dropOrRise = r.positionType === "long" ? "drop" : "rise";
  const distStr = Math.abs(r.distancePct).toFixed(2);

  if (r.currentMarginRatio > r.maintenanceMargin) {
    console.log(`  Position survives a ${distStr}% ${dropOrRise}.`);
  } else {
    console.log(fail(`  Position is at liquidation risk!`));
  }

  if (r.fundingProjections.length > 0) {
    const last = r.fundingProjections[r.fundingProjections.length - 1];
    const dailyShift = Math.abs(last.adjustedLiqPrice - r.liquidationPrice);
    const hours = last.hours;
    const perDay = hours > 0 ? dailyShift * (24 / hours) : 0;
    if (perDay > 0.01) {
      console.log(`  Funding shifts liq price by ~${fmtPrice(perDay)}/day at current rate.`);
    }
  }

  console.log(header(SEPARATOR) + "\n");
}

// ============ Main export ============

export function printLiquidationReport(result: LiquidationSimResult): void {
  printHeader(result);
  printPosition(result);
  printMarket(result);
  printLiquidation(result);
  printPriceSweep(result);
  printFunding(result);
  printSummary(result);
}
