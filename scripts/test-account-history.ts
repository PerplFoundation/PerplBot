#!/usr/bin/env npx tsx
/**
 * Test /api/v1/trading/account-history endpoint
 */

import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { monadTestnet } from "../src/sdk/config.js";

config();

const API_URL = "https://testnet.perpl.xyz/api";
const CHAIN_ID = 10143;

async function main() {
  const privateKey = process.env.OWNER_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    console.error("OWNER_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log("Wallet:", account.address);

  // Step 1: Get payload
  console.log("\n1. Getting auth payload...");
  const payloadRes = await fetch(`${API_URL}/v1/auth/payload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chain_id: CHAIN_ID, address: account.address }),
  });
  const payload = await payloadRes.json();
  console.log("   Payload received, nonce:", payload.nonce?.slice(0, 20) + "...");

  // Step 2: Sign
  console.log("\n2. Signing SIWE message...");
  const walletClient = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(),
  });
  const signature = await walletClient.signMessage({ message: payload.message });
  console.log("   Signature:", signature.slice(0, 30) + "...");

  // Step 3: Connect
  console.log("\n3. Authenticating...");
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
    console.log("   Access code required (HTTP 418) - wallet not whitelisted");
    return;
  }

  if (!connectRes.ok) {
    console.log("   Auth failed:", connectRes.status, await connectRes.text());
    return;
  }

  const auth = await connectRes.json();
  const cookies = connectRes.headers.getSetCookie?.()?.map(c => c.split(";")[0]).join("; ") || "";
  console.log("   Auth nonce:", auth.nonce?.slice(0, 20) + "...");
  console.log("   Cookies:", cookies ? "received" : "none");

  // Step 4: Get account history
  console.log("\n4. Fetching /api/v1/trading/account-history...");
  const historyRes = await fetch(`${API_URL}/v1/trading/account-history?count=20`, {
    headers: {
      "X-Auth-Nonce": auth.nonce,
      "Cookie": cookies,
    },
  });

  console.log("   Status:", historyRes.status);

  if (historyRes.status === 404) {
    console.log("   No account history (HTTP 404 - account has no events)");
    return;
  }

  if (!historyRes.ok) {
    console.log("   Error:", await historyRes.text());
    return;
  }

  const history = await historyRes.json();
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    Account History Response                    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log("\nItems:", history.d?.length || 0);
  console.log("Next page cursor:", history.np ? `"${history.np.slice(0, 20)}..."` : "none");

  if (history.d?.length > 0) {
    const eventTypes: Record<number, string> = {
      0: "Unspecified",
      1: "Deposit",
      2: "Withdrawal",
      3: "IncreasePositionCollateral",
      4: "Settlement",
      5: "Liquidation",
      6: "TransferToProtocol",
      7: "TransferFromProtocol",
      8: "Funding",
      9: "Deleveraging",
      10: "Unwinding",
      11: "PositionCollateralDecreased",
    };

    console.log("\n┌─────────────────────────────────────────────────────────────────┐");
    console.log("│ Event Type                  │ Amount (USD) │ Balance │ Market  │");
    console.log("├─────────────────────────────┼──────────────┼─────────┼─────────┤");

    for (const event of history.d.slice(0, 10)) {
      const typeName = eventTypes[event.et] || `Type${event.et}`;
      const amount = (Number(event.a) / 1_000_000).toFixed(2);
      const balance = (Number(event.b) / 1_000_000).toFixed(2);
      const market = event.m ? String(event.m).padEnd(7) : "N/A    ";
      console.log(`│ ${typeName.padEnd(27)} │ ${amount.padStart(12)} │ ${balance.padStart(7)} │ ${market} │`);
    }
    console.log("└─────────────────────────────────────────────────────────────────┘");

    if (history.d.length > 10) {
      console.log(`\n... and ${history.d.length - 10} more events`);
    }
  }

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                      Raw Response Sample                       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  if (history.d?.[0]) {
    console.log(JSON.stringify(history.d[0], null, 2));
  } else {
    console.log("No events to display");
  }
}

main().catch(console.error);
