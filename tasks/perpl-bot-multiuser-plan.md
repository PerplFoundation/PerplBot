# Feature: Multi-User Telegram Bot with Wallet Authentication

## Summary
Transform the single-user PerplBot into a multi-user bot where each Telegram user can link their own wallet and trade independently.

## Context
- Why is this needed?
  - Current bot is hardcoded to one Telegram user and one wallet
  - Other users cannot use the bot
  - No way for users to connect their own wallets
  - Bot operator holds all private keys (security risk)

- What problem does it solve?
  - Enables anyone to use the trading bot
  - Users control their own wallets (self-custody)
  - Decentralizes trust - bot never holds withdrawal keys
  - Scalable to many users

## Current State

```
Single User Model:
┌─────────────────────────────────────────┐
│ Environment Variables                    │
│ ├─ TELEGRAM_USER_ID (hardcoded)        │
│ ├─ OWNER_PRIVATE_KEY (shared)          │
│ └─ Bot uses owner wallet for all ops   │
└─────────────────────────────────────────┘
```

## Target State

```
Multi-User Model:
┌─────────────────────────────────────────┐
│ User Database                            │
│ ├─ telegram_id → wallet_address         │
│ ├─ wallet_address → delegated_account   │
│ └─ delegated_account → operator_key     │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Bot Operator (Hot Wallet)               │
│ ├─ Single operator key for bot          │
│ ├─ Added as operator to user accounts   │
│ └─ Can trade but CANNOT withdraw        │
└─────────────────────────────────────────┘
```

## Security Model

### The Delegated Account Pattern

```
User's Cold Wallet (Owner)
    │
    ├─ Deploys DelegatedAccount contract
    │
    ├─ Adds Bot's Operator Wallet as operator
    │   └─ Operator can: trade, cancel, modify orders
    │   └─ Operator CANNOT: withdraw funds
    │
    └─ User deposits collateral
        └─ Only owner can withdraw

Bot's Hot Wallet (Operator)
    │
    ├─ Single key managed by bot
    │
    ├─ Authorized on multiple user accounts
    │
    └─ If compromised: can't steal funds (only trade)
```

### Why This is Secure

1. **User keeps control**: Only user's owner wallet can withdraw
2. **Bot can't steal**: Operator wallet has no withdrawal permission
3. **Limited blast radius**: Compromised bot can only make bad trades, not drain accounts
4. **On-chain enforcement**: Smart contract enforces permissions, not trust

## Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Telegram Bot                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  /start → Registration Flow                                 │
│  /link <address> → Link wallet (verify signature)           │
│  /status → Show linked wallet status                        │
│  /trade → Trade on user's DelegatedAccount                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    User Database                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  users:                                                      │
│    telegram_id: number (primary key)                        │
│    wallet_address: string (user's owner wallet)             │
│    delegated_account: string (trading account)              │
│    linked_at: timestamp                                      │
│    is_active: boolean                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Bot Operator Wallet                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Single OPERATOR_PRIVATE_KEY                                │
│  ├─ Used to execute trades on behalf of users              │
│  ├─ Must be added as operator on each user's account       │
│  └─ Stored securely (env var or vault)                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Phase 1: Database Setup

**New File:** `src/bot/db/schema.ts`

```typescript
interface User {
  telegramId: number;           // Telegram user ID (primary key)
  walletAddress: string;        // User's owner wallet address
  delegatedAccount?: string;    // DelegatedAccount contract address
  linkedAt: Date;
  isActive: boolean;
}

interface LinkRequest {
  telegramId: number;
  nonce: string;                // Random nonce for signature verification
  walletAddress: string;
  expiresAt: Date;
}
```

**Storage Options:**

| Option | Pros | Cons |
|--------|------|------|
| SQLite | Simple, file-based, no server | Single instance only |
| PostgreSQL | Scalable, robust | Requires server |
| Redis | Fast, good for sessions | Data persistence concerns |
| JSON file | Simplest | Not concurrent-safe |

**Recommendation:** Start with SQLite (simple), migrate to PostgreSQL later if needed.

**New File:** `src/bot/db/index.ts`

```typescript
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DATABASE_PATH || './data/perplbot.db';

// Ensure directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    delegated_account TEXT,
    linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    is_banned BOOLEAN DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS link_requests (
    telegram_id INTEGER PRIMARY KEY,
    nonce TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    expires_at DATETIME NOT NULL
  );
`);

export function getUser(telegramId: number): User | null { ... }
export function createUser(user: User): void { ... }
export function updateUser(telegramId: number, updates: Partial<User>): void { ... }
export function createLinkRequest(request: LinkRequest): void { ... }
export function getLinkRequest(telegramId: number): LinkRequest | null { ... }

// Cleanup expired link requests (run on startup and periodically)
export function cleanupExpiredRequests(): number {
  const result = db.prepare(
    'DELETE FROM link_requests WHERE expires_at < datetime(?)'
  ).run(new Date().toISOString());
  return result.changes;
}
```

### Phase 2: Wallet Linking Flow

**User Journey:**

```
1. User: /link 0xMyWalletAddress

2. Bot: "To link wallet 0xMyWallet..., sign this message:
         'Link Telegram user 123456789 to PerplBot
          Nonce: abc123def456
          Timestamp: 2024-02-04T12:00:00Z'

         Reply with /verify <signature>"

3. User signs message in their wallet (MetaMask, etc.)

4. User: /verify 0x1234...signature...

5. Bot verifies signature matches wallet address

6. Bot: "Wallet linked! Now deploy a DelegatedAccount:
         1. Go to https://perpl.xyz/account
         2. Deploy DelegatedAccount with your wallet
         3. Add bot operator: 0xBotOperatorAddress
         4. Reply with /setaccount <delegated_account_address>"

7. User: /setaccount 0xMyDelegatedAccount

8. Bot verifies bot is operator on that account

9. Bot: "Setup complete! You can now trade with /trade"
```

**New File:** `src/bot/types.ts`

```typescript
import { Context as TelegrafContext } from 'telegraf';
import type { User } from './db/schema';

export interface BotContext extends TelegrafContext {
  user?: User;
}
```

**New File:** `src/bot/crypto.ts`

```typescript
import { randomBytes } from 'crypto';
import { verifyMessage } from 'viem';

export function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

export async function recoverAddress(message: string, signature: `0x${string}`): Promise<string> {
  const address = await verifyMessage({ message, signature });
  return address.toLowerCase();
}

export function formatLinkMessage(telegramId: number, nonce: string): string {
  return [
    'Link wallet to PerplBot',
    '',
    `Telegram ID: ${telegramId}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${new Date().toISOString()}`,
    '',
    'This signature proves you own this wallet.',
    'It does not authorize any transactions.',
  ].join('\n');
}
```

**New Handler:** `src/bot/handlers/link.ts`

```typescript
import type { BotContext } from '../types';
import { generateNonce, formatLinkMessage, recoverAddress } from '../crypto';
import * as db from '../db';

export async function handleLink(ctx: BotContext) {
  const walletAddress = ctx.message.text.split(' ')[1];
  if (!isValidAddress(walletAddress)) {
    return ctx.reply('Invalid wallet address');
  }

  const nonce = generateNonce();
  const message = formatLinkMessage(ctx.from.id, nonce);

  const LINK_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

  await db.createLinkRequest({
    telegramId: ctx.from.id,
    nonce,
    walletAddress,
    expiresAt: new Date(Date.now() + LINK_EXPIRY_MS),
  });

  await ctx.reply(
    `To link wallet \`${walletAddress}\`, sign this message:\n\n` +
    `\`\`\`\n${message}\n\`\`\`\n\n` +
    `Then reply with: /verify <signature>`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleVerify(ctx: Context) {
  const signature = ctx.message.text.split(' ')[1];
  const request = await db.getLinkRequest(ctx.from.id);

  if (!request || request.expiresAt < new Date()) {
    return ctx.reply('No pending link request. Use /link first.');
  }

  const message = formatLinkMessage(ctx.from.id, request.nonce);
  const recoveredAddress = recoverAddress(message, signature);

  if (recoveredAddress.toLowerCase() !== request.walletAddress.toLowerCase()) {
    return ctx.reply('Signature verification failed. Try again.');
  }

  await db.createUser({
    telegramId: ctx.from.id,
    walletAddress: request.walletAddress,
    linkedAt: new Date(),
    isActive: true,
  });

  await ctx.reply(
    `Wallet linked successfully!\n\n` +
    `Next steps:\n` +
    `1. Deploy a DelegatedAccount at https://perpl.xyz\n` +
    `2. Add bot operator: \`${BOT_OPERATOR_ADDRESS}\`\n` +
    `3. Run: /setaccount <your_delegated_account_address>`
  );
}
```

### Phase 3: Update Middleware

**File:** `src/bot/config.ts`

Remove single-user restriction:

```typescript
// OLD
export function authMiddleware(allowedUserId: number) {
  return async (ctx, next) => {
    if (ctx.from?.id !== allowedUserId) {
      return ctx.reply('Unauthorized');
    }
    return next();
  };
}

// NEW
export function authMiddleware() {
  return async (ctx, next) => {
    // Allow anyone to use /start and /link
    const openCommands = ['/start', '/link', '/help'];
    if (openCommands.some(cmd => ctx.message?.text?.startsWith(cmd))) {
      return next();
    }

    // For other commands, require linked wallet
    const user = await db.getUser(ctx.from?.id);
    if (!user || !user.isActive) {
      return ctx.reply(
        'Please link your wallet first.\n' +
        'Use: /link <your_wallet_address>'
      );
    }

    // Attach user to context for handlers
    ctx.user = user;
    return next();
  };
}
```

### Phase 4: Update Handlers

**File:** `src/bot/handlers/status.ts`

```typescript
export async function handleStatus(ctx: Context) {
  const user = ctx.user; // From middleware

  if (!user.delegatedAccount) {
    return ctx.reply('Please set your DelegatedAccount first. Use /setaccount');
  }

  // Use bot's operator wallet to query user's account
  const exchange = await createExchangeForUser(user);
  const accountId = await exchange.getAccountByAddress(user.delegatedAccount);
  const positions = await exchange.getPositions(accountId);

  // Format and return
  await ctx.reply(formatStatus(positions));
}
```

**File:** `src/bot/handlers/trade.ts`

```typescript
import type { BotContext } from '../types';

export async function executeTrade(ctx: BotContext, trade: ParsedTrade) {
  const user = ctx.user!;

  if (!user.delegatedAccount) {
    return ctx.reply('Please set your DelegatedAccount first.');
  }

  try {
    // Verify bot is still operator on user's account
    const isOperator = await verifyOperatorStatus(user.delegatedAccount);
    if (!isOperator) {
      return ctx.reply(
        'Bot is no longer authorized on your account.\n' +
        `Please add operator: ${BOT_OPERATOR_ADDRESS}`
      );
    }

    // Execute trade using bot's operator wallet on user's DelegatedAccount
    const exchange = await createExchangeForUser(user);
    const result = await exchange.execOrder(orderDesc);

    await ctx.reply(`Trade executed! TX: ${result.hash}`);
  } catch (error) {
    console.error(`[TRADE] Failed for user ${user.telegramId}:`, error);
    await ctx.reply(
      'Trade failed. Please try again.\n' +
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
```

**New Helper:** `src/bot/client.ts`

```typescript
export async function createExchangeForUser(user: User): Promise<Exchange> {
  // Bot's operator wallet
  const operatorWallet = OperatorWallet.fromPrivateKey(
    config.operatorPrivateKey,
    config.chain
  );

  // Connect to user's DelegatedAccount
  operatorWallet.connect(
    config.chain.exchangeAddress,
    user.delegatedAccount as Address
  );

  return new Exchange(
    config.chain.exchangeAddress,
    operatorWallet.publicClient,
    operatorWallet.walletClient,
    user.delegatedAccount as Address,
    apiClient
  );
}
```

### Phase 5: Bot Operator Setup

**Environment Variables:**

```bash
# Bot's operator wallet (NOT owner - cannot withdraw)
BOT_OPERATOR_PRIVATE_KEY=0x...

# Derived from private key (shown to users)
BOT_OPERATOR_ADDRESS=0x...

# Database
DATABASE_PATH=./data/perplbot.db

# Remove single-user restriction
# TELEGRAM_USER_ID=... (no longer needed)
```

**Operator Wallet Security:**

1. Generate dedicated operator key (never use as owner anywhere)
2. Store in secure environment (not in repo)
3. Key can trade but never withdraw
4. If compromised: users' funds are safe, revoke operator access

## New Commands

| Command | Description | Auth Required |
|---------|-------------|---------------|
| `/start` | Welcome message, instructions | No |
| `/help` | Show all commands | No |
| `/link <address>` | Start wallet linking | No |
| `/verify <signature>` | Complete wallet linking | No |
| `/setaccount <address>` | Set DelegatedAccount | Linked wallet |
| `/whoami` | Show linked wallet and account status | Linked wallet |
| `/unlink` | Unlink wallet | Linked wallet |
| `/status` | Show positions | Linked + Account |
| `/trade` | Execute trade | Linked + Account |
| `/cancel` | Cancel orders | Linked + Account |
| `/close` | Close positions | Linked + Account |
| `/markets` | Show market data | Linked + Account |

## Files to Create

| File | Purpose |
|------|---------|
| `src/bot/types.ts` | Extended Telegraf context with user |
| `src/bot/crypto.ts` | Nonce generation, signature verification |
| `src/bot/db/index.ts` | Database operations |
| `src/bot/db/schema.ts` | Type definitions |
| `src/bot/handlers/link.ts` | Wallet linking flow |
| `src/bot/handlers/account.ts` | DelegatedAccount setup |
| `src/bot/middleware/auth.ts` | Updated auth middleware |

## Files to Modify

| File | Change |
|------|--------|
| `src/bot/index.ts` | Register new commands, update middleware |
| `src/bot/config.ts` | Remove single-user config |
| `src/bot/client.ts` | Add `createExchangeForUser()` |
| `src/bot/handlers/status.ts` | Use user's account |
| `src/bot/handlers/trade.ts` | Use user's account |
| `src/bot/handlers/cancel.ts` | Use user's account |
| `src/bot/handlers/close.ts` | Use user's account |
| `src/sdk/config.ts` | Add BOT_OPERATOR_PRIVATE_KEY |

## Security Considerations

### What the Bot CAN Do
- Execute trades on user's DelegatedAccount
- Cancel orders
- Query positions and balances
- Modify orders

### What the Bot CANNOT Do
- Withdraw user funds (enforced by smart contract)
- Access user's owner private key
- Trade without user's DelegatedAccount setup
- Bypass on-chain permissions

### Attack Scenarios

| Attack | Mitigation |
|--------|------------|
| Bot key compromised | Attacker can only trade, not withdraw. Users revoke operator access. |
| Database compromised | Only Telegram IDs and public addresses exposed. No private keys stored. |
| Signature replay | Nonce + timestamp in signed message prevents replay. |
| Fake /verify | Signature must match claimed wallet address. |

## Design Decisions

### Rate Limiting
**Decision**: Implement per-user rate limiting.
- 10 trades per minute per user
- 60 API queries per minute per user
- Middleware tracks usage in memory (Redis if scaling)
- Rationale: Prevents abuse, protects API quota

### Maximum Users
**Decision**: No hard limit initially.
- Monitor database size and API usage
- Add waitlist if demand exceeds capacity
- Rationale: Start open, restrict if needed

### Fee Model
**Decision**: Defer to future phase.
- Initial launch is free
- Consider referral fees or premium tiers later
- Rationale: Focus on functionality first

### User Banning
**Decision**: Admin-only ban capability.
- Add `is_banned` column to users table
- Admin commands: `/admin ban <telegram_id>`, `/admin unban <telegram_id>`
- Banned users get "Account suspended" message
- Rationale: Needed for abuse prevention

### Notification Preferences
**Decision**: Defer to future phase.
- Default: notify on trade execution, errors
- Future: configurable via `/settings`
- Rationale: Keep initial scope manageable

## Success Criteria

1. **Wallet linking works**: New users can link wallets via signature verification
2. **Account setup works**: Users can set their DelegatedAccount address
3. **Operator verification**: Bot verifies operator status before every trade
4. **User isolation**: Each user trades only on their own account
5. **Security enforced**: Bot operator cannot withdraw from any account (contract-level)
6. **Backwards compatible**: Existing commands work with multi-user model
7. **Error handling**: Clear error messages for all failure modes

## Complexity
High - New database, auth flow, significant handler refactoring

## Migration Path

1. Deploy new bot instance with multi-user support
2. Keep old single-user bot running during transition
3. Migrate existing user (you) to new system
4. Deprecate old bot once stable
