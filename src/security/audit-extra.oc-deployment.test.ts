/**
 * Tests for OC-deployment-specific audit checks.
 *
 * These tests directly import from audit-extra.sync.ts to avoid pulling in
 * the async collectors (which have heavy transitive deps like chrome-mcp).
 */
import { describe, expect, it } from "vitest";
import type { SecurityAuditFinding } from "./audit-extra.sync.js";

// Direct imports to avoid the barrel which pulls in async deps
const {
  collectAgentResourceFindings,
  collectBrowserSandboxAlignmentFindings,
  collectScraplingResourceFindings,
  collectSearxngExposureFindings,
} = await import("./audit-extra.sync.js");

// collectGatewayBindCorsFindings needs resolveGatewayAuth which may have
// transitive deps — test it separately to isolate potential import issues.
let collectGatewayBindCorsFindings:
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper; cfg is cast from minCfg
  ((cfg: any, env: NodeJS.ProcessEnv) => SecurityAuditFinding[]) | null = null;
try {
  const mod = await import("./audit-extra.sync.js");
  collectGatewayBindCorsFindings = mod.collectGatewayBindCorsFindings;
} catch {
  // Skip gateway tests if deps aren't available
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minCfg(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agents: { list: [] },
    gateway: {},
    browser: {},
    ...overrides,
  };
}

function findingIds(findings: SecurityAuditFinding[]): string[] {
  return findings.map((f) => f.checkId);
}

// ---------------------------------------------------------------------------
// collectSearxngExposureFindings
// ---------------------------------------------------------------------------

describe("collectSearxngExposureFindings", () => {
  it("returns no findings when SEARXNG_BASE_URL is not set", () => {
    const findings = collectSearxngExposureFindings(minCfg(), {});
    expect(findings).toHaveLength(0);
  });

  it("returns no findings for internal Docker hostname", () => {
    const findings = collectSearxngExposureFindings(minCfg(), {
      SEARXNG_BASE_URL: "http://searxng:8080",
    });
    expect(findings).toHaveLength(0);
  });

  it("warns when SearXNG is on a public hostname", () => {
    const findings = collectSearxngExposureFindings(minCfg(), {
      SEARXNG_BASE_URL: "https://search.mysite.com",
    });
    expect(findingIds(findings)).toContain("oc.searxng_exposure");
  });

  it("warns when SearXNG is on 0.0.0.0 with non-standard port", () => {
    const findings = collectSearxngExposureFindings(minCfg(), {
      SEARXNG_BASE_URL: "http://0.0.0.0:9090",
    });
    expect(findingIds(findings)).toContain("oc.searxng_exposure");
  });

  it("no warning for 0.0.0.0:8080 (standard internal port)", () => {
    const findings = collectSearxngExposureFindings(minCfg(), {
      SEARXNG_BASE_URL: "http://0.0.0.0:8080",
    });
    expect(findingIds(findings)).not.toContain("oc.searxng_exposure");
  });
});

// ---------------------------------------------------------------------------
// collectScraplingResourceFindings
// ---------------------------------------------------------------------------

describe("collectScraplingResourceFindings", () => {
  it("returns no findings when SCRAPLING_BASE_URL is not set", () => {
    const findings = collectScraplingResourceFindings({});
    expect(findings).toHaveLength(0);
  });

  it("returns no findings for reasonable concurrency", () => {
    const findings = collectScraplingResourceFindings({
      SCRAPLING_BASE_URL: "http://scrapling:3000",
      SCRAPLING_MAX_CONCURRENCY: "5",
    });
    expect(findings).toHaveLength(0);
  });

  it("warns for high concurrency", () => {
    const findings = collectScraplingResourceFindings({
      SCRAPLING_BASE_URL: "http://scrapling:3000",
      SCRAPLING_MAX_CONCURRENCY: "20",
    });
    expect(findingIds(findings)).toContain("oc.scrapling_high_concurrency");
    expect(findings[0].detail).toContain("20");
  });
});

// ---------------------------------------------------------------------------
// collectBrowserSandboxAlignmentFindings
// ---------------------------------------------------------------------------

describe("collectBrowserSandboxAlignmentFindings", () => {
  it("returns no findings when sandbox mode is off", () => {
    const findings = collectBrowserSandboxAlignmentFindings(minCfg());
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when browser is disabled", () => {
    const findings = collectBrowserSandboxAlignmentFindings(
      minCfg({
        agents: { defaults: { sandbox: { mode: "all" } }, list: [] },
        browser: { enabled: false },
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it("warns when sandbox=all with host network browser", () => {
    const findings = collectBrowserSandboxAlignmentFindings(
      minCfg({
        agents: { defaults: { sandbox: { mode: "all" } }, list: [] },
        browser: { enabled: true, docker: { networkMode: "host" } },
      }),
    );
    expect(findingIds(findings)).toContain("oc.browser_sandbox_network_leak");
  });

  it("no warning when sandbox=all with default network", () => {
    const findings = collectBrowserSandboxAlignmentFindings(
      minCfg({
        agents: { defaults: { sandbox: { mode: "all" } }, list: [] },
        browser: { enabled: true, docker: {} },
      }),
    );
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collectGatewayBindCorsFindings
// ---------------------------------------------------------------------------

describe("collectGatewayBindCorsFindings", () => {
  it.skipIf(!collectGatewayBindCorsFindings)("returns no findings for loopback bind", () => {
    const findings = collectGatewayBindCorsFindings!(minCfg({ gateway: { bind: "loopback" } }), {});
    expect(findings).toHaveLength(0);
  });

  it.skipIf(!collectGatewayBindCorsFindings)(
    "returns critical finding for 0.0.0.0 bind with no auth",
    () => {
      const findings = collectGatewayBindCorsFindings!(
        minCfg({ gateway: { bind: "0.0.0.0", auth: { mode: "none" } } }),
        {},
      );
      expect(findingIds(findings)).toContain("oc.gateway_bind_no_auth");
      expect(findings[0].severity).toBe("critical");
    },
  );
});

// ---------------------------------------------------------------------------
// collectAgentResourceFindings
// ---------------------------------------------------------------------------

describe("collectAgentResourceFindings", () => {
  it("returns no findings for 5 or fewer agents", () => {
    const cfg = minCfg({
      agents: {
        list: Array.from({ length: 5 }, (_, i) => ({ id: `agent-${i}` })),
      },
    });
    const findings = collectAgentResourceFindings(cfg);
    expect(findings).toHaveLength(0);
  });

  it("returns info finding for 10+ agents with sandbox+browser", () => {
    const cfg = minCfg({
      agents: {
        defaults: { sandbox: { mode: "all" } },
        list: Array.from({ length: 10 }, (_, i) => ({ id: `agent-${i}` })),
      },
      browser: { enabled: true },
    });
    const findings = collectAgentResourceFindings(cfg);
    expect(findingIds(findings)).toContain("oc.agent_count_resource_warning");
    expect(findings[0].severity).toBe("info");
  });
});
