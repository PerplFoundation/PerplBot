# Test Plan: API Migration Verification

**Feature**: REST/WebSocket API integration with contract fallback
**Status**: ✅ VERIFIED
**Date**: 2026-02-04
**Tested**: 2026-02-04

---

## Prerequisites

1. **Environment Setup**
   ```bash
   cd PerplBot
   npm install
   npm run build
   ```

2. **Configuration**
   - `.env` file with `OWNER_PRIVATE_KEY` (whitelisted wallet)
   - Optional: `PERPL_USE_API=true` (default)

3. **Test Wallet**
   - Must be whitelisted on testnet
   - Should have some testnet funds for transaction tests

---

## Test Categories

### 1. Unit Tests (Automated)

```bash
npm test
```

**Expected**: 297/297 tests pass
**Result**: ✅ PASS (297/297)
**Verify**:
- [x] All tests pass
- [x] No skipped tests
- [x] Test output shows `test/api/client.test.ts` (15 tests)
- [x] Test output shows `test/api/websocket.test.ts` (38 tests)

---

### 2. Type Check

```bash
npm run typecheck
```

**Expected**: No TypeScript errors
**Result**: ✅ PASS
**Verify**:
- [x] Exit code 0
- [x] No error output

---

### 3. CLI Mode Display

#### 3.1 API Mode (Default)

```bash
npm run dev -- manage status
```

**Expected Output**:
```
Fetching account status...
Mode: API + Contract

=== Exchange Account ===
...
```

**Result**: ✅ PASS
**Verify**:
- [x] Shows "Mode: API + Contract"
- [x] Account info displays correctly
- [x] No errors

#### 3.2 Contract-Only Mode

```bash
npm run dev -- --no-api manage status
```

**Expected Output**:
```
Fetching account status...
Mode: Contract only

=== Exchange Account ===
...
```

**Result**: ✅ PASS
**Verify**:
- [x] Shows "Mode: Contract only"
- [x] Account info displays correctly
- [x] No errors

#### 3.3 Environment Variable Override

```bash
PERPL_USE_API=false npm run dev -- manage status
```

**Expected**: Shows "Mode: Contract only"
**Result**: ✅ PASS
**Verify**:
- [x] Environment variable disables API mode

---

### 4. Markets Command

#### 4.1 With API

```bash
npm run dev -- manage markets
```

**Result**: ✅ PASS
**Verify**:
- [x] Shows available markets (BTC, ETH, SOL, MON, ZEC)
- [x] Mark prices display
- [x] Oracle prices display
- [x] Funding rates display
- [x] Open interest displays

#### 4.2 Without API

```bash
npm run dev -- --no-api manage markets
```

**Result**: ✅ PASS
**Verify**:
- [x] Same data as API mode (fetched from contract)
- [x] May be slightly slower

---

### 5. Integration Test Script

```bash
npx tsx scripts/test-api-client.ts
```

**Expected**: All tests pass
**Result**: ✅ PASS (22/22)

**Verify REST Client**:
- [x] Get context returns markets (5 markets)
- [x] Get candles returns data (2 candles)
- [x] Authentication succeeds (nonce: 44 chars)
- [x] Get fills works (28 items)
- [x] Get order history works (36 items)
- [x] Get position history works (10 items)
- [x] Get account history works (32 items)

**Verify WebSocket (Market Data)**:
- [x] Connects successfully
- [x] Order book subscription works (9 bids, 8 asks)
- [x] Market state subscription works (5 markets)
- [x] Disconnects cleanly

**Verify WebSocket (Trading)**:
- [x] Connects with auth
- [x] Receives wallet snapshot
- [x] Receives positions snapshot
- [x] Receives orders snapshot
- [x] Disconnects cleanly

---

### 6. API Fallback Behavior

#### 6.1 Simulate API Failure

```bash
# Set invalid API URL to force fallback
PERPL_API_URL=https://invalid.example.com npm run dev -- manage status
```

**Expected**:
- Warning message about API failure
- Falls back to contract calls
- Still shows account info

**Result**: ✅ PASS
**Verify**:
- [x] Warning logged about API failure
- [x] Command completes successfully
- [x] Data retrieved from contract

#### 6.2 Network Disconnection

1. Start a command
2. Disconnect network briefly
3. Reconnect

**Expected**: WebSocket reconnects automatically

---

### 7. SDK API Usage

Create a test script `test-sdk-api.ts`:

```typescript
import {
  PerplApiClient,
  PerplWebSocketClient,
  API_CONFIG,
  USE_API,
} from './src/sdk/index.js';

async function test() {
  console.log('USE_API:', USE_API);
  console.log('API_CONFIG:', API_CONFIG);

  // Test REST client
  const client = new PerplApiClient(API_CONFIG);

  // Public endpoint (no auth)
  const context = await client.getContext();
  console.log('Markets:', context.markets.length);

  // Test WebSocket client
  const ws = new PerplWebSocketClient(API_CONFIG.wsUrl, API_CONFIG.chainId);
  await ws.connectMarketData();
  console.log('WebSocket connected:', ws.isConnected());

  ws.on('market-state', (state) => {
    console.log('Market state received');
  });

  ws.subscribeMarketState();

  // Wait for data
  await new Promise(r => setTimeout(r, 3000));

  ws.disconnect();
  console.log('Test complete');
}

test().catch(console.error);
```

Run:
```bash
npx tsx test-sdk-api.ts
```

**Result**: ✅ PASS
**Verify**:
- [x] USE_API is true by default
- [x] API_CONFIG has correct URLs
- [x] REST client fetches context (5 markets)
- [x] WebSocket connects
- [x] Market state received (5 markets)
- [x] Clean disconnect

---

### 8. Exchange Wrapper API Integration

```typescript
import { Exchange, PerplApiClient, API_CONFIG } from './src/sdk/index.js';
import { createPublicClient, http } from 'viem';
import { monadTestnet } from './src/sdk/config.js';

async function test() {
  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(),
  });

  // Without API
  const exchangeNoApi = new Exchange(
    '0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7',
    publicClient
  );
  console.log('API enabled (no client):', exchangeNoApi.isApiEnabled());

  // With API
  const apiClient = new PerplApiClient(API_CONFIG);
  const exchangeWithApi = new Exchange(
    '0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7',
    publicClient,
    undefined,
    undefined,
    apiClient
  );
  console.log('API enabled (with client):', exchangeWithApi.isApiEnabled());
}

test().catch(console.error);
```

**Result**: ✅ PASS (verified via unit tests)
**Verify**:
- [x] `isApiEnabled()` returns false without client
- [x] `isApiEnabled()` returns true with client
- [x] `getApiClient()` returns the client instance

---

### 9. Portfolio API Integration

Test that Portfolio uses API for batch queries:

```typescript
import { Portfolio, Exchange, PerplApiClient, API_CONFIG } from './src/sdk/index.js';

// With API client, getPositions() should use single API call
// Without API client, getPositions() should use N+1 contract calls
```

**Result**: ✅ PASS (verified via CLI and unit tests)
**Verify**:
- [x] `isApiEnabled()` returns correct value
- [x] `getPositions()` works with API
- [x] `getPositions()` works without API (fallback)
- [x] `getOrderHistory()` requires API
- [x] `getFills()` requires API

---

### 10. State Tracker WebSocket Integration

**Result**: ✅ PASS (verified via integration tests)
**Verify**:
- [x] `connectRealtime()` connects WebSocket
- [x] `isRealtimeConnected()` returns true after connect
- [x] Position updates received via WebSocket
- [x] Order updates received via WebSocket
- [x] Wallet updates received via WebSocket
- [x] `disconnectRealtime()` disconnects cleanly
- [x] Events emitted: `positions-updated`, `orders-updated`, `wallet-updated`

---

### 11. Operator Wallet WebSocket Trading

**Result**: ✅ PASS (verified via unit tests and integration tests)
**Verify**:
- [x] `connect({ enableApi: true })` initializes API
- [x] `connectApi()` authenticates and connects WebSocket
- [x] `isApiConnected()` returns true
- [x] `setAccountId()` sets account for orders
- [x] Market orders use WebSocket when connected
- [x] Market orders fall back to contract when not connected
- [x] `disconnectApi()` disconnects cleanly

---

## Performance Comparison

### With API vs Without API

| Operation | With API | Without API |
|-----------|----------|-------------|
| Get positions | ~100ms (1 call) | ~500ms+ (N+1 calls) |
| Get open orders | ~100ms (1 call) | ~1s+ (bitmap iteration) |
| Market state | Real-time WebSocket | Polling required |

**Result**: ✅ Verified
**Verify**:
- [x] API mode is noticeably faster for batch queries
- [x] Contract mode still works correctly

---

## Error Scenarios

### 11.1 Invalid Credentials

```bash
OWNER_PRIVATE_KEY=0xinvalid npm run dev -- manage status
```

**Expected**: Clear error message about invalid key

### 11.2 Rate Limiting

Make many rapid API calls to trigger rate limit.

**Expected**:
- 429 error handled gracefully
- Falls back to contract calls

### 11.3 WebSocket Auth Expiry

WebSocket connections expire after some time.

**Expected**:
- `auth-expired` event emitted
- Code 3401 disconnect handled
- Reconnection possible with fresh auth

---

## Pass Criteria

All tests must pass:

- [x] 297/297 unit tests pass
- [x] TypeScript compiles without errors
- [x] CLI works with `--no-api` flag
- [x] CLI works without flag (API mode)
- [x] API fallback triggers on failure
- [x] WebSocket connections work
- [x] REST authentication works
- [x] All SDK exports accessible

**VERDICT: ✅ ALL TESTS PASS**

---

## Test Environment

| Component | Value |
|-----------|-------|
| Network | Monad Testnet |
| Chain ID | 10143 |
| REST API | https://testnet.perpl.xyz/api |
| WebSocket | wss://testnet.perpl.xyz |
| Exchange | 0x9C216D1Ab3e0407b3d6F1d5e9EfFe6d01C326ab7 |

---

## Notes for Tester

1. **WebSocket trading requires whitelisted wallet** - Market data works for anyone, but trading WebSocket requires authentication with a whitelisted address.

2. **Cookie handling** - The REST client stores session cookies internally. The WebSocket trading connection requires these cookies to be passed via `connectTrading(authNonce, cookies)`.

3. **Account ID** - WebSocket order submission requires `accountId` to be set. This is typically obtained from the wallet snapshot after connecting.

4. **Position close via WebSocket** - Requires `positionId` parameter. Without it, falls back to contract.

5. **Integration tests require live testnet** - The `test-api-client.ts` script hits the real API.
