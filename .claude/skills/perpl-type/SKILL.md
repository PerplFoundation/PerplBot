---
name: perpl-type
description: Natural language trading - describe your trade in plain English
model: haiku
allowed-tools: Bash(npm run dev:*), AskUserQuestion
argument-hint: <describe your trade in plain English>
---

# Perpl Natural Language Trading

Convert natural language trade descriptions into executable orders.

## Usage

```
/perpl-type <describe your trade>
```

## Execution Flow

1. Parse the user's natural language input from `$ARGUMENTS`
2. Extract trade parameters:
   - Action: open or close
   - Market: btc, eth, sol, mon, zec
   - Side: long or short
   - Size: amount to trade
   - Price: limit price (or "market" for IOC)
   - Leverage: multiplier (for opens only)
3. Build the CLI command
4. Use AskUserQuestion to confirm the trade with the user, showing:
   - The interpreted parameters
   - The exact command that will run
5. If confirmed, execute: `npm run dev -- trade <args>`
6. Summarize the result in 2 sentences

## Parameter Mapping

| Input phrases | Parameter |
|---------------|-----------|
| "buy", "long", "go long" | --side long |
| "sell", "short", "go short" | --side short |
| "btc", "bitcoin" | --perp btc |
| "eth", "ethereum" | --perp eth |
| "sol", "solana" | --perp sol |
| "mon", "monad" | --perp mon |
| "zec", "zcash" | --perp zec |
| "at market", "market order" | --ioc |
| "maker only", "post only" | --post-only |
| "close", "exit" | trade close |
| "open", "enter" | trade open |

## Examples

Input: "long 0.01 btc at 78000 with 5x leverage"
Command: `npm run dev -- trade open --perp btc --side long --size 0.01 --price 78000 --leverage 5`

Input: "short 1 eth at market"
Command: `npm run dev -- trade open --perp eth --side short --size 1 --price <current_ask> --leverage 1 --ioc`

Input: "close my btc long 0.001 at 80000"
Command: `npm run dev -- trade close --perp btc --side long --size 0.001 --price 80000`

Input: "buy 10 sol at 105 10x"
Command: `npm run dev -- trade open --perp sol --side long --size 10 --price 105 --leverage 10`

## Confirmation Format

Before executing, ask user to confirm with AskUserQuestion:

```
Trade: OPEN LONG 0.01 BTC @ $78,000 (5x leverage)
Command: npm run dev -- trade open --perp btc --side long --size 0.01 --price 78000 --leverage 5
```

Options: "Execute trade" or "Cancel"

## Response Format

After execution, summarize in 2 sentences maximum.

## Parser Module

The parsing logic is implemented in `src/cli/tradeParser.ts` with full test coverage in `test/tradeParser.test.ts`. The module exports:
- `parseTrade(input: string)` - Parse natural language to trade object
- `buildCommand(trade: ParsedTrade)` - Build CLI command string
- `formatTrade(trade: ParsedTrade)` - Format trade for display
