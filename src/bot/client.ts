/**
 * Shared API client for bot handlers
 * Provides API-enabled Exchange instances with logging
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  loadEnvConfig,
  Exchange,
  PerplApiClient,
  API_CONFIG,
  USE_API,
} from "../sdk/index.js";

// Singleton API client
let apiClient: PerplApiClient | null = null;
let isAuthenticated = false;

/**
 * Get or create the API client singleton
 */
export function getApiClient(): PerplApiClient {
  if (!apiClient) {
    console.log("[API] Creating PerplApiClient");
    console.log(`[API] Base URL: ${API_CONFIG.baseUrl}`);
    console.log(`[API] WS URL: ${API_CONFIG.wsUrl}`);
    console.log(`[API] USE_API: ${USE_API}`);
    apiClient = new PerplApiClient(API_CONFIG);
  }
  return apiClient;
}

/**
 * Authenticate the API client with the owner wallet
 */
export async function ensureAuthenticated(): Promise<void> {
  if (isAuthenticated && apiClient?.isAuthenticated()) {
    return;
  }

  const config = loadEnvConfig();
  if (!config.ownerPrivateKey) {
    throw new Error("OWNER_PRIVATE_KEY not set");
  }

  const client = getApiClient();
  const account = privateKeyToAccount(config.ownerPrivateKey as `0x${string}`);

  console.log(`[API] Authenticating wallet: ${account.address}`);

  const signMessage = async (message: string) => {
    return account.signMessage({ message });
  };

  await client.authenticate(account.address, signMessage);
  isAuthenticated = true;
  console.log("[API] Authentication successful");
}

/**
 * Create an API-enabled Exchange instance
 */
export async function createExchange(options?: {
  withWalletClient?: boolean;
  authenticate?: boolean;
}): Promise<Exchange> {
  const config = loadEnvConfig();
  const { withWalletClient = false, authenticate = true } = options ?? {};

  // Create public client
  const publicClient = createPublicClient({
    chain: config.chain.chain,
    transport: http(config.chain.rpcUrl),
  });

  // Create wallet client if needed
  let walletClient;
  if (withWalletClient && config.ownerPrivateKey) {
    const account = privateKeyToAccount(config.ownerPrivateKey as `0x${string}`);
    walletClient = createWalletClient({
      account,
      chain: config.chain.chain,
      transport: http(config.chain.rpcUrl),
    });
  }

  // Get API client and authenticate if enabled
  let client: PerplApiClient | undefined;
  if (USE_API) {
    client = getApiClient();
    if (authenticate) {
      try {
        await ensureAuthenticated();
      } catch (error) {
        console.log(`[API] Auth failed, using contract fallback: ${error}`);
        client = undefined;
      }
    }
  }

  const exchange = new Exchange(
    config.chain.exchangeAddress,
    publicClient,
    walletClient,
    undefined,
    client
  );

  console.log(`[API] Exchange created, API enabled: ${exchange.isApiEnabled()}`);

  return exchange;
}

/**
 * Clear authentication (for reconnection)
 */
export function clearAuth(): void {
  if (apiClient) {
    apiClient.clearAuth();
  }
  isAuthenticated = false;
  console.log("[API] Auth cleared");
}
