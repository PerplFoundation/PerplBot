---
name: perpl
description: Trade on Perpl DEX - view markets, manage positions, execute trades
model: haiku
allowed-tools: Bash(npm run dev:*)
argument-hint: <command> [args...]
---

# Perpl Trading Skill

Execute PerplBot CLI commands directly.

## Usage

Pass CLI arguments directly after `/perpl`:

```
/perpl <command> [subcommand] [options]
```

## Execution

If `$ARGUMENTS` is `help`, display the command list below instead of running CLI.

Otherwise, run the following command with $ARGUMENTS passed through:

```bash
npm run dev -- $ARGUMENTS
```

## Available Commands (display this for `/perpl help`)

```
manage markets              - Show prices and funding rates
manage status               - Show account balance and positions
manage deposit --amount N   - Deposit USD collateral
manage withdraw --amount N  - Withdraw USD collateral

trade open --perp <market> --side <long|short> --size N --price N --leverage N
trade close --perp <market> --side <long|short> --size N --price N
trade cancel --perp <market> --order-id <id>
trade cancel-all --perp <market>

show book --perp <market>   - Show order book
show trades --perp <market> - Show recent trades
show liquidation --perp <market>        - Liquidation price simulator
show liquidation --perp <market> --fork - Fork-verified liquidation (Anvil)

debug <txhash>             - Replay & decode transaction (Anvil)

simulate strategy --strategy grid --perp <market> --levels 5 --spacing 100 --size 0.001 --leverage 2
simulate strategy --strategy mm --perp <market> --size 0.001 --spread 0.1 --leverage 2

Options: --ioc (market order), --post-only (maker only), --dry-run (simulate)
Markets: btc, eth, sol, mon, zec

Natural Language: Use /perpl-type for plain English commands
  Examples: /perpl-type show me my account
            /perpl-type long 0.01 btc at 78000 5x
            /perpl-type cancel all eth orders
```

## Command Details

### manage
- `manage markets` - Show prices and funding rates
- `manage status` - Show account balance and positions
- `manage deposit --amount <amount>` - Deposit USD collateral
- `manage withdraw --amount <amount>` - Withdraw USD collateral

### trade
- `trade open --perp <market> --side <long|short> --size <amount> --price <price> --leverage <multiplier>` - Open position
- `trade close --perp <market> --side <long|short> --size <amount> --price <price>` - Close position
- `trade cancel --perp <market> --order-id <id>` - Cancel order
- `trade cancel-all --perp <market>` - Cancel all orders

### show
- `show book --perp <market>` - Show order book for a market
- `show trades --perp <market>` - Show recent trades for a market
- `show liquidation --perp <market>` - Liquidation price simulator (pure math)
- `show liquidation --perp <market> --fork` - Fork-verified liquidation (requires Anvil)
- `show liquidation --perp <market> --range <pct>` - Custom sweep range (default 30%)

### debug (requires Anvil)
- `debug <txhash>` - Replay transaction on fork, decode events, explain what happened
- `debug <txhash> --json` - Output raw JSON result

### simulate (requires Anvil)
- `simulate strategy --strategy grid --perp <market> --levels N --spacing N --size N --leverage N`
- `simulate strategy --strategy mm --perp <market> --size N --spread N --leverage N`
- `simulate strategy --strategy grid --perp <market> --spacing N --size N --json`

### Options
- `--ioc` - Immediate-or-cancel (market order)
- `--post-only` - Maker only
- `--dry-run` - Simulate trade on Anvil fork (no real transaction)

## Markets
- btc, eth, sol, mon, zec

## Examples

```
/perpl manage status
/perpl manage markets
/perpl trade open --perp btc --side long --size 0.001 --price 75000 --leverage 2
/perpl trade close --perp btc --side long --size 0.001 --price 80000
/perpl trade cancel-all --perp btc
/perpl show book --perp btc
/perpl show trades --perp eth --limit 10
/perpl show liquidation --perp btc
/perpl show liquidation --perp btc --fork --range 50
/perpl debug 0x1234...abcd
/perpl simulate strategy --strategy grid --perp btc --levels 5 --spacing 100 --size 0.001 --leverage 2
```
