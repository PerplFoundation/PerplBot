/**
 * Owner wallet operations
 * Cold wallet used for deployment, withdrawals, and operator management
 */

import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DelegatedAccount, type DelegatedAccountConfig } from "../contracts/DelegatedAccount.js";
import { ERC20Abi } from "../contracts/abi.js";
import type { ChainConfig } from "../config.js";

/**
 * Owner wallet for managing DelegatedAccount
 * Used for privileged operations like deployment, withdrawals, and operator management
 */
export class OwnerWallet {
  public readonly address: Address;
  public readonly publicClient: PublicClient;
  public readonly walletClient: WalletClient;
  private delegatedAccount?: DelegatedAccount;

  private constructor(
    address: Address,
    publicClient: PublicClient,
    walletClient: WalletClient
  ) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }

  /**
   * Create an OwnerWallet from a private key
   */
  static fromPrivateKey(
    privateKey: `0x${string}`,
    chainConfig: ChainConfig
  ): OwnerWallet {
    const account = privateKeyToAccount(privateKey);

    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    return new OwnerWallet(account.address, publicClient, walletClient);
  }

  /**
   * Connect to an existing DelegatedAccount
   */
  connect(delegatedAccountAddress: Address): DelegatedAccount {
    this.delegatedAccount = DelegatedAccount.connect(
      delegatedAccountAddress,
      this.publicClient,
      this.walletClient
    );
    return this.delegatedAccount;
  }

  /**
   * Get the connected DelegatedAccount
   */
  getDelegatedAccount(): DelegatedAccount {
    if (!this.delegatedAccount) {
      throw new Error("Not connected to a DelegatedAccount. Call connect() first.");
    }
    return this.delegatedAccount;
  }

  /**
   * Deploy a new DelegatedAccount
   */
  async deploy(
    implementationAddress: Address,
    config: Omit<DelegatedAccountConfig, "owner">
  ): Promise<{ delegatedAccount: DelegatedAccount; txHash: Hash }> {
    const fullConfig: DelegatedAccountConfig = {
      ...config,
      owner: this.address,
    };

    const result = await DelegatedAccount.deploy(
      implementationAddress,
      fullConfig,
      this.publicClient,
      this.walletClient
    );

    this.delegatedAccount = result.delegatedAccount;
    return result;
  }

  /**
   * Add an operator to the DelegatedAccount
   */
  async addOperator(operatorAddress: Address): Promise<Hash> {
    return this.getDelegatedAccount().addOperator(operatorAddress);
  }

  /**
   * Remove an operator from the DelegatedAccount
   */
  async removeOperator(operatorAddress: Address): Promise<Hash> {
    return this.getDelegatedAccount().removeOperator(operatorAddress);
  }

  /**
   * Create an exchange account with initial deposit
   * First transfers tokens to DelegatedAccount, then calls createAccount
   */
  async createExchangeAccount(
    collateralToken: Address,
    amount: bigint
  ): Promise<{ transferHash: Hash; createHash: Hash }> {
    const delegatedAccount = this.getDelegatedAccount();
    const account = this.walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    // Transfer tokens to DelegatedAccount
    const transferHash = await this.walletClient.writeContract({
      address: collateralToken,
      abi: ERC20Abi,
      functionName: "transfer",
      args: [delegatedAccount.address, amount],
      account,
      chain: this.walletClient.chain,
    });

    // Wait for transfer confirmation
    await this.publicClient.waitForTransactionReceipt({ hash: transferHash });

    // Create account on exchange
    const createHash = await delegatedAccount.createAccount(amount);

    return { transferHash, createHash };
  }

  /**
   * Withdraw collateral from exchange to owner wallet
   */
  async withdrawCollateral(amount: bigint): Promise<Hash> {
    return this.getDelegatedAccount().withdrawCollateral(amount);
  }

  /**
   * Deposit additional collateral to the exchange account
   * Transfers tokens to DelegatedAccount, then calls depositCollateral
   */
  async depositCollateral(
    collateralToken: Address,
    amount: bigint
  ): Promise<{ transferHash: Hash; depositHash: Hash }> {
    const delegatedAccount = this.getDelegatedAccount();
    const account = this.walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    // Transfer tokens to DelegatedAccount
    const transferHash = await this.walletClient.writeContract({
      address: collateralToken,
      abi: ERC20Abi,
      functionName: "transfer",
      args: [delegatedAccount.address, amount],
      account,
      chain: this.walletClient.chain,
    });

    // Wait for transfer confirmation
    await this.publicClient.waitForTransactionReceipt({ hash: transferHash });

    // Encode and send depositCollateral call through DelegatedAccount
    const { encodeFunctionData } = await import("viem");
    const { ExchangeAbi } = await import("../contracts/abi.js");

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "depositCollateral",
      args: [amount],
    });

    const depositHash = await this.walletClient.sendTransaction({
      account,
      to: delegatedAccount.address,
      data,
      chain: this.walletClient.chain,
    });

    return { transferHash, depositHash };
  }

  /**
   * Get owner's balance of a token
   */
  async getTokenBalance(tokenAddress: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: tokenAddress,
      abi: ERC20Abi,
      functionName: "balanceOf",
      args: [this.address],
    }) as Promise<bigint>;
  }

  /**
   * Get ETH balance
   */
  async getEthBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.address });
  }

  /**
   * Rescue tokens stuck in DelegatedAccount
   */
  async rescueTokens(tokenAddress: Address, amount: bigint): Promise<Hash> {
    return this.getDelegatedAccount().rescueTokens(tokenAddress, amount);
  }

  /**
   * Update operator allowlist
   */
  async setOperatorAllowlist(
    selector: `0x${string}`,
    allowed: boolean
  ): Promise<Hash> {
    return this.getDelegatedAccount().setOperatorAllowlist(selector, allowed);
  }
}
