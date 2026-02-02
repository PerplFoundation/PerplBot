/**
 * Exchange contract wrapper
 * Handles trading operations on the Perpl DEX
 */

import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  encodeFunctionData,
} from "viem";
import { ExchangeAbi } from "./abi.js";

/**
 * Order type enum matching contract OrderDescEnum
 */
export enum OrderType {
  OpenLong = 0,
  OpenShort = 1,
  CloseLong = 2,
  CloseShort = 3,
  Cancel = 4,  // dex-sdk: 4 => Cancel
  Change = 5,  // dex-sdk: 5 => Change (modify order)
}

/**
 * Position type enum matching contract PositionEnum
 */
export enum PositionType {
  None = 0,
  Long = 1,
  Short = 2,
}

/**
 * Order descriptor for executing trades
 */
export interface OrderDesc {
  orderDescId: bigint;
  perpId: bigint;
  orderType: OrderType;
  orderId: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  expiryBlock: bigint;
  postOnly: boolean;
  fillOrKill: boolean;
  immediateOrCancel: boolean;
  maxMatches: bigint;
  leverageHdths: bigint;
  lastExecutionBlock: bigint;
  amountCNS: bigint;
}

/**
 * Order signature returned from execOrder
 */
export interface OrderSignature {
  perpId: bigint;
  orderId: bigint;
}

/**
 * Account information from the exchange
 */
export interface AccountInfo {
  accountId: bigint;
  balanceCNS: bigint;
  lockedBalanceCNS: bigint;
  frozen: number;
  accountAddr: Address;
  positions: {
    bank1: bigint;
    bank2: bigint;
    bank3: bigint;
    bank4: bigint;
  };
}

/**
 * Position information from the exchange
 */
export interface PositionInfo {
  accountId: bigint;
  nextNodeId: bigint;
  prevNodeId: bigint;
  positionType: PositionType;
  depositCNS: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  entryBlock: bigint;
  pnlCNS: bigint;
  deltaPnlCNS: bigint;
  premiumPnlCNS: bigint;
}

/**
 * Perpetual contract information
 */
export interface PerpetualInfo {
  name: string;
  symbol: string;
  priceDecimals: bigint;
  lotDecimals: bigint;
  markPNS: bigint;
  markTimestamp: bigint;
  oraclePNS: bigint;
  longOpenInterestLNS: bigint;
  shortOpenInterestLNS: bigint;
  fundingStartBlock: bigint;
  fundingRatePct100k: number;
  synthPerpPricePNS: bigint;
  paused: boolean;
  basePricePNS: bigint;
}

/**
 * Exchange contract wrapper
 * Can be used directly or through a DelegatedAccount
 */
export class Exchange {
  public readonly address: Address;
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly delegatedAccount?: Address;

  constructor(
    address: Address,
    publicClient: PublicClient,
    walletClient?: WalletClient,
    delegatedAccount?: Address
  ) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
    this.delegatedAccount = delegatedAccount;
  }

  /**
   * Create an Exchange instance that operates through a DelegatedAccount
   */
  static withDelegatedAccount(
    exchangeAddress: Address,
    delegatedAccountAddress: Address,
    publicClient: PublicClient,
    walletClient?: WalletClient
  ): Exchange {
    return new Exchange(
      exchangeAddress,
      publicClient,
      walletClient,
      delegatedAccountAddress
    );
  }

  /**
   * Get the address to call (DelegatedAccount if set, otherwise Exchange directly)
   */
  private getCallAddress(): Address {
    return this.delegatedAccount ?? this.address;
  }

  private ensureWalletClient(): WalletClient {
    if (!this.walletClient) {
      throw new Error("Wallet client required for write operations");
    }
    return this.walletClient;
  }

  // ============ Read Functions ============

  /**
   * Get account info by address
   */
  async getAccountByAddress(accountAddress: Address): Promise<AccountInfo> {
    const result = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getAccountByAddr",
      args: [accountAddress],
    })) as any;

    return {
      accountId: result.accountId,
      balanceCNS: result.balanceCNS,
      lockedBalanceCNS: result.lockedBalanceCNS,
      frozen: result.frozen,
      accountAddr: result.accountAddr,
      positions: result.positions,
    };
  }

  /**
   * Get account info by ID
   */
  async getAccountById(accountId: bigint): Promise<AccountInfo> {
    const result = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getAccountById",
      args: [accountId],
    })) as any;

    return {
      accountId: result.accountId,
      balanceCNS: result.balanceCNS,
      lockedBalanceCNS: result.lockedBalanceCNS,
      frozen: result.frozen,
      accountAddr: result.accountAddr,
      positions: result.positions,
    };
  }

  /**
   * Get position for an account on a perpetual
   */
  async getPosition(
    perpId: bigint,
    accountId: bigint
  ): Promise<{ position: PositionInfo; markPrice: bigint; markPriceValid: boolean }> {
    const [position, markPrice, markPriceValid] = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getPosition",
      args: [perpId, accountId],
    })) as [any, bigint, boolean];

    return {
      position: {
        accountId: position.accountId,
        nextNodeId: position.nextNodeId,
        prevNodeId: position.prevNodeId,
        positionType: position.positionType as PositionType,
        depositCNS: position.depositCNS,
        pricePNS: position.pricePNS,
        lotLNS: position.lotLNS,
        entryBlock: position.entryBlock,
        pnlCNS: position.pnlCNS,
        deltaPnlCNS: position.deltaPnlCNS,
        premiumPnlCNS: position.premiumPnlCNS,
      },
      markPrice,
      markPriceValid,
    };
  }

  /**
   * Get perpetual contract information
   */
  async getPerpetualInfo(perpId: bigint): Promise<PerpetualInfo> {
    const result = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getPerpetualInfo",
      args: [perpId],
    })) as any;

    return {
      name: result.name,
      symbol: result.symbol,
      priceDecimals: result.priceDecimals,
      lotDecimals: result.lotDecimals,
      markPNS: result.markPNS,
      markTimestamp: result.markTimestamp,
      oraclePNS: result.oraclePNS,
      longOpenInterestLNS: result.longOpenInterestLNS,
      shortOpenInterestLNS: result.shortOpenInterestLNS,
      fundingStartBlock: result.fundingStartBlock,
      fundingRatePct100k: result.fundingRatePct100k,
      synthPerpPricePNS: result.synthPerpPricePNS,
      paused: result.paused,
      basePricePNS: result.basePricePNS,
    };
  }

  /**
   * Get exchange info
   */
  async getExchangeInfo(): Promise<{
    balanceCNS: bigint;
    protocolBalanceCNS: bigint;
    recycleBalanceCNS: bigint;
    collateralDecimals: bigint;
    collateralToken: Address;
    verifierProxy: Address;
  }> {
    const [
      balanceCNS,
      protocolBalanceCNS,
      recycleBalanceCNS,
      collateralDecimals,
      collateralToken,
      verifierProxy,
    ] = (await this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getExchangeInfo",
    })) as [bigint, bigint, bigint, bigint, Address, Address];

    return {
      balanceCNS,
      protocolBalanceCNS,
      recycleBalanceCNS,
      collateralDecimals,
      collateralToken,
      verifierProxy,
    };
  }

  /**
   * Get taker fee for a perpetual
   */
  async getTakerFee(perpId: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getTakerFee",
      args: [perpId],
    }) as Promise<bigint>;
  }

  /**
   * Get maker fee for a perpetual
   */
  async getMakerFee(perpId: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: ExchangeAbi,
      functionName: "getMakerFee",
      args: [perpId],
    }) as Promise<bigint>;
  }

  // ============ Write Functions ============
  // These go through the DelegatedAccount if set

  /**
   * Execute a single order
   */
  async execOrder(orderDesc: OrderDesc): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    // Encode the function call
    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "execOrder",
      args: [
        {
          orderDescId: orderDesc.orderDescId,
          perpId: orderDesc.perpId,
          orderType: orderDesc.orderType,
          orderId: orderDesc.orderId,
          pricePNS: orderDesc.pricePNS,
          lotLNS: orderDesc.lotLNS,
          expiryBlock: orderDesc.expiryBlock,
          postOnly: orderDesc.postOnly,
          fillOrKill: orderDesc.fillOrKill,
          immediateOrCancel: orderDesc.immediateOrCancel,
          maxMatches: orderDesc.maxMatches,
          leverageHdths: orderDesc.leverageHdths,
          lastExecutionBlock: orderDesc.lastExecutionBlock,
          amountCNS: orderDesc.amountCNS,
        },
      ],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Execute multiple orders
   */
  async execOrders(orderDescs: OrderDesc[], revertOnFail = true): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "execOrders",
      args: [
        orderDescs.map((od) => ({
          orderDescId: od.orderDescId,
          perpId: od.perpId,
          orderType: od.orderType,
          orderId: od.orderId,
          pricePNS: od.pricePNS,
          lotLNS: od.lotLNS,
          expiryBlock: od.expiryBlock,
          postOnly: od.postOnly,
          fillOrKill: od.fillOrKill,
          immediateOrCancel: od.immediateOrCancel,
          maxMatches: od.maxMatches,
          leverageHdths: od.leverageHdths,
          lastExecutionBlock: od.lastExecutionBlock,
          amountCNS: od.amountCNS,
        })),
        revertOnFail,
      ],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Deposit collateral to account
   */
  async depositCollateral(amountCNS: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "depositCollateral",
      args: [amountCNS],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Increase position collateral
   */
  async increasePositionCollateral(
    perpId: bigint,
    amountCNS: bigint
  ): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "increasePositionCollateral",
      args: [perpId, amountCNS],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Request decrease position collateral (starts the timelock)
   */
  async requestDecreasePositionCollateral(perpId: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "requestDecreasePositionCollateral",
      args: [perpId],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Decrease position collateral (after timelock)
   */
  async decreasePositionCollateral(
    perpId: bigint,
    amountCNS: bigint,
    clampToMaximum = false
  ): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "decreasePositionCollateral",
      args: [perpId, amountCNS, clampToMaximum],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }

  /**
   * Allow or disallow order forwarding for this account
   */
  async allowOrderForwarding(allow: boolean): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    const callAddress = this.getCallAddress();

    const data = encodeFunctionData({
      abi: ExchangeAbi,
      functionName: "allowOrderForwarding",
      args: [allow],
    });

    return walletClient.sendTransaction({
      account,
      to: callAddress,
      data,
      chain: walletClient.chain,
    });
  }
}
