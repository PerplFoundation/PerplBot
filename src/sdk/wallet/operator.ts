/**
 * Operator wallet operations
 * Hot wallet used for trading operations
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
import { Exchange, type OrderDesc, OrderType } from "../contracts/Exchange.js";
import type { ChainConfig } from "../config.js";

/**
 * Operator wallet for executing trades through DelegatedAccount
 * Can only call allowlisted Exchange functions
 */
export class OperatorWallet {
  public readonly address: Address;
  public readonly publicClient: PublicClient;
  public readonly walletClient: WalletClient;
  private exchange?: Exchange;
  private delegatedAccountAddress?: Address;

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
   * Create an OperatorWallet from a private key
   */
  static fromPrivateKey(
    privateKey: `0x${string}`,
    chainConfig: ChainConfig
  ): OperatorWallet {
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

    return new OperatorWallet(account.address, publicClient, walletClient);
  }

  /**
   * Connect to Exchange through a DelegatedAccount
   */
  connect(exchangeAddress: Address, delegatedAccountAddress: Address): Exchange {
    this.delegatedAccountAddress = delegatedAccountAddress;
    this.exchange = Exchange.withDelegatedAccount(
      exchangeAddress,
      delegatedAccountAddress,
      this.publicClient,
      this.walletClient
    );
    return this.exchange;
  }

  /**
   * Get the connected Exchange
   */
  getExchange(): Exchange {
    if (!this.exchange) {
      throw new Error("Not connected to Exchange. Call connect() first.");
    }
    return this.exchange;
  }

  /**
   * Get the DelegatedAccount address
   */
  getDelegatedAccountAddress(): Address {
    if (!this.delegatedAccountAddress) {
      throw new Error("Not connected to a DelegatedAccount. Call connect() first.");
    }
    return this.delegatedAccountAddress;
  }

  /**
   * Execute a single order
   */
  async execOrder(orderDesc: OrderDesc): Promise<Hash> {
    return this.getExchange().execOrder(orderDesc);
  }

  /**
   * Execute multiple orders
   */
  async execOrders(orderDescs: OrderDesc[], revertOnFail = true): Promise<Hash> {
    return this.getExchange().execOrders(orderDescs, revertOnFail);
  }

  /**
   * Open a long position
   */
  async openLong(params: {
    perpId: bigint;
    pricePNS: bigint;
    lotLNS: bigint;
    leverageHdths: bigint;
    postOnly?: boolean;
    fillOrKill?: boolean;
    immediateOrCancel?: boolean;
    expiryBlock?: bigint;
  }): Promise<Hash> {
    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId: params.perpId,
      orderType: OrderType.OpenLong,
      orderId: 0n,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      expiryBlock: params.expiryBlock ?? 0n,
      postOnly: params.postOnly ?? false,
      fillOrKill: params.fillOrKill ?? false,
      immediateOrCancel: params.immediateOrCancel ?? false,
      maxMatches: 0n,
      leverageHdths: params.leverageHdths,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    return this.execOrder(orderDesc);
  }

  /**
   * Open a short position
   */
  async openShort(params: {
    perpId: bigint;
    pricePNS: bigint;
    lotLNS: bigint;
    leverageHdths: bigint;
    postOnly?: boolean;
    fillOrKill?: boolean;
    immediateOrCancel?: boolean;
    expiryBlock?: bigint;
  }): Promise<Hash> {
    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId: params.perpId,
      orderType: OrderType.OpenShort,
      orderId: 0n,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      expiryBlock: params.expiryBlock ?? 0n,
      postOnly: params.postOnly ?? false,
      fillOrKill: params.fillOrKill ?? false,
      immediateOrCancel: params.immediateOrCancel ?? false,
      maxMatches: 0n,
      leverageHdths: params.leverageHdths,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    return this.execOrder(orderDesc);
  }

  /**
   * Close a long position
   */
  async closeLong(params: {
    perpId: bigint;
    pricePNS: bigint;
    lotLNS: bigint;
    postOnly?: boolean;
    fillOrKill?: boolean;
    immediateOrCancel?: boolean;
    expiryBlock?: bigint;
  }): Promise<Hash> {
    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId: params.perpId,
      orderType: OrderType.CloseLong,
      orderId: 0n,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      expiryBlock: params.expiryBlock ?? 0n,
      postOnly: params.postOnly ?? false,
      fillOrKill: params.fillOrKill ?? false,
      immediateOrCancel: params.immediateOrCancel ?? false,
      maxMatches: 0n,
      leverageHdths: 100n, // Not used for close
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    return this.execOrder(orderDesc);
  }

  /**
   * Close a short position
   */
  async closeShort(params: {
    perpId: bigint;
    pricePNS: bigint;
    lotLNS: bigint;
    postOnly?: boolean;
    fillOrKill?: boolean;
    immediateOrCancel?: boolean;
    expiryBlock?: bigint;
  }): Promise<Hash> {
    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId: params.perpId,
      orderType: OrderType.CloseShort,
      orderId: 0n,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      expiryBlock: params.expiryBlock ?? 0n,
      postOnly: params.postOnly ?? false,
      fillOrKill: params.fillOrKill ?? false,
      immediateOrCancel: params.immediateOrCancel ?? false,
      maxMatches: 0n,
      leverageHdths: 100n, // Not used for close
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    return this.execOrder(orderDesc);
  }

  /**
   * Cancel an order
   */
  async cancelOrder(perpId: bigint, orderId: bigint): Promise<Hash> {
    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId,
      orderType: OrderType.Cancel,
      orderId,
      pricePNS: 0n,
      lotLNS: 0n,
      expiryBlock: 0n,
      postOnly: false,
      fillOrKill: false,
      immediateOrCancel: false,
      maxMatches: 0n,
      leverageHdths: 0n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    return this.execOrder(orderDesc);
  }

  /**
   * Modify an existing order
   */
  async modifyOrder(params: {
    perpId: bigint;
    orderId: bigint;
    pricePNS: bigint;
    lotLNS: bigint;
    leverageHdths?: bigint;
    postOnly?: boolean;
    expiryBlock?: bigint;
  }): Promise<Hash> {
    const orderDesc: OrderDesc = {
      orderDescId: 0n,
      perpId: params.perpId,
      orderType: OrderType.Change,
      orderId: params.orderId,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      expiryBlock: params.expiryBlock ?? 0n,
      postOnly: params.postOnly ?? false,
      fillOrKill: false,
      immediateOrCancel: false,
      maxMatches: 0n,
      leverageHdths: params.leverageHdths ?? 100n,
      lastExecutionBlock: 0n,
      amountCNS: 0n,
    };

    return this.execOrder(orderDesc);
  }

  /**
   * Deposit collateral to account
   */
  async depositCollateral(amountCNS: bigint): Promise<Hash> {
    return this.getExchange().depositCollateral(amountCNS);
  }

  /**
   * Increase position collateral
   */
  async increasePositionCollateral(
    perpId: bigint,
    amountCNS: bigint
  ): Promise<Hash> {
    return this.getExchange().increasePositionCollateral(perpId, amountCNS);
  }

  /**
   * Request decrease position collateral
   */
  async requestDecreasePositionCollateral(perpId: bigint): Promise<Hash> {
    return this.getExchange().requestDecreasePositionCollateral(perpId);
  }

  /**
   * Decrease position collateral
   */
  async decreasePositionCollateral(
    perpId: bigint,
    amountCNS: bigint,
    clampToMaximum = false
  ): Promise<Hash> {
    return this.getExchange().decreasePositionCollateral(
      perpId,
      amountCNS,
      clampToMaximum
    );
  }

  /**
   * Get ETH balance (for gas)
   */
  async getEthBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.address });
  }

  // ============ Market Orders (IOC) ============

  /**
   * Market buy (open long with IOC)
   * Uses a high price to ensure fill
   */
  async marketOpenLong(params: {
    perpId: bigint;
    lotLNS: bigint;
    leverageHdths: bigint;
    maxPricePNS: bigint; // Maximum price willing to pay
  }): Promise<Hash> {
    return this.openLong({
      perpId: params.perpId,
      pricePNS: params.maxPricePNS,
      lotLNS: params.lotLNS,
      leverageHdths: params.leverageHdths,
      immediateOrCancel: true,
    });
  }

  /**
   * Market sell (open short with IOC)
   * Uses a low price to ensure fill
   */
  async marketOpenShort(params: {
    perpId: bigint;
    lotLNS: bigint;
    leverageHdths: bigint;
    minPricePNS: bigint; // Minimum price willing to accept
  }): Promise<Hash> {
    return this.openShort({
      perpId: params.perpId,
      pricePNS: params.minPricePNS,
      lotLNS: params.lotLNS,
      leverageHdths: params.leverageHdths,
      immediateOrCancel: true,
    });
  }

  /**
   * Market close long (with IOC)
   */
  async marketCloseLong(params: {
    perpId: bigint;
    lotLNS: bigint;
    minPricePNS: bigint; // Minimum price willing to accept
  }): Promise<Hash> {
    return this.closeLong({
      perpId: params.perpId,
      pricePNS: params.minPricePNS,
      lotLNS: params.lotLNS,
      immediateOrCancel: true,
    });
  }

  /**
   * Market close short (with IOC)
   */
  async marketCloseShort(params: {
    perpId: bigint;
    lotLNS: bigint;
    maxPricePNS: bigint; // Maximum price willing to pay
  }): Promise<Hash> {
    return this.closeShort({
      perpId: params.perpId,
      pricePNS: params.maxPricePNS,
      lotLNS: params.lotLNS,
      immediateOrCancel: true,
    });
  }

  // ============ Reduce Position ============

  /**
   * Reduce a long position by a specific amount
   */
  async reduceLong(params: {
    perpId: bigint;
    lotLNS: bigint;
    pricePNS: bigint;
    immediateOrCancel?: boolean;
  }): Promise<Hash> {
    return this.closeLong({
      perpId: params.perpId,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      immediateOrCancel: params.immediateOrCancel ?? false,
    });
  }

  /**
   * Reduce a short position by a specific amount
   */
  async reduceShort(params: {
    perpId: bigint;
    lotLNS: bigint;
    pricePNS: bigint;
    immediateOrCancel?: boolean;
  }): Promise<Hash> {
    return this.closeShort({
      perpId: params.perpId,
      pricePNS: params.pricePNS,
      lotLNS: params.lotLNS,
      immediateOrCancel: params.immediateOrCancel ?? false,
    });
  }

  // ============ Add Margin ============

  /**
   * Add margin to a position
   */
  async addMargin(perpId: bigint, amountCNS: bigint): Promise<Hash> {
    return this.increasePositionCollateral(perpId, amountCNS);
  }
}
