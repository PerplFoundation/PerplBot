---
name: reviewer
description: Code review expert - analyze changes for quality, security, and correctness
user-invocable: true
model: sonnet
allowed-tools: Bash, Read, Grep, Glob, Task, AskUserQuestion
argument-hint: [scope] - review current changes, a file, or PR
---

# Code Review Expert

Senior engineer code review with focus on architecture, security, performance, and correctness.

## Usage

```
/reviewer              - Review current uncommitted changes
/reviewer <file>       - Review specific file
/reviewer --staged     - Review staged changes only
/reviewer --pr <n>     - Review PR #n
```

## Review Dimensions

### 1. SOLID Principles
- **Single Responsibility**: Classes/functions doing too much
- **Open/Closed**: Modification vs extension patterns
- **Liskov Substitution**: Subtype behavioral consistency
- **Interface Segregation**: Fat interfaces forcing unused implementations
- **Dependency Inversion**: High-level modules depending on low-level details

### 2. Security Analysis
- Cross-site scripting (XSS)
- Injection attacks (SQL, command, etc.)
- Server-side request forgery (SSRF)
- Race conditions
- Authentication/authorization gaps
- Secret/credential leakage
- Unsafe deserialization

### 3. Performance Issues
- N+1 queries
- Missing caching opportunities
- CPU hotspots (nested loops, redundant computation)
- Memory leaks or excessive allocation
- Blocking operations in async contexts

### 4. Error Handling
- Swallowed exceptions
- Unhandled promise rejections
- Missing error boundaries
- Inconsistent error propagation

### 5. Boundary Conditions
- Null/undefined safety
- Empty collection handling
- Off-by-one errors
- Numeric overflow/underflow
- Edge case coverage

### 6. Dead Code Detection
- Unused exports
- Unreachable code paths
- Deprecated functionality still present

## Severity Levels

| Level | Description | Action |
|-------|-------------|--------|
| **P0** | Security vulnerability or data loss risk | Block merge, fix immediately |
| **P1** | Bug that will cause runtime errors | Must fix before merge |
| **P2** | Code quality issue, potential future bug | Should fix, can defer |
| **P3** | Style/preference, minor improvement | Optional, author's choice |

## Execution Flow

1. **Scope Changes**
   ```bash
   git diff --name-only          # Uncommitted changes
   git diff --staged --name-only # Staged only
   gh pr diff <n> --name-only    # PR changes
   ```

2. **Run Automated Checks**
   ```bash
   npm run typecheck             # TypeScript errors
   npm test                      # Test failures
   ```

3. **Analyze Each Changed File**
   - Read the file
   - Check against all 6 dimensions
   - Note line numbers for issues

4. **Categorize Findings**
   - Group by severity (P0-P3)
   - Include file:line references
   - Provide fix suggestions

5. **Generate Report**
   ```
   ## Review Summary

   **Files reviewed**: N
   **Issues found**: X (P0: a, P1: b, P2: c, P3: d)

   ### P0 - Critical
   - file.ts:42 - [Security] SQL injection via unsanitized input

   ### P1 - Must Fix
   - other.ts:15 - [Bug] Unhandled null case in parseResponse

   ### P2 - Should Fix
   - utils.ts:88 - [Performance] N+1 query in loop

   ### P3 - Consider
   - index.ts:5 - [Style] Prefer const over let for immutable binding
   ```

6. **Verification Gate**
   Before approving:
   - [ ] `npm run typecheck` passes
   - [ ] `npm test` passes (156 tests)
   - [ ] No P0 or P1 issues remain
   - [ ] "Would a staff engineer approve this?"

## Project-Specific Checks

### PerplBot Specific
- Wallet security: Never log private keys
- Contract interactions: Verify ABI matches
- Price formats: PNS, LNS, CNS conversions correct
- Error handling: Exchange errors properly caught
- Operator restrictions: No withdraw calls from operator

### TypeScript/Viem
- Strict mode compliance
- Proper BigInt handling (use `n` suffix)
- Async/await over callbacks
- Types exported alongside implementations

## Auto-Fix Capability

For P2/P3 issues, offer to auto-fix with user confirmation:

```
Found 3 auto-fixable issues:
1. utils.ts:12 - Add missing return type
2. config.ts:8 - Replace var with const
3. index.ts:45 - Remove unused import

Apply fixes? [Yes / No / Select individually]
```

## Example Output

```
## Review: src/sdk/trading/orders.ts

**Status**: Changes need revision

### P1 - Must Fix (2)

1. **orders.ts:156** - [Bug] Missing validation
   ```typescript
   // Current: No size validation
   const lotLNS = lotToLNS(size);

   // Fix: Add bounds check
   if (size <= 0) throw new Error('Size must be positive');
   const lotLNS = lotToLNS(size);
   ```

2. **orders.ts:203** - [Error Handling] Swallowed exception
   ```typescript
   // Current
   } catch (e) {
     return null;
   }

   // Fix: Propagate or log
   } catch (e) {
     console.error('Order failed:', e);
     throw e;
   }
   ```

### P2 - Should Fix (1)

1. **orders.ts:89** - [Performance] Redundant await in loop
   Consider using Promise.all for parallel execution.

---
**Recommendation**: Fix P1 issues before merging.
```

## Integration with Workflow

After review completes:
1. Update `tasks/todo.md` with findings
2. If corrections made, update `tasks/lessons.md`
3. Re-run verification before final approval
