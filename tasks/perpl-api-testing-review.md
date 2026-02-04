# Perpl API Testing Plan Review

**Reviewer**: Claude (Reviewer Mode)
**Date**: 2026-02-04
**Plan**: `/Users/pbj/claude/tasks/perpl-api-testing-plan.md`
**Status**: Plan review (script not yet created)

---

## Review Summary

**Issues found**: 7 (P0: 0, P1: 1 ~~fixed~~, P2: 4, P3: 2)
**Verdict**: **APPROVED** - Ready for implementation

---

## Plan Completeness Check

| Section | Status | Notes |
|---------|--------|-------|
| Summary | ✅ Clear | Auth + 1 endpoint + WebSocket |
| Context | ✅ Good | References tester report, explains why |
| Design | ✅ Detailed | Test cases well-defined |
| Files | ✅ Listed | `scripts/test-api.ts` |
| Success Criteria | ✅ Present | 6 checkable items |
| Open Questions | ✅ Resolved | All answered |

---

## P1 - Must Fix

### 1. **Plan:100-101** - [Policy] Remove time estimate

```markdown
## Estimated Effort
~1-2 hours for script + testing + doc fixes
```

**Issue**: Time estimates violate project guidelines (see CLAUDE.md - "No time estimates").

**Fix**: Remove this section entirely, or replace with complexity indicator:
```markdown
## Complexity
Medium - Single test script, 3 test scenarios
```

---

## P2 - Should Fix

### 1. **Design** - [Incomplete] Missing error case tests

The plan only covers happy path. Should include:

```markdown
#### 4. Error Case Tests
```
POST /api/v1/auth/connect with invalid signature
  - Verify 401/403 response
  - Verify error message format

GET /api/v1/trading/fills without auth
  - Verify 401 response

WebSocket auth failure
  - Verify close code 3401
```
```

**Rationale**: Error handling is documented but untested. Validating error responses catches doc inaccuracies.

---

### 2. **WebSocket Test** - [Incomplete] Missing timeout/cleanup

```markdown
Wait for update message (mt: 16)
  - Verify same structure as snapshot
```

**Issues**:
- No timeout if no updates arrive (test hangs forever)
- No explicit disconnect after test
- No sequence number validation mentioned

**Fix**: Add to WebSocket test section:
```markdown
WebSocket Test Requirements:
- Timeout: 30s max for each message type
- Cleanup: Explicit ws.close() after test
- Validate: Check sequence numbers (sn) are increasing
- Handle: Reconnection not needed for one-shot test
```

---

### 3. **Auth Flow Test** - [Incomplete] JWT validation missing

```markdown
POST /api/v1/auth/connect
  - Verify response has: nonce
  - Verify JWT cookie is set
```

**Issue**: Should also verify JWT cookie properties:
- Cookie name
- HttpOnly flag
- Expiration (if documented)

**Fix**:
```markdown
POST /api/v1/auth/connect
  - Verify response has: nonce
  - Verify JWT cookie is set
  - Verify cookie name matches expected
  - Log cookie expiration for documentation
```

---

### 4. **Assumptions** - [Risk] Access code assumption

```markdown
- Test wallet has access to testnet (no access code needed, or we have one)
```

**Issue**: If access code is needed (HTTP 418), test will fail. Plan should address this:

**Fix**:
```markdown
## Assumptions
- Test wallet has access to testnet
- If HTTP 418 (access code required): Use ref_code from existing account or skip auth-dependent tests
```

---

## P3 - Consider

### 1. **Design** - [Clarity] Test framework not specified

Should the script use:
- Raw assertions (`if (!x) throw`)
- Node test runner (`node --test`)
- Project's vitest setup

**Recommendation**: Use vitest for consistency with existing tests (156 tests use vitest).

---

### 2. **Design** - [Clarity] Output format not specified

Where do test results go?
- Console only?
- JSON report?
- Update to untested report?

**Recommendation**: Add:
```markdown
### Output
- Console: Pass/fail for each test
- On failure: Log full response for debugging
- On success: Update tasks/perpl-api-untested.md to mark tested
```

---

## Verification Gate

| Check | Status |
|-------|--------|
| Plan scope is clear | ✅ Pass |
| Test cases defined | ✅ Pass |
| Success criteria measurable | ✅ Pass |
| Files to create listed | ✅ Pass |
| No blocking dependencies | ⚠️ Access code assumption |
| Time estimates removed | ✅ Pass (fixed) |

---

## Strengths

1. **Focused scope** - Option B is right balance (not too minimal, not too ambitious)
2. **Good reference** - Links to tester report and API docs
3. **Clear test cases** - Request/response expectations well-defined
4. **Resolved questions** - All open questions answered

---

## Recommendation

**Approve after P1 fix.** Remove time estimate, then proceed with implementation.

P2 items can be addressed during implementation:
- Add error case tests
- Add WebSocket timeout/cleanup
- Validate JWT cookie properties
- Handle access code scenario

---

## Suggested Test Script Structure

```typescript
// scripts/test-api.ts
import { describe, it, expect } from 'vitest';

describe('Perpl API Documentation Tests', () => {
  describe('Auth Flow', () => {
    it('gets signing payload', async () => { /* ... */ });
    it('signs and connects', async () => { /* ... */ });
    it('rejects invalid signature', async () => { /* ... */ });
  });

  describe('Authenticated Endpoints', () => {
    it('fetches trading fills', async () => { /* ... */ });
    it('rejects unauthenticated request', async () => { /* ... */ });
  });

  describe('Market Data WebSocket', () => {
    it('subscribes to order book', async () => { /* ... */ });
    it('receives snapshot and updates', async () => { /* ... */ });
  });
});
```

Run with: `npm test -- scripts/test-api.ts`

---

## Next Steps

1. [x] Remove time estimate from plan
2. [ ] Implement `scripts/test-api.ts`
3. [ ] Run tests against testnet
4. [ ] Fix any doc discrepancies found
5. [ ] Update `tasks/perpl-api-untested.md` with results
