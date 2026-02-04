# Test Plan: API Migration Verification

**Feature**: REST/WebSocket API integration with contract fallback
**Status**: Ready for testing
**Date**: 2026-02-04

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
**Verify**:
- [ ] All tests pass
- [ ] No skipped tests
- [ ] Test output shows `test/api/client.test.ts` (15 tests)
- [ ] Test output shows `test/api/websocket.test.ts` (38 tests)

---

### 2. Type Check

```bash
npm run typecheck
```

**Expected**: No TypeScript errors
**Verify**:
- [ ] Exit code 0
- [ ] No error output

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

**Verify**:
- [ ] Shows "Mode: API + Contract"
- [ ] Account info displays correctly
- [ ] No errors

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

**Verify**:
- [ ] Shows "Mode: Contract only"
- [ ] Account info displays correctly
- [ ] No errors

#### 3.3 Environment Variable Override

```bash
PERPL_USE_API=false npm run dev -- manage status
```

**Expected**: Shows "Mode: Contract only"
**Verify**:
- [ ] Environment variable disables API mode

---

### 4. Markets Command

#### 4.1 With API

```bash
npm run dev -- manage markets
```

**Verify**:
- [ ] Shows available markets (BTC, ETH, SOL, MON, ZEC)
- [ ] Mark prices display
- [ ] Oracle prices display
- [ ] Funding rates display
- [ ] Open interest displays

#### 4.2 Without API

```bash
npm run dev -- --no-api manage markets
```

**Verify**:
- [ ] Same data as API mode (fetched from contract)
- [ ] May be slightly slower

---

### 5. Integration Test Script

```bash
npx tsx scripts/test-api-client.ts
```

**Expected**: All tests pass

**Verify REST Client**:
- [ ] Get context returns markets
- [ ] Get candles returns data
- [ ] Authentication succeeds
- [ ] Get fills works (authenticated)
- [ ] Get order history works
- [ ] Get position history works
- [ ] Get account history works

**Verify WebSocket (Market Data)**:
- [ ] Connects successfully
- [ ] Order book subscription works
- [ ] Market state subscription works
- [ ] Disconnects cleanly

**Verify WebSocket (Trading)**:
- [ ] Connects with auth
- [ ] Receives wallet snapshot
- [ ] Receives positions snapshot
- [ ] Receives orders snapshot
- [ ] Disconnects cleanly

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

**Verify**:
- [ ] Warning logged about API failure
- [ ] Command completes successfully
- [ ] Data retrieved from contract

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

**Verify**:
- [ ] USE_API is true by default
- [ ] API_CONFIG has correct URLs
- [ ] REST client fetches context
- [ ] WebSocket connects
- [ ] Market state received
- [ ] Clean disconnect

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

**Verify**:
- [ ] `isApiEnabled()` returns false without client
- [ ] `isApiEnabled()` returns true with client
- [ ] `getApiClient()` returns the client instance

---

### 9. Portfolio API Integration

Test that Portfolio uses API for batch queries:

```typescript
import { Portfolio, Exchange, PerplApiClient, API_CONFIG } from './src/sdk/index.js';

// With API client, getPositions() should use single API call
// Without API client, getPositions() should use N+1 contract calls
```

**Verify**:
- [ ] `isApiEnabled()` returns correct value
- [ ] `getPositions()` works with API
- [ ] `getPositions()` works without API (fallback)
- [ ] `getOrderHistory()` requires API
- [ ] `getFills()` requires API

---

### 10. State Tracker WebSocket Integration

**Verify**:
- [ ] `connectRealtime()` connects WebSocket
- [ ] `isRealtimeConnected()` returns true after connect
- [ ] Position updates received via WebSocket
- [ ] Order updates received via WebSocket
- [ ] Wallet updates received via WebSocket
- [ ] `disconnectRealtime()` disconnects cleanly
- [ ] Events emitted: `positions-updated`, `orders-updated`, `wallet-updated`

---

### 11. Operator Wallet WebSocket Trading

**Verify**:
- [ ] `connect({ enableApi: true })` initializes API
- [ ] `connectApi()` authenticates and connects WebSocket
- [ ] `isApiConnected()` returns true
- [ ] `setAccountId()` sets account for orders
- [ ] Market orders use WebSocket when connected
- [ ] Market orders fall back to contract when not connected
- [ ] `disconnectApi()` disconnects cleanly

---

## Performance Comparison

### With API vs Without API

| Operation | With API | Without API |
|-----------|----------|-------------|
| Get positions | ~100ms (1 call) | ~500ms+ (N+1 calls) |
| Get open orders | ~100ms (1 call) | ~1s+ (bitmap iteration) |
| Market state | Real-time WebSocket | Polling required |

**Verify**:
- [ ] API mode is noticeably faster for batch queries
- [ ] Contract mode still works correctly

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

- [ ] 297/297 unit tests pass
- [ ] TypeScript compiles without errors
- [ ] CLI works with `--no-api` flag
- [ ] CLI works without flag (API mode)
- [ ] API fallback triggers on failure
- [ ] WebSocket connections work
- [ ] REST authentication works
- [ ] All SDK exports accessible

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
