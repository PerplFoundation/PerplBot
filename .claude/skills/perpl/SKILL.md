---
name: perpl
description: Trade on Perpl DEX - view markets, manage positions, execute trades
disable-model-invocation: true
allowed-tools: Bash(npm run dev:*)
argument-hint: <command> [options]
---

# Perpl Trading Skill

Execute trading operations on Perpl DEX (perpetual futures on Monad).

## Commands

### View Markets
Show all markets with prices and funding rates:
```bash
npm run dev -- manage markets
```

### Account Status
Show account balance, positions, and P&L:
```bash
npm run dev -- manage status
```

### Open Position
Open a new long or short position:
```bash
npm run dev -- trade open --perp <market> --side <long|short> --size <amount> --price <price> --leverage <multiplier>
```
Add `--ioc` for market order, `--post-only` for maker only.

### Close Position
Close an existing position:
```bash
npm run dev -- trade close --perp <market> --side <long|short> --size <amount> --price <price>
```

### Cancel Order
Cancel a specific order:
```bash
npm run dev -- trade cancel --perp <market> --order-id <id>
```

### Cancel All Orders
Cancel all open orders on a market:
```bash
npm run dev -- trade cancel-all --perp <market>
```

### Deposit Collateral
Deposit USD to trading account:
```bash
npm run dev -- manage deposit --amount <amount>
```

### Withdraw Collateral
Withdraw USD from trading account:
```bash
npm run dev -- manage withdraw --amount <amount>
```

## Markets
- btc (ID: 16)
- eth (ID: 32)
- sol (ID: 48)
- mon (ID: 64)
- zec (ID: 256)

## Argument Parsing

Parse $ARGUMENTS and execute the appropriate command:

- `markets` → `npm run dev -- manage markets`
- `status` → `npm run dev -- manage status`
- `open <market> <side> <size> <price> [leverage]` → trade open
- `close <market> <side> <size> <price>` → trade close
- `cancel <market> <order-id>` → trade cancel
- `cancel-all <market>` → trade cancel-all
- `deposit <amount>` → manage deposit
- `withdraw <amount>` → manage withdraw
