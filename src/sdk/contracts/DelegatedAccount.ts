/**
 * DelegatedAccount contract wrapper
 * Handles deployment and management of owner/operator delegated accounts
 */

import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  parseEventLogs,
} from "viem";
import { DelegatedAccountAbi, ERC20Abi } from "./abi.js";

/**
 * DelegatedAccount implementation bytecode
 * This is the compiled bytecode of the DelegatedAccount.sol contract
 * In production, you would deploy this once and reuse the implementation address
 */
export const DELEGATED_ACCOUNT_IMPLEMENTATION_BYTECODE =
  "0x" as `0x${string}`; // Placeholder - use deployed implementation

/**
 * ERC1967 Proxy bytecode (OpenZeppelin)
 * Standard proxy that delegates all calls to implementation
 */
export const ERC1967_PROXY_BYTECODE =
  "0x60806040526040516104ec3803806104ec833981016040819052610022916102e9565b61002e82826000610035565b50506103ff565b61003e8361006b565b60008251118061004b5750805b156100665761006483836100ab60201b6100291760201c565b505b505050565b610074816100d7565b6040516001600160a01b038216907fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b90600090a250565b60606100d0838360405180606001604052806027815260200161c5c0602791396101ad565b9392505050565b6001600160a01b0381163b6101495760405162461bcd60e51b815260206004820152602d60248201527f455243313936373a206e657720696d706c656d656e746174696f6e206973206e60448201526c1bdd08184818dbdb9d1c9858dd609a1b60648201526084015b60405180910390fd5b7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b0319166001600160a01b0392909216919091179055565b6060600080856001600160a01b0316856040516101ca91906103b0565b600060405180830381855af49150503d8060008114610205576040519150601f19603f3d011682016040523d82523d6000602084013e61020a565b606091505b50909250905061021c8683838761022660201b60201c565b9695505050505050565b6060831561029357825160000361028c576001600160a01b0385163b61028c5760405162461bcd60e51b815260206004820152601d60248201527f416464726573733a2063616c6c20746f206e6f6e2d636f6e74726163740000006044820152606401610140565b508161029d565b61029d83836102a5565b949350505050565b8151156102b55781518083602001fd5b8060405162461bcd60e51b815260040161014091906103cc565b634e487b7160e01b600052604160045260246000fd5b600080604083850312156102fc57600080fd5b82516001600160a01b038116811461031357600080fd5b60208401519092506001600160401b038082111561033057600080fd5b818501915085601f83011261034457600080fd5b815181811115610356576103566102cf565b604051601f8201601f19908116603f0116810190838211818310171561037e5761037e6102cf565b8160405282815288602084870101111561039757600080fd5b6103a88360208301602088016103cc565b80955050505050509250929050565b600082516103c98184602087016103cc565b9190910192915050565b60005b838110156103ee5781810151838201526020016103d6565b50506000910152565b600060208284031215610400576103cc565b81516100d0816102cf56fe416464726573733a206c6f772d6c6576656c2064656c65676174652063616c6c206661696c6564a2646970667358221220" as `0x${string}`;

export interface DelegatedAccountConfig {
  owner: Address;
  operator: Address;
  exchange: Address;
  collateralToken: Address;
}

export interface DelegatedAccountState {
  owner: Address;
  accountId: bigint;
  exchange: Address;
  collateralToken: Address;
}

/**
 * DelegatedAccount contract wrapper
 */
export class DelegatedAccount {
  public readonly address: Address;
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;

  constructor(
    address: Address,
    publicClient: PublicClient,
    walletClient?: WalletClient
  ) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }

  /**
   * Deploy a new DelegatedAccount proxy
   * @param implementationAddress Address of the DelegatedAccount implementation
   * @param config Configuration for the delegated account
   * @param publicClient Public client for reading
   * @param walletClient Wallet client for deployment
   * @returns Deployed DelegatedAccount instance
   */
  static async deploy(
    implementationAddress: Address,
    config: DelegatedAccountConfig,
    publicClient: PublicClient,
    walletClient: WalletClient
  ): Promise<{ delegatedAccount: DelegatedAccount; txHash: Hash }> {
    const account = walletClient.account;
    if (!account) {
      throw new Error("Wallet client must have an account");
    }

    // Encode initialization data
    const initData = encodeFunctionData({
      abi: DelegatedAccountAbi,
      functionName: "initialize",
      args: [
        config.owner,
        config.operator,
        config.exchange,
        config.collateralToken,
      ],
    });

    // Deploy ERC1967 proxy with implementation and init data
    const deployData = encodeDeployData({
      abi: [
        {
          type: "constructor",
          inputs: [
            { name: "implementation", type: "address" },
            { name: "_data", type: "bytes" },
          ],
          stateMutability: "payable",
        },
      ],
      bytecode: ERC1967_PROXY_BYTECODE,
      args: [implementationAddress, initData],
    });

    // Get nonce for address calculation
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
    });

    // Calculate deployed address
    const proxyAddress = getContractAddress({
      from: account.address,
      nonce: BigInt(nonce),
    });

    // Send deployment transaction
    const txHash = await walletClient.sendTransaction({
      account,
      data: deployData,
      chain: walletClient.chain,
    });

    // Wait for confirmation
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      delegatedAccount: new DelegatedAccount(
        proxyAddress,
        publicClient,
        walletClient
      ),
      txHash,
    };
  }

  /**
   * Connect to an existing DelegatedAccount
   */
  static connect(
    address: Address,
    publicClient: PublicClient,
    walletClient?: WalletClient
  ): DelegatedAccount {
    return new DelegatedAccount(address, publicClient, walletClient);
  }

  // ============ Read Functions ============

  /**
   * Get the owner address
   */
  async getOwner(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "owner",
    }) as Promise<Address>;
  }

  /**
   * Check if an address is an operator
   */
  async isOperator(address: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "isOperator",
      args: [address],
    }) as Promise<boolean>;
  }

  /**
   * Get the exchange address
   */
  async getExchange(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "exchange",
    }) as Promise<Address>;
  }

  /**
   * Get the collateral token address
   */
  async getCollateralToken(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "collateralToken",
    }) as Promise<Address>;
  }

  /**
   * Get the exchange account ID
   */
  async getAccountId(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "accountId",
    }) as Promise<bigint>;
  }

  /**
   * Check if a function selector is allowed for operators
   */
  async isOperatorAllowed(selector: `0x${string}`): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "operatorAllowlist",
      args: [selector],
    }) as Promise<boolean>;
  }

  /**
   * Get the collateral token balance of this contract
   */
  async getCollateralBalance(): Promise<bigint> {
    const token = await this.getCollateralToken();
    return this.publicClient.readContract({
      address: token,
      abi: ERC20Abi,
      functionName: "balanceOf",
      args: [this.address],
    }) as Promise<bigint>;
  }

  /**
   * Get full state of the delegated account
   */
  async getState(): Promise<DelegatedAccountState> {
    const [owner, accountId, exchange, collateralToken] = await Promise.all([
      this.getOwner(),
      this.getAccountId(),
      this.getExchange(),
      this.getCollateralToken(),
    ]);

    return { owner, accountId, exchange, collateralToken };
  }

  // ============ Owner Functions ============

  private ensureWalletClient(): WalletClient {
    if (!this.walletClient) {
      throw new Error("Wallet client required for write operations");
    }
    return this.walletClient;
  }

  /**
   * Add an operator (owner only)
   */
  async addOperator(operatorAddress: Address): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "addOperator",
      args: [operatorAddress],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Remove an operator (owner only)
   */
  async removeOperator(operatorAddress: Address): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "removeOperator",
      args: [operatorAddress],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Update operator allowlist (owner only)
   */
  async setOperatorAllowlist(
    selector: `0x${string}`,
    allowed: boolean
  ): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "setOperatorAllowlist",
      args: [selector, allowed],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Create an exchange account with initial deposit (owner only)
   * Contract must have collateral tokens before calling
   */
  async createAccount(amount: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "createAccount",
      args: [amount],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Withdraw collateral from exchange to owner (owner only)
   */
  async withdrawCollateral(amount: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "withdrawCollateral",
      args: [amount],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Rescue ERC20 tokens from contract (owner only)
   */
  async rescueTokens(token: Address, amount: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "rescueTokens",
      args: [token, amount],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Set exchange approval for collateral token (owner only)
   */
  async setExchangeApproval(amount: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "setExchangeApproval",
      args: [amount],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Parse AccountCreated events from a transaction receipt
   */
  parseAccountCreatedEvent(
    logs: readonly { topics: readonly string[]; data: string }[]
  ): bigint | null {
    const parsed = parseEventLogs({
      abi: DelegatedAccountAbi,
      eventName: "AccountCreated",
      logs: logs as any,
    });

    if (parsed.length > 0) {
      return parsed[0].args.accountId;
    }
    return null;
  }
}
