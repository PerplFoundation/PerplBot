#!/usr/bin/env npx tsx
/**
 * API Documentation Verification Tests
 *
 * Tests the Perpl API to verify documentation accuracy:
 * 1. Auth flow (payload -> sign -> connect)
 * 2. Authenticated endpoint (/api/v1/trading/fills)
 * 3. Market-data WebSocket (order-book subscription)
 *
 * Usage:
 *   npx tsx scripts/test-api.ts
 *
 * Environment:
 *   OPERATOR_PRIVATE_KEY - Private key for signing (optional, generates temp key if not set)
 */

import { config } from "dotenv";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { monadTestnet } from "../src/sdk/config.js";
import WebSocket from "ws";

config();

const API_URL = "https://testnet.perpl.xyz/api";
const WS_URL = "wss://testnet.perpl.xyz";  // WebSocket doesn't use /api prefix
const CHAIN_ID = 10143;

// Test results tracking
interface TestResult {
  name: string;
  status: "pass" | "fail" | "skip";
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`[test-api] ${msg}`);
}

function logResult(result: TestResult) {
  const icon = result.status === "pass" ? "✅" : result.status === "fail" ? "❌" : "⏭️";
  console.log(`${icon} ${result.name}${result.details ? ` - ${result.details}` : ""}`);
  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }
  results.push(result);
}

// Get or generate a test wallet with signing capabilities
function getTestWallet(): { account: ReturnType<typeof privateKeyToAccount>; privateKey: `0x${string}` } {
  let privateKey: `0x${string}`;
  const key = process.env.OPERATOR_PRIVATE_KEY;
  if (key) {
    privateKey = key.startsWith("0x") ? (key as `0x${string}`) : (`0x${key}` as `0x${string}`);
  } else {
    // Generate temporary key for testing
    log("No OPERATOR_PRIVATE_KEY set, generating temporary wallet...");
    privateKey = generatePrivateKey();
  }
  return {
    account: privateKeyToAccount(privateKey),
    privateKey,
  };
}

// ============================================================================
// Test 1: Auth Flow
// ============================================================================

interface AuthPayloadResponse {
  message: string;
  nonce: string;
  issued_at: number;
  mac: string;
}

interface AuthConnectResponse {
  nonce: string;
}

interface AuthResult {
  authNonce?: string;
  cookies?: string;
  error?: string;
}

async function testAuthFlow(
  account: ReturnType<typeof privateKeyToAccount>,
  privateKey: `0x${string}`
): Promise<AuthResult> {
  log("\n=== Test 1: Auth Flow ===");

  // Step 1: Get payload
  log(`Testing POST /api/v1/auth/payload for ${account.address}`);
  let payload: AuthPayloadResponse;
  try {
    const payloadRes = await fetch(`${API_URL}/v1/auth/payload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chain_id: CHAIN_ID,
        address: account.address,
      }),
    });

    if (!payloadRes.ok) {
      const text = await payloadRes.text();
      logResult({
        name: "Auth Payload",
        status: "fail",
        error: `HTTP ${payloadRes.status}: ${text}`,
      });
      return { error: `Payload request failed: ${payloadRes.status}` };
    }

    payload = await payloadRes.json();

    // Verify response structure
    const hasMessage = typeof payload.message === "string" && payload.message.length > 0;
    const hasNonce = typeof payload.nonce === "string" && payload.nonce.length > 0;
    const hasIssuedAt = typeof payload.issued_at === "number";
    const hasMac = typeof payload.mac === "string" && payload.mac.length > 0;
    const isSIWE = payload.message?.includes("wants you to sign in with your Ethereum account");

    if (hasMessage && hasNonce && hasIssuedAt && hasMac) {
      logResult({
        name: "Auth Payload",
        status: "pass",
        details: `SIWE format: ${isSIWE ? "yes" : "no"}, nonce length: ${payload.nonce.length}`,
      });
    } else {
      logResult({
        name: "Auth Payload",
        status: "fail",
        details: `Missing fields: ${[
          !hasMessage && "message",
          !hasNonce && "nonce",
          !hasIssuedAt && "issued_at",
          !hasMac && "mac",
        ]
          .filter(Boolean)
          .join(", ")}`,
      });
      return { error: "Payload response missing required fields" };
    }
  } catch (e: any) {
    logResult({
      name: "Auth Payload",
      status: "fail",
      error: e.message,
    });
    return { error: e.message };
  }

  // Step 2: Sign the message
  log("Signing SIWE message...");
  let signature: `0x${string}`;
  try {
    // Create wallet client for signing
    const walletClient = createWalletClient({
      account,
      chain: monadTestnet,
      transport: http(),
    });
    signature = await walletClient.signMessage({
      message: payload.message,
    });
    logResult({
      name: "Sign Message",
      status: "pass",
      details: `signature: ${signature.slice(0, 20)}...`,
    });
  } catch (e: any) {
    logResult({
      name: "Sign Message",
      status: "fail",
      error: e.message,
    });
    return { error: e.message };
  }

  // Step 3: Connect
  log("Testing POST /api/v1/auth/connect");
  try {
    const connectRes = await fetch(`${API_URL}/v1/auth/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chain_id: CHAIN_ID,
        address: account.address,
        message: payload.message,
        nonce: payload.nonce,
        issued_at: payload.issued_at,
        mac: payload.mac,
        signature,
      }),
    });

    if (connectRes.status === 418) {
      logResult({
        name: "Auth Connect",
        status: "skip",
        details: "Access code required (HTTP 418) - wallet not whitelisted",
      });
      return { error: "Access code required" };
    }

    if (connectRes.status === 423) {
      logResult({
        name: "Auth Connect",
        status: "skip",
        details: "Access code invalid/exhausted (HTTP 423)",
      });
      return { error: "Access code invalid" };
    }

    if (!connectRes.ok) {
      const text = await connectRes.text();
      logResult({
        name: "Auth Connect",
        status: "fail",
        error: `HTTP ${connectRes.status}: ${text}`,
      });
      return { error: `Connect failed: ${connectRes.status}` };
    }

    const auth: AuthConnectResponse = await connectRes.json();

    // Capture cookies from Set-Cookie header
    const setCookies = connectRes.headers.getSetCookie?.() || [];
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");

    if (typeof auth.nonce === "string" && auth.nonce.length > 0) {
      logResult({
        name: "Auth Connect",
        status: "pass",
        details: `Got auth nonce (length: ${auth.nonce.length}), cookies: ${setCookies.length > 0 ? "yes" : "no"}`,
      });
      return { authNonce: auth.nonce, cookies: cookieHeader };
    } else {
      logResult({
        name: "Auth Connect",
        status: "fail",
        details: "Response missing nonce",
      });
      return { error: "No nonce in response" };
    }
  } catch (e: any) {
    logResult({
      name: "Auth Connect",
      status: "fail",
      error: e.message,
    });
    return { error: e.message };
  }
}

// ============================================================================
// Test 2: Authenticated Endpoint
// ============================================================================

async function testAuthenticatedEndpoint(authNonce: string, cookies: string): Promise<void> {
  log("\n=== Test 2: Authenticated Endpoint ===");
  log("Testing GET /api/v1/trading/fills");

  try {
    const headers: Record<string, string> = {
      "X-Auth-Nonce": authNonce,
    };
    if (cookies) {
      headers["Cookie"] = cookies;
    }

    const res = await fetch(`${API_URL}/v1/trading/fills?count=10`, {
      headers,
    });

    // 404 is valid for accounts with no trading history
    if (res.status === 404) {
      logResult({
        name: "Trading Fills",
        status: "pass",
        details: "No trading history (HTTP 404 - expected for new accounts)",
      });
      return;
    }

    if (!res.ok) {
      const text = await res.text();
      logResult({
        name: "Trading Fills",
        status: "fail",
        error: `HTTP ${res.status}: ${text}`,
      });
      return;
    }

    const data = await res.json();

    // Verify response structure
    const hasDataArray = Array.isArray(data.d);
    const hasNextPage = "np" in data;

    if (hasDataArray) {
      logResult({
        name: "Trading Fills",
        status: "pass",
        details: `Got ${data.d.length} fills, has np cursor: ${hasNextPage}`,
      });

      // If there are fills, verify structure
      if (data.d.length > 0) {
        const fill = data.d[0];
        const fillFields = ["at", "mkt", "acc", "oid", "t", "l", "s", "f"];
        const presentFields = fillFields.filter((f) => f in fill);
        log(`  Fill structure: ${presentFields.join(", ")}`);
      }
    } else {
      logResult({
        name: "Trading Fills",
        status: "fail",
        details: "Response missing 'd' array",
      });
    }
  } catch (e: any) {
    logResult({
      name: "Trading Fills",
      status: "fail",
      error: e.message,
    });
  }
}

// ============================================================================
// Test 3: Market Data WebSocket
// ============================================================================

async function testMarketDataWebSocket(): Promise<void> {
  log("\n=== Test 3: Market Data WebSocket ===");
  log(`Connecting to ${WS_URL}/ws/v1/market-data`);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      logResult({
        name: "WebSocket Connect",
        status: "fail",
        error: "Connection timeout (10s)",
      });
      ws.close();
      resolve();
    }, 10000);

    const ws = new WebSocket(`${WS_URL}/ws/v1/market-data`);
    let subscriptionSent = false;
    let snapshotReceived = false;
    let updateReceived = false;

    ws.on("open", () => {
      logResult({
        name: "WebSocket Connect",
        status: "pass",
      });

      // Subscribe to BTC order book
      log("Subscribing to order-book@16 (BTC)");
      ws.send(
        JSON.stringify({
          mt: 5, // SubscriptionRequest
          subs: [{ stream: "order-book@16", subscribe: true }],
        })
      );
      subscriptionSent = true;
    });

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        const mt = msg.mt;

        if (mt === 6) {
          // SubscriptionResponse
          const sub = msg.subs?.[0];
          if (sub?.status?.code === 0 || sub?.sid) {
            logResult({
              name: "Subscription Response",
              status: "pass",
              details: `stream: ${sub.stream}, sid: ${sub.sid}`,
            });
          } else {
            logResult({
              name: "Subscription Response",
              status: "fail",
              details: `error: ${sub?.status?.error || "unknown"}`,
            });
          }
        } else if (mt === 15) {
          // L2BookSnapshot
          snapshotReceived = true;
          const bidCount = msg.bid?.length || 0;
          const askCount = msg.ask?.length || 0;

          // Verify structure
          let structureOk = true;
          if (msg.bid?.length > 0) {
            const level = msg.bid[0];
            structureOk = "p" in level && "s" in level && "o" in level;
          }

          logResult({
            name: "Order Book Snapshot",
            status: structureOk ? "pass" : "fail",
            details: `${bidCount} bids, ${askCount} asks, structure: ${structureOk ? "valid" : "invalid"}`,
          });

          // Wait a bit for update message, then close
          setTimeout(() => {
            if (!updateReceived) {
              logResult({
                name: "Order Book Update",
                status: "skip",
                details: "No update received in 3s (market may be quiet)",
              });
            }
            clearTimeout(timeout);
            ws.close();
            resolve();
          }, 3000);
        } else if (mt === 16) {
          // L2BookUpdate
          if (!updateReceived) {
            updateReceived = true;
            logResult({
              name: "Order Book Update",
              status: "pass",
              details: `mt: ${mt}`,
            });
          }
        } else if (mt === 100) {
          // Heartbeat - just note it
          log(`  Heartbeat received (block: ${msg.h})`);
        }
      } catch (e: any) {
        log(`  Failed to parse message: ${e.message}`);
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      logResult({
        name: "WebSocket Connect",
        status: "fail",
        error: err.message,
      });
      resolve();
    });

    ws.on("close", (code: number, reason: Buffer) => {
      clearTimeout(timeout);
      if (!snapshotReceived && subscriptionSent) {
        logResult({
          name: "Order Book Snapshot",
          status: "fail",
          details: `Connection closed before snapshot (code: ${code})`,
        });
      }
      resolve();
    });
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║            Perpl API Documentation Verification Tests          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const { account, privateKey } = getTestWallet();
  log(`Using wallet: ${account.address}`);

  // Test 1: Auth Flow
  const { authNonce, cookies, error: authError } = await testAuthFlow(account, privateKey);

  // Test 2: Authenticated Endpoint (only if auth succeeded)
  if (authNonce) {
    await testAuthenticatedEndpoint(authNonce, cookies || "");
  } else {
    log("\n=== Test 2: Authenticated Endpoint ===");
    logResult({
      name: "Trading Fills",
      status: "skip",
      details: `Auth required: ${authError}`,
    });
  }

  // Test 3: WebSocket (doesn't need auth)
  await testMarketDataWebSocket();

  // Summary
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                         Test Summary                           ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  console.log(`Total: ${results.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed} | ⏭️ Skipped: ${skipped}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter((r) => r.status === "fail")) {
      console.log(`  - ${r.name}: ${r.error || r.details}`);
    }
  }

  if (skipped > 0) {
    console.log("\nSkipped tests:");
    for (const r of results.filter((r) => r.status === "skip")) {
      console.log(`  - ${r.name}: ${r.details}`);
    }
  }

  // Exit with error if any tests failed
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
