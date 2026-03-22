# Testing Anti-Patterns

## Overview

Common testing mistakes that produce tests which pass but don't prove anything. These anti-patterns often feel productive — they produce green checkmarks — but they verify mock behavior, not real behavior.

**Core principle:** Tests must prove real code works, not that mocks return what you told them to.

## The Iron Laws

1. **Tests must verify REAL behavior** - If removing the production code doesn't break the test, the test is worthless
2. **Production code must not know about tests** - No test-only methods, properties, or conditionals
3. **Mocks are a LAST resort** - Only mock what you literally cannot use (network, hardware, paid APIs)
4. **Every mock is a lie** - You're testing "what if X worked this way?" not "does X work?"

## Anti-Pattern 1: Testing Mock Behavior

**What it looks like:**

```typescript
// Mock returns canned data
vi.spyOn(service, "getData").mockResolvedValue({ items: [1, 2, 3] });

// Test "verifies" the data
const result = await component.loadData();
expect(result.items).toHaveLength(3); // ← testing the mock, not the code
```

**Why it's wrong:** You told the mock to return 3 items. Of course there are 3 items. You proved nothing.

**The fix:** Test with real data, real dependencies. If you must mock, verify the interaction (was it called correctly?), not the return value.

### Gate Function

Before writing a mock-based test, ask:

1. What production behavior am I proving?
2. If I delete the production code, will this test fail?
3. Am I testing what the mock returns, or how my code uses it?

If answer to #2 is "no" → rewrite the test.

## Anti-Pattern 2: Test-Only Methods in Production

**What it looks like:**

```typescript
class UserService {
  private users: Map<string, User>;

  // Added "for testing"
  getInternalState() {
    return this.users;
  }
  resetForTest() {
    this.users.clear();
  }
}
```

**Why it's wrong:** Production classes shouldn't know tests exist. Test-only methods leak internals, bypass encapsulation, and become dependencies that prevent refactoring.

**The fix:** Test through public interfaces. If you can't test behavior through the API, the API is wrong — fix the API, not the test.

### Gate Function

Before adding a method "for testing":

1. Can I verify this behavior through the public API?
2. Am I testing implementation details or behavior?
3. Would I add this method if tests didn't exist?

If answer to #3 is "no" → don't add it.

## Anti-Pattern 3: Mocking Without Understanding

**What it looks like:**

```typescript
// "I need to mock this to make the test work"
vi.mock("./database");
vi.mock("./auth");
vi.mock("./logger");
vi.mock("./config");
// ... 10 more mocks

// Test runs but proves nothing about real integration
```

**Why it's wrong:** If you need to mock everything, you're not testing your code — you're testing a fantasy world where nothing is real.

**The fix:** Use real dependencies where possible. Create test databases, in-memory stores, test configurations. Only mock true external boundaries (HTTP APIs, hardware).

### Gate Function

Before mocking a dependency:

1. Can I use the real thing? (in-memory DB, test config, etc.)
2. Why do I need to mock this? (if answer is "it's hard" → that's not a reason)
3. What behavior am I UNABLE to test because of this mock?

If you can use the real thing → use it.

## Anti-Pattern 4: Incomplete Mocks

**What it looks like:**

```typescript
const mockDb = {
  query: vi.fn().mockResolvedValue([]),
  // Missing: insert, update, delete, transaction, close
};
```

**Why it's wrong:** Incomplete mocks silently pass when production code calls missing methods. The test passes, but production breaks.

**The fix:** If you must mock, implement the full interface. Better: use the real dependency.

### Gate Function

Before using a partial mock:

1. Does the mock implement the full interface?
2. Will missing methods throw or silently return undefined?
3. Does the production code use methods not in the mock?

If any method is missing → complete the mock or use real dependency.

## Anti-Pattern 5: Integration Tests as Afterthought

**What it looks like:** 100 unit tests with mocks, 0 integration tests with real deps.

**Why it's wrong:** Unit tests with mocks verify component behavior in isolation — in a world where everything else works perfectly. Integration tests verify that the components actually work together.

**The fix:** Start with integration tests. Add unit tests for complex logic. The integration test proves it works; unit tests prove the details.

## When Mocks Become Too Complex

If your mock setup is longer than your test → stop.

Signs you need integration tests instead:

- Mock setup > 10 lines
- Mocking 3+ dependencies
- Mocking internal modules (not external boundaries)
- Debugging mock setup instead of code

## TDD Prevents These Anti-Patterns

When you write the test first:

- You design the API before implementing
- Tests naturally use public interfaces
- You discover mock needs early (and question them)
- Tests verify desired behavior, not actual implementation

## Quick Reference

| Anti-Pattern               | Symptom                        | Fix                                     |
| -------------------------- | ------------------------------ | --------------------------------------- |
| Testing mock behavior      | Assert on mock return values   | Test real behavior or mock interactions |
| Test-only methods          | Methods that only tests call   | Test through public API                 |
| Mock without understanding | 5+ mocks per test              | Use real dependencies                   |
| Incomplete mocks           | Silent undefined returns       | Full interface or real dep              |
| No integration tests       | All mocks, no real connections | Start with integration tests            |

## Red Flags

- "I need to add this method for testing"
- "Let me mock this so the test passes"
- "The test works with mocks"
- "I'll add integration tests later"
- Test passes when production code is deleted
- Mock setup is longer than the test
- Test name describes implementation, not behavior

## The Bottom Line

**A test that can't fail is not a test.** A test that only fails when mocks change is testing mocks. Write tests that prove real code does real things.

---

_From [obra/superpowers](https://github.com/obra/superpowers) — MIT License_
