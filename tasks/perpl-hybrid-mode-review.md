# Review: Hybrid API/SDK Mode Plan

**Reviewer**: Claude Opus 4.5
**Date**: 2026-02-04
**Status**: ✅ Approved (all P2 issues fixed)

---

## Summary

The plan proposes a `HybridClient` abstraction for API-first reads with SDK fallback. The architecture is sound but has conflicts with the existing `perpl-skills-api-plan.md` and some technical issues.

---

## Issues Found

### P2 - Architectural Conflict with Existing Plan

**Location**: Overall architecture

**Issue**: This plan creates a new `HybridClient` wrapper, but `perpl-skills-api-plan.md` proposes extending `Exchange` directly with API-first pattern. Both approaches:
- Add API fallback to `getPosition()`, `getPerpetualInfo()`, `getOpenOrders()`
- Update CLI and bot handlers similarly

**Impact**: Implementing both creates duplicate code paths and confusion about which to use.

**Fix**: Reconcile the two plans. Options:
1. **HybridClient wraps Exchange** (this plan) - cleaner separation
2. **Exchange has API built-in** (skills plan) - simpler, one class to use

**Recommendation**: Use HybridClient approach (this plan) as it's cleaner separation of concerns. Update `perpl-skills-api-plan.md` to reference this plan instead of duplicating.

**Resolution**: ✅ Added "Relationship to Other Plans" section clarifying this plan supersedes skills plan.

---

### P2 - Incorrect WebSocket URL

**Location**: Phase 1, `API_CONFIG`

**Issue**:
```typescript
wsUrl: process.env.PERPL_WS_URL || 'wss://testnet.perpl.xyz/api/ws',  // WRONG
```

Per `api-docs/websocket.md`, correct paths are:
- Trading: `wss://testnet.perpl.xyz/ws/v1/trading`
- Market data: `wss://testnet.perpl.xyz/ws/v1/market-data`

**Fix**: Change to:
```typescript
wsUrl: process.env.PERPL_WS_URL || 'wss://testnet.perpl.xyz',
// Append /ws/v1/trading or /ws/v1/market-data as needed
```

**Resolution**: ✅ Fixed. Also added `WS_PATHS` constant and made `chainId` configurable.

---

### P2 - Position Not Found Throws Instead of Returns Null

**Location**: Phase 2, `tryApiGetPosition()`

**Issue**:
```typescript
const pos = positions.find(p => BigInt(p.mkt) === perpId);
if (!pos) throw new Error('Position not found');  // WRONG
```

Throwing when position doesn't exist causes fallback to SDK, which will also return "not found". This is not an error condition - user may not have a position in that market.

**Fix**:
```typescript
const pos = positions.find(p => BigInt(p.mkt) === perpId);
if (!pos) return null;  // No position is valid state
```

**Resolution**: ✅ Fixed. Updated return type to `PositionData | null`.

---

### P2 - Success Criteria Format

**Location**: Success Criteria section

**Issue**: Uses checkbox format `[ ]` which is inappropriate for a plan (these aren't tasks to track).

**Fix**: Convert to numbered requirements.

**Resolution**: ✅ Fixed. Converted to numbered requirements with clear descriptions.

---

### P3 - Timeout Pattern Could Use AbortController

**Location**: Phase 2, `withTimeout()`

**Issue**: Current implementation creates race between promise and timeout, but doesn't abort the original request.

**Suggestion** (optional improvement):
```typescript
private async withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    FALLBACK_CONFIG.apiTimeoutMs
  );
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

---

### P3 - Missing Type Imports

**Location**: Phase 2, `HybridClient`

**Issue**: References types like `PositionData`, `PerpetualInfo`, `Order[]`, `AccountInfo`, `OrderDesc`, `TxReceipt` without imports.

**Fix**: Add explicit imports or define type aliases at top of file.

**Resolution**: ✅ Fixed. Added imports for all types.

---

## Verdict

| Severity | Count | Status |
|----------|-------|--------|
| P0 | 0 | - |
| P1 | 0 | - |
| P2 | 4 | ✅ All fixed |
| P3 | 2 | Fixed (type imports) |

**Result**: Plan approved for implementation.
