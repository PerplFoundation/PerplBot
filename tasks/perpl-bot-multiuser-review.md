# Review: Multi-User Telegram Bot Plan

**Reviewer**: Claude Opus 4.5
**Date**: 2026-02-04
**Status**: ✅ Approved (all P2 issues fixed)

---

## Summary

The plan proposes transforming PerplBot from single-user to multi-user via the DelegatedAccount pattern. The security model is sound - users keep custody, bot can only trade. However, there are unresolved questions and missing implementation details.

---

## Issues Found

### P2 - Unresolved Open Questions

**Location**: Open Questions section

**Issue**: 5 questions remain unanswered:
- Rate limiting per user?
- Maximum users allowed?
- Fee model for bot usage?
- User banning/blocking mechanism?
- Notification preferences per user?

**Impact**: These affect architecture decisions (e.g., rate limiting needs middleware, fees need payment tracking).

**Fix**: Resolve or defer explicitly with rationale.

**Resolution**: ✅ Added "Design Decisions" section with decisions and rationale for all 5 questions.

---

### P2 - Success Criteria Format

**Location**: Success Criteria section

**Issue**: Uses checkbox format `[ ]` which is inappropriate for a plan.

**Fix**: Convert to numbered requirements.

**Resolution**: ✅ Converted to 7 numbered requirements with clear descriptions.

---

### P2 - Missing TypeScript Type Extension

**Location**: Phase 3, middleware

**Issue**: Code adds `ctx.user` but Telegraf's Context type doesn't have this property:
```typescript
ctx.user = user;  // TypeScript error: Property 'user' does not exist
```

**Fix**: Add type extension:
```typescript
import { Context as TelegrafContext } from 'telegraf';

interface BotContext extends TelegrafContext {
  user?: User;
}
```

**Resolution**: ✅ Added `src/bot/types.ts` with BotContext interface.

---

### P2 - Missing Crypto Implementation

**Location**: Phase 2, `handleLink()`

**Issue**: `generateNonce()` and `recoverAddress()` are referenced but not defined. Critical for security.

**Fix**: Add implementations:
```typescript
import { randomBytes } from 'crypto';
import { verifyMessage } from 'viem';

function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

async function recoverAddress(message: string, signature: string): Promise<string> {
  return verifyMessage({ message, signature });
}
```

**Resolution**: ✅ Added `src/bot/crypto.ts` with generateNonce, recoverAddress, and formatLinkMessage.

---

### P2 - Signature Message Format

**Location**: Phase 2, wallet linking

**Issue**: Custom message format may not display well in all wallets. Should use EIP-191 personal_sign format explicitly.

**Suggestion**: Format message clearly:
```typescript
function formatLinkMessage(telegramId: number, nonce: string): string {
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

**Resolution**: ✅ Added formatLinkMessage in crypto.ts with clear, user-friendly format.

---

### P2 - Missing Error Handling

**Location**: Phase 4, handlers

**Issue**: No error handling for:
- Database connection failures
- Contract call failures
- Operator status check failures

**Fix**: Add try/catch blocks with user-friendly error messages:
```typescript
try {
  const isOperator = await verifyOperatorStatus(user.delegatedAccount);
  if (!isOperator) { ... }
} catch (error) {
  console.error('[TRADE] Operator check failed:', error);
  return ctx.reply('Unable to verify bot permissions. Please try again.');
}
```

**Resolution**: ✅ Added try/catch with user-friendly error messages to executeTrade handler.

---

### P3 - Database Path Hardcoded

**Location**: Phase 1, `src/bot/db/index.ts`

**Issue**: Database path is hardcoded:
```typescript
const db = new Database('perplbot.db');
```

**Suggestion**: Use environment variable:
```typescript
const DB_PATH = process.env.DATABASE_PATH || './data/perplbot.db';
const db = new Database(DB_PATH);
```

**Resolution**: ✅ Fixed. Database path now uses DATABASE_PATH env var with directory creation.

---

### P3 - Link Request Expiry Too Short

**Location**: Phase 2, `handleLink()`

**Issue**: 10-minute expiry may be too short for users unfamiliar with wallet signing.

**Suggestion**: Extend to 30 minutes or make configurable:
```typescript
const LINK_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
```

**Resolution**: ✅ Fixed. Extended to 30 minutes.

---

### P3 - Missing Cleanup Job

**Location**: Database schema

**Issue**: Expired link requests accumulate in database.

**Suggestion**: Add periodic cleanup:
```typescript
// Run on bot startup and periodically
function cleanupExpiredRequests(): void {
  db.prepare('DELETE FROM link_requests WHERE expires_at < ?').run(new Date());
}
```

**Resolution**: ✅ Fixed. Added cleanupExpiredRequests() function to db/index.ts.

---

### P3 - Missing /whoami Command

**Location**: New Commands table

**Suggestion**: Add `/whoami` to show linked wallet and account status - useful for debugging.

**Resolution**: ✅ Fixed. Added /whoami to commands table.

---

## Verdict

| Severity | Count | Status |
|----------|-------|--------|
| P0 | 0 | - |
| P1 | 0 | - |
| P2 | 6 | ✅ All fixed |
| P3 | 4 | ✅ All fixed |

**Result**: Plan approved for implementation.

---

## Positive Notes

- Security model is well-designed (DelegatedAccount pattern)
- Clear separation of owner vs operator permissions
- Attack scenarios table is helpful
- Migration path is sensible
