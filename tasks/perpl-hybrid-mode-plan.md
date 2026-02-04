# Feature: Hybrid API/SDK Mode with Fallback

## Summary
Implement a hybrid mode where the API is used by default for reads, with automatic fallback to direct SDK/contract calls when the API is unavailable. Controlled via environment variable.

## Context
- Why is this needed?
  - API provides faster reads but may have downtime
  - SDK/contract calls are slower but always available (if RPC works)
  - Need resilience - trading bot can't stop working if API is down
  - Users should be able to force SDK-only mode for debugging

- What problem does it solve?
  - Single point of failure (API-only mode)
  - Provides graceful degradation
  - Enables A/B testing API vs SDK performance
  - Debugging capability when API behaves unexpectedly

## Environment Variables

```bash
# API mode control (default: true)
PERPL_USE_API=true|false

# When true (default):
#   - Try API first for reads
#   - Fall back to SDK on API error
#   - Writes always go through SDK (on-chain tx required)

# When false:
#   - Skip API entirely
#   - Use SDK/contract for all operations
#   - Useful for debugging or API outage
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Request                                │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  PERPL_USE_API=true?                        │
└─────────────────────────────────────────────────────────────┘
                    │              │
                   YES             NO
                    │              │
                    ▼              │
┌──────────────────────────┐       │
│     Try API Client       │       │
│  ┌────────────────────┐  │       │
│  │ - Authenticate     │  │       │
│  │ - Make REST call   │  │       │
│  │ - Parse response   │  │       │
│  └────────────────────┘  │       │
└──────────────────────────┘       │
           │                       │
      Success?                     │
       │    │                      │
      YES   NO                     │
       │    │                      │
       │    └──────────────────────┤
       │                           │
       ▼                           ▼
┌─────────────┐     ┌─────────────────────────────┐
│   Return    │     │   SDK/Contract Fallback     │
│   Result    │     │  ┌───────────────────────┐  │
└─────────────┘     │  │ - viem publicClient   │  │
                    │  │ - readContract()      │  │
                    │  │ - Direct RPC call     │  │
                    │  └───────────────────────┘  │
                    └─────────────────────────────┘
                                   │
                                   ▼
                           ┌─────────────┐
                           │   Return    │
                           │   Result    │
                           └─────────────┘
```

## Design

### Phase 1: Update Config

**File:** `src/sdk/config.ts`

```typescript
// Environment variable control
export const USE_API = process.env.PERPL_USE_API !== 'false';  // Default: true

// API configuration
export const API_CONFIG = {
  baseUrl: process.env.PERPL_API_URL || 'https://testnet.perpl.xyz/api',
  wsUrl: process.env.PERPL_WS_URL || 'wss://testnet.perpl.xyz',
  chainId: Number(process.env.PERPL_CHAIN_ID) || 10143,
};

// WebSocket paths (append to wsUrl)
export const WS_PATHS = {
  trading: '/ws/v1/trading',
  marketData: '/ws/v1/market-data',
};

// Fallback behavior
export const FALLBACK_CONFIG = {
  logWarnings: true,           // Log when falling back to SDK
  retryApiOnce: true,          // Retry API once before fallback
  apiTimeoutMs: 5000,          // API request timeout
};
```

### Phase 2: Create Hybrid Client Wrapper

**New File:** `src/sdk/api/hybrid.ts`

```typescript
import { PerplApiClient } from './client';
import { Exchange } from '../contracts/Exchange';
import { USE_API, FALLBACK_CONFIG } from '../config';
import type {
  PositionData,
  PerpetualInfo,
  Order,
  AccountInfo,
  OrderDesc,
  TxReceipt,
} from '../types';

export class HybridClient {
  private apiClient?: PerplApiClient;
  private exchange: Exchange;
  private useApi: boolean;

  constructor(options: {
    exchange: Exchange;
    apiClient?: PerplApiClient;
    useApi?: boolean;
  }) {
    this.exchange = options.exchange;
    this.apiClient = options.apiClient;
    this.useApi = options.useApi ?? USE_API;
  }

  async getPosition(perpId: bigint, accountId: bigint): Promise<PositionData | null> {
    if (this.useApi && this.apiClient) {
      try {
        return await this.tryApiGetPosition(perpId, accountId);
      } catch (error) {
        this.logFallback('getPosition', error);
      }
    }
    // Fallback to SDK
    return this.exchange.getPosition(perpId, accountId);
  }

  async getPerpetualInfo(perpId: bigint): Promise<PerpetualInfo> {
    if (this.useApi && this.apiClient) {
      try {
        return await this.tryApiGetPerpetualInfo(perpId);
      } catch (error) {
        this.logFallback('getPerpetualInfo', error);
      }
    }
    return this.exchange.getPerpetualInfo(perpId);
  }

  async getOpenOrders(perpId: bigint, accountId: bigint): Promise<Order[]> {
    if (this.useApi && this.apiClient) {
      try {
        return await this.tryApiGetOpenOrders(perpId, accountId);
      } catch (error) {
        this.logFallback('getOpenOrders', error);
      }
    }
    return this.exchange.getOpenOrders(perpId, accountId);
  }

  async getAccountByAddress(address: string): Promise<AccountInfo> {
    if (this.useApi && this.apiClient) {
      try {
        return await this.tryApiGetAccount(address);
      } catch (error) {
        this.logFallback('getAccountByAddress', error);
      }
    }
    return this.exchange.getAccountByAddress(address);
  }

  // Writes always go through SDK (require on-chain tx)
  async execOrder(orderDesc: OrderDesc): Promise<TxReceipt> {
    return this.exchange.execOrder(orderDesc);
  }

  private logFallback(method: string, error: unknown) {
    if (FALLBACK_CONFIG.logWarnings) {
      console.warn(`[HybridClient] API ${method} failed, using SDK fallback:`,
        error instanceof Error ? error.message : error);
    }
  }

  // API method implementations with timeout
  private async tryApiGetPosition(perpId: bigint, accountId: bigint) {
    const positions = await this.withTimeout(
      this.apiClient!.getPositions(accountId)
    );
    const pos = positions.find(p => BigInt(p.mkt) === perpId);
    // No position is a valid state - return null, don't throw
    return pos ? this.mapApiPosition(pos) : null;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('API timeout')), FALLBACK_CONFIG.apiTimeoutMs);
    });
    return Promise.race([promise, timeout]);
  }
}
```

### Phase 3: Update CLI Commands

**File:** `src/cli/trade.ts`

```typescript
import { HybridClient } from '../sdk/api/hybrid';
import { USE_API, API_CONFIG } from '../sdk/config';

async function executeTradeCommand(options: TradeOptions) {
  const owner = await loadOwnerWallet();

  // Initialize API client if enabled
  let apiClient: PerplApiClient | undefined;
  if (USE_API) {
    apiClient = new PerplApiClient(API_CONFIG);
    try {
      await apiClient.authenticate(
        owner.account.address,
        (msg) => owner.account.signMessage({ message: msg })
      );
    } catch (error) {
      console.warn('API authentication failed, will use SDK only:', error.message);
      apiClient = undefined;
    }
  }

  const exchange = new Exchange(/* ... */);

  // Use hybrid client for reads
  const client = new HybridClient({
    exchange,
    apiClient,
    useApi: USE_API && !!apiClient,
  });

  // Pre-trade checks use hybrid (API with SDK fallback)
  const position = await client.getPosition(perpId, accountId);
  const marketInfo = await client.getPerpetualInfo(perpId);

  // Execution always uses SDK (on-chain)
  const result = await client.execOrder(orderDesc);
}
```

**File:** `src/cli/manage.ts`

Same pattern - use HybridClient for reads.

### Phase 4: Update Bot Handlers

**File:** `src/bot/handlers/status.ts`

```typescript
import { HybridClient } from '../../sdk/api/hybrid';

export async function fetchAccountStatus(wallet: OwnerWallet): Promise<StatusData> {
  let apiClient: PerplApiClient | undefined;

  if (USE_API) {
    apiClient = new PerplApiClient(API_CONFIG);
    try {
      await apiClient.authenticate(
        wallet.account.address,
        (msg) => wallet.account.signMessage({ message: msg })
      );
    } catch {
      // Continue without API - will use SDK fallback
    }
  }

  const exchange = new Exchange(/* ... */);
  const client = new HybridClient({ exchange, apiClient });

  // These will try API first, fall back to SDK
  const positions = await Promise.all(
    perpIds.map(id => client.getPosition(id, accountId))
  );

  return formatStatus(positions);
}
```

**File:** `src/bot/handlers/trade.ts`

Same pattern.

**File:** `src/bot/handlers/markets.ts`

```typescript
export async function fetchMarketData(): Promise<MarketData[]> {
  // Market data doesn't require auth - can use API directly
  if (USE_API) {
    try {
      const apiClient = new PerplApiClient(API_CONFIG);
      const context = await apiClient.getContext();
      return context.markets.map(formatMarket);
    } catch {
      // Fall through to SDK
    }
  }

  // SDK fallback
  const exchange = new Exchange(/* ... */);
  return Promise.all(perpIds.map(id => exchange.getPerpetualInfo(id)));
}
```

### Phase 5: Update Skills Documentation

**File:** `.claude/skills/perpl-type/SKILL.md`

Add section:

```markdown
## API vs SDK Mode

By default, PerplBot uses the REST API for faster reads with automatic
fallback to direct contract calls if the API is unavailable.

### Environment Variables

- `PERPL_USE_API=true` (default) - Use API with SDK fallback
- `PERPL_USE_API=false` - Use SDK only (direct contract calls)

### When to Use SDK-Only Mode

- Debugging API-related issues
- API is down or returning incorrect data
- Need to verify on-chain state directly
- Testing contract interaction

### Example

```bash
# Default (API + fallback)
/perpl manage status

# Force SDK-only
PERPL_USE_API=false /perpl manage status
```
```

**File:** `.claude/skills/perpl/SKILL.md`

Same addition.

## Files to Create

| File | Purpose |
|------|---------|
| `src/sdk/api/hybrid.ts` | Hybrid client with API-first, SDK fallback |

## Files to Modify

| File | Change | Impact |
|------|--------|--------|
| `src/sdk/config.ts` | Add USE_API, API_CONFIG, FALLBACK_CONFIG | Low |
| `src/cli/trade.ts` | Use HybridClient | Medium |
| `src/cli/manage.ts` | Use HybridClient | Medium |
| `src/cli/show.ts` | Use HybridClient | Medium |
| `src/bot/handlers/status.ts` | Use HybridClient | Medium |
| `src/bot/handlers/trade.ts` | Use HybridClient | Medium |
| `src/bot/handlers/markets.ts` | Use HybridClient | Low |
| `.claude/skills/perpl-type/SKILL.md` | Document API mode | Low |
| `.claude/skills/perpl/SKILL.md` | Document API mode | Low |

## Error Handling Matrix

| Scenario | Behavior |
|----------|----------|
| API returns 200 | Use API response |
| API returns 401 | Re-authenticate, retry once, then SDK fallback |
| API returns 429 | SDK fallback (don't retry) |
| API returns 5xx | SDK fallback |
| API timeout (5s) | SDK fallback |
| API network error | SDK fallback |
| SDK fails | Throw error (no further fallback) |
| PERPL_USE_API=false | Skip API entirely, use SDK |

## Testing Strategy

### Unit Tests
```typescript
describe('HybridClient', () => {
  it('uses API when available', async () => {
    const mockApi = createMockApiClient({ positions: [...] });
    const client = new HybridClient({ exchange, apiClient: mockApi });

    const result = await client.getPosition(16n, 1n);

    expect(mockApi.getPositions).toHaveBeenCalled();
    expect(exchange.getPosition).not.toHaveBeenCalled();
  });

  it('falls back to SDK on API error', async () => {
    const mockApi = createMockApiClient();
    mockApi.getPositions.mockRejectedValue(new Error('API down'));

    const client = new HybridClient({ exchange, apiClient: mockApi });
    const result = await client.getPosition(16n, 1n);

    expect(exchange.getPosition).toHaveBeenCalled();
  });

  it('uses SDK directly when USE_API=false', async () => {
    const client = new HybridClient({ exchange, apiClient: mockApi, useApi: false });

    await client.getPosition(16n, 1n);

    expect(mockApi.getPositions).not.toHaveBeenCalled();
    expect(exchange.getPosition).toHaveBeenCalled();
  });
});
```

### Integration Tests
```bash
# Test API mode
PERPL_USE_API=true npm run dev -- manage status

# Test SDK mode
PERPL_USE_API=false npm run dev -- manage status

# Results should be identical (data from same source)
```

### Manual Testing
```bash
# 1. Normal operation (API + fallback)
/perpl manage status

# 2. Force SDK mode
PERPL_USE_API=false /perpl manage status

# 3. Simulate API failure (disconnect network, verify fallback works)
```

## Open Questions
- [x] Should writes ever use API? → **No, always SDK (on-chain tx required)**
- [x] Retry API before fallback? → **Once for auth errors, immediate fallback for others**
- [x] Log fallback events? → **Yes, with FALLBACK_CONFIG.logWarnings**

## Relationship to Other Plans

**Note**: This plan supersedes the API integration approach in `perpl-skills-api-plan.md`.

| Plan | Approach | Status |
|------|----------|--------|
| `perpl-skills-api-plan.md` | Extend `Exchange` class with API methods | Superseded |
| `perpl-hybrid-mode-plan.md` (this) | New `HybridClient` wrapper | **Use this** |

The `HybridClient` approach is preferred because:
- Cleaner separation of concerns (Exchange stays SDK-only)
- Easier to test (mock HybridClient or Exchange independently)
- More explicit fallback behavior

## Assumptions
- SDK/contract calls work independently of API
- RPC node is available (required for both modes)
- API and contract return equivalent data (may need mapping)

## Success Criteria

1. **API mode works**: `PERPL_USE_API=true` uses API with SDK fallback
2. **SDK mode works**: `PERPL_USE_API=false` uses SDK only (skips API)
3. **Auto-fallback**: Fallback triggers automatically on API errors/timeouts
4. **Observable**: Warning logged when falling back to SDK
5. **No regression**: All existing tests pass, functionality unchanged
6. **Bot support**: Bot handlers work correctly in both modes
7. **Documented**: Skills documentation updated with API mode info

## Complexity
Medium - New HybridClient abstraction, updates to CLI and bot handlers
