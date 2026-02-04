# Perpl API Migration Plan Review

**Reviewer**: Claude (Reviewer Mode)
**Date**: 2026-02-04
**Plan**: `/Users/pbj/claude/tasks/perpl-api-migration-plan.md`
**Scope**: Replace dex-sdk contract calls with REST/WebSocket API

---

## Review Summary

**Issues found**: 10 (P0: 0, P1: 1 ~~fixed~~, P2: 6 ~~fixed~~, P3: 3 ~~fixed~~)
**Verdict**: **APPROVED** - Ready for implementation

---

## Plan Quality Assessment

| Section | Status | Notes |
|---------|--------|-------|
| Summary | ✅ Clear | Contract → API migration |
| Context | ✅ Good | Latency, efficiency benefits explained |
| Architecture | ✅ Excellent | Before/after diagrams |
| Design | ✅ Detailed | 6 phases, interfaces defined |
| Files | ✅ Listed | Create 4, modify 7 |
| Open Questions | ❌ Unresolved | 4 questions unanswered |
| Success Criteria | ✅ Present | 5 checkable items |
| Risks | ✅ Identified | 4 risks listed |

---

## P1 - Must Fix

### 1. **Plan:245-250** - [Policy] Remove time estimates

```markdown
## Estimated Effort
- Phase 1 (API clients): 2-3 hours
- Phase 2-3 (Exchange/State): 2-3 hours
...
- **Total: 6-10 hours**
```

**Issue**: Time estimates violate project guidelines.

**Fix**: Remove entire section or replace with complexity indicator:
```markdown
## Complexity
High - 4 new files, 7 modified files, 6 phases
Dependencies: API docs (complete), test infrastructure (exists)
```

---

## P2 - Should Fix

### 1. **Plan:180-185** - [Policy] Line estimates in table

```markdown
| File | Purpose | Est. Lines |
|------|---------|------------|
| `src/sdk/api/client.ts` | REST API client | ~400 |
```

**Issue**: Line count estimates are also time/effort proxies.

**Fix**: Remove "Est. Lines" column:
```markdown
| File | Purpose |
|------|---------|
| `src/sdk/api/client.ts` | REST API client |
```

---

### 2. **Plan:207-211** - [Incomplete] Open questions unresolved

```markdown
## Open Questions
- [ ] Should order submission go through WebSocket or REST?
- [ ] Keep contract fallback permanently or remove after migration?
- [ ] How to handle API downtime? (fallback to contracts?)
- [ ] Should we support hybrid mode (API reads, contract writes)?
```

**Issue**: These are architectural decisions that affect implementation. Cannot proceed without answers.

**Recommendation**: Resolve now:
```markdown
## Open Questions (Resolved)
- [x] Order submission? → **WebSocket** (lower latency, matches trading WS docs)
- [x] Keep fallback? → **Yes, permanently** (resilience > cleanliness)
- [x] API downtime handling? → **Auto-fallback to contracts with warning log**
- [x] Hybrid mode? → **Yes, default mode** (API reads, contract writes initially)
```

---

### 3. **Design** - [Missing] No test strategy

Plan mentions "All existing tests pass" but doesn't address:
- New tests for API client
- Mock API responses for unit tests
- Integration tests against real API

**Add**:
```markdown
## Testing Strategy

### Unit Tests (new)
- `test/api/client.test.ts` - REST client with mocked fetch
- `test/api/websocket.test.ts` - WS client with mock server

### Integration Tests
- `test/api/integration.test.ts` - Real API (testnet)
- Run with: `npm run test:integration`

### Existing Tests
- Keep all existing contract tests (validates fallback)
- Update mocks where needed
```

---

### 4. **Design** - [Missing] Error handling strategy

What happens when:
- API returns 401 (auth expired)?
- API returns 429 (rate limited)?
- API returns 500 (server error)?
- WebSocket disconnects mid-operation?

**Add**:
```markdown
## Error Handling

| Error | Strategy |
|-------|----------|
| 401 Unauthorized | Re-authenticate automatically |
| 429 Rate Limited | Exponential backoff (1s, 2s, 4s...) |
| 500 Server Error | Fallback to contract read |
| WS Disconnect | Auto-reconnect with backoff |
| WS Auth Failure (3401) | Re-auth via REST, reconnect |
```

---

### 5. **Design** - [Incomplete] WebSocket reconnection not detailed

```markdown
## Risks
- WebSocket reconnection handling complexity
```

**Issue**: Risk identified but no mitigation strategy.

**Add to Phase 1 design**:
```typescript
export class PerplWebSocketClient {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelays = [1000, 2000, 4000, 8000, 16000, 32000];

  private async reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('fatal', new Error('Max reconnect attempts exceeded'));
      return;
    }
    const delay = this.reconnectDelays[Math.min(this.reconnectAttempts, 5)];
    await sleep(delay);
    this.reconnectAttempts++;
    await this.connect(this.authNonce);
  }
}
```

---

### 6. **Design** - [Missing] Auth token lifecycle

```markdown
## Risks
- Auth token expiration handling
```

**Issue**: Risk identified but no strategy.

**Add**:
```markdown
## Auth Token Management

1. **Initial Auth**: On client creation or first API call
2. **Token Storage**: In-memory (not persisted)
3. **Expiration Detection**: 401 response or WS close 3401
4. **Refresh Strategy**: Re-run full auth flow (payload → sign → connect)
5. **Proactive Refresh**: Optional - refresh before expiry if JWT exp claim available
```

---

## P3 - Consider

### 1. **References** - Should link to API docs

```markdown
## Reference
- API Documentation: `PerplBot/docs/api/` (recently created)
- API Testing: `tasks/perpl-api-testing-plan.md` (validated)
```

---

### 2. **Migration Order** - Clarify phase dependencies

Current phases could run in parallel or have strict order. Clarify:

```markdown
## Phase Dependencies

Phase 1 → Phase 2 → Phase 3 (sequential, each depends on previous)
          ↓
Phase 4 (can start after Phase 2)
          ↓
Phase 5 (requires Phase 3 + 4)
          ↓
Phase 6 (final)
```

---

### 3. **Rollback Strategy** - Not addressed

What if migration fails mid-way?

**Add**:
```markdown
## Rollback Strategy

Each phase is independently deployable:
- Phase 1: New files only, no rollback needed
- Phase 2-5: Contract fallback = automatic rollback
- Phase 6: Can revert CLI changes, fallback still works

Feature flag option:
```typescript
const USE_API = process.env.PERPL_USE_API !== 'false';
```
```

---

## Verification Gate

| Check | Status |
|-------|--------|
| Clear scope | ✅ Pass |
| Phased approach | ✅ Pass |
| Files listed | ✅ Pass |
| Interfaces defined | ✅ Pass |
| Open questions resolved | ✅ Pass (fixed) |
| Test strategy | ✅ Pass (added) |
| Error handling | ✅ Pass (added) |
| Time estimates removed | ✅ Pass (fixed) |

---

## Strengths

1. **Phased approach** - Option B (gradual) is correct choice
2. **Fallback strategy** - Keeps contracts as safety net
3. **Clear interfaces** - API client interfaces well-defined
4. **Risk awareness** - Key risks identified
5. **Architecture diagrams** - Before/after clear

---

## Recommendation

**Revise plan before implementation:**

1. **P1**: Remove time estimates (required)
2. **P2**: Resolve open questions - propose answers, get sign-off
3. **P2**: Add test strategy section
4. **P2**: Add error handling table
5. **P2**: Detail WebSocket reconnection
6. **P2**: Add auth lifecycle section

---

## Proposed Open Question Resolutions

For your approval:

| Question | Proposed Answer | Rationale |
|----------|-----------------|-----------|
| Order submission: WS or REST? | **WebSocket** | Lower latency, real-time feedback |
| Keep contract fallback? | **Yes, permanently** | Resilience over cleanliness |
| API downtime handling? | **Auto-fallback + log warning** | Seamless degradation |
| Hybrid mode support? | **Yes, as default** | Safest migration path |

---

## Next Steps

1. [x] Remove time estimates (P1)
2. [x] Remove line count estimates (P2)
3. [x] Resolve open questions
4. [x] Add test strategy section
5. [x] Add error handling section
6. [x] Add auth lifecycle section
7. [x] Add rollback strategy
8. [x] Add references to API docs
9. [ ] Begin Phase 1 implementation
