#!/usr/bin/env npx tsx
/**
 * Test all authentication-required API endpoints
 */

import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { monadTestnet } from "../src/sdk/config.js";

config();

const API_URL = "https://testnet.perpl.xyz/api";
const CHAIN_ID = 10143;

interface TestResult {
  endpoint: string;
  method: string;
  status: number;
  ok: boolean;
  details: string;
  sample?: any;
}

const results: TestResult[] = [];

async function authenticate() {
  const privateKey = process.env.OWNER_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    console.error("OWNER_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log("Wallet:", account.address);

  // Get payload
  const payloadRes = await fetch(`${API_URL}/v1/auth/payload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chain_id: CHAIN_ID, address: account.address }),
  });
  const payload = await payloadRes.json();

  // Sign
  const walletClient = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(),
  });
  const signature = await walletClient.signMessage({ message: payload.message });

  // Connect
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

  if (!connectRes.ok) {
    console.error("Auth failed:", connectRes.status);
    process.exit(1);
  }

  const auth = await connectRes.json();
  const cookies = connectRes.headers.getSetCookie?.()?.map(c => c.split(";")[0]).join("; ") || "";

  return { nonce: auth.nonce, cookies };
}

async function testEndpoint(
  name: string,
  method: string,
  url: string,
  nonce: string,
  cookies: string
): Promise<TestResult> {
  const headers: Record<string, string> = {
    "X-Auth-Nonce": nonce,
    "Cookie": cookies,
  };

  const res = await fetch(url, { method, headers });
  let details = "";
  let sample: any;

  if (res.ok) {
    const data = await res.json();
    if (Array.isArray(data.d)) {
      details = `${data.d.length} items${data.np ? ", has next page" : ""}`;
      if (data.d[0]) sample = data.d[0];
    } else if (data.code) {
      details = `code: ${data.code}`;
      sample = data;
    } else {
      details = "OK";
      sample = data;
    }
  } else if (res.status === 404) {
    details = "No data (empty)";
  } else {
    details = await res.text();
  }

  return {
    endpoint: name,
    method,
    status: res.status,
    ok: res.ok || res.status === 404, // 404 is valid for empty data
    details,
    sample,
  };
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║         Testing All Authentication-Required Endpoints          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("Authenticating...");
  const { nonce, cookies } = await authenticate();
  console.log("✅ Authentication successful\n");

  // Test all auth-required endpoints
  const endpoints = [
    // Trading History
    { name: "/api/v1/trading/account-history", method: "GET", url: `${API_URL}/v1/trading/account-history?count=5` },
    { name: "/api/v1/trading/fills", method: "GET", url: `${API_URL}/v1/trading/fills?count=5` },
    { name: "/api/v1/trading/order-history", method: "GET", url: `${API_URL}/v1/trading/order-history?count=5` },
    { name: "/api/v1/trading/position-history", method: "GET", url: `${API_URL}/v1/trading/position-history?count=5` },
    // Profile
    { name: "/api/v1/profile/ref-code", method: "GET", url: `${API_URL}/v1/profile/ref-code` },
    { name: "/api/v1/profile/contact-info", method: "GET", url: `${API_URL}/v1/profile/contact-info` },
  ];

  console.log("Testing endpoints...\n");

  for (const ep of endpoints) {
    const result = await testEndpoint(ep.name, ep.method, ep.url, nonce, cookies);
    results.push(result);
    const icon = result.ok ? "✅" : "❌";
    console.log(`${icon} ${ep.method} ${ep.name}`);
    console.log(`   Status: ${result.status} | ${result.details}`);
  }

  // Summary
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                           Summary                              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("| Endpoint | Method | Status | Result |");
  console.log("|----------|--------|--------|--------|");
  for (const r of results) {
    const icon = r.ok ? "✅" : "❌";
    console.log(`| ${r.endpoint} | ${r.method} | ${r.status} | ${icon} ${r.ok ? "Pass" : "Fail"} |`);
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  // Show sample responses
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                      Sample Responses                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  for (const r of results) {
    if (r.sample) {
      console.log(`--- ${r.endpoint} ---`);
      console.log(JSON.stringify(r.sample, null, 2));
      console.log();
    }
  }
}

main().catch(console.error);
