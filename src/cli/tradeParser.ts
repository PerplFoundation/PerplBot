/**
 * Natural language trade parser for /perpl-type skill
 * Converts plain English trade descriptions into CLI command arguments
 */

export interface ParsedTrade {
  action: "open" | "close";
  market: "btc" | "eth" | "sol" | "mon" | "zec";
  side: "long" | "short";
  size: number;
  price: number | "market";
  leverage?: number;
  options: {
    ioc: boolean;
    postOnly: boolean;
  };
}

export interface ParseResult {
  success: boolean;
  trade?: ParsedTrade;
  command?: string;
  error?: string;
}

const MARKET_ALIASES: Record<string, ParsedTrade["market"]> = {
  btc: "btc",
  bitcoin: "btc",
  eth: "eth",
  ethereum: "eth",
  sol: "sol",
  solana: "sol",
  mon: "mon",
  monad: "mon",
  zec: "zec",
  zcash: "zec",
};

const LONG_KEYWORDS = ["long", "buy", "go long", "enter long"];
const SHORT_KEYWORDS = ["short", "sell", "go short", "enter short"];
const CLOSE_KEYWORDS = ["close", "exit", "close out", "flatten"];
const MARKET_ORDER_KEYWORDS = ["at market", "market order", "market price", "immediately"];
const POST_ONLY_KEYWORDS = ["maker only", "post only", "post-only", "maker"];

/**
 * Parse natural language trade description into structured trade object
 */
export function parseTrade(input: string): ParseResult {
  const text = input.toLowerCase().trim();

  if (!text) {
    return { success: false, error: "Empty input" };
  }

  try {
    const trade: Partial<ParsedTrade> = {
      options: { ioc: false, postOnly: false },
    };

    // Determine action (open vs close)
    trade.action = CLOSE_KEYWORDS.some((k) => text.includes(k)) ? "close" : "open";

    // Determine side (long vs short)
    const isLong = LONG_KEYWORDS.some((k) => text.includes(k));
    const isShort = SHORT_KEYWORDS.some((k) => text.includes(k));

    if (isLong && isShort) {
      return { success: false, error: "Ambiguous side: found both long and short keywords" };
    }
    if (!isLong && !isShort) {
      return { success: false, error: "Could not determine side (long/short)" };
    }
    trade.side = isLong ? "long" : "short";

    // Determine market
    let foundMarket: ParsedTrade["market"] | undefined;
    for (const [alias, market] of Object.entries(MARKET_ALIASES)) {
      // Match whole word only
      const regex = new RegExp(`\\b${alias}\\b`, "i");
      if (regex.test(text)) {
        foundMarket = market;
        break;
      }
    }
    if (!foundMarket) {
      return { success: false, error: "Could not determine market (btc, eth, sol, mon, zec)" };
    }
    trade.market = foundMarket;

    // Extract size - look for number followed by market name or standalone decimal
    const sizePatterns = [
      // "0.01 btc", "1 eth", "100 sol"
      new RegExp(`(\\d+\\.?\\d*)\\s*(?:${Object.keys(MARKET_ALIASES).join("|")})`, "i"),
      // "size 0.01", "size: 0.01"
      /size[:\s]+(\d+\.?\d*)/i,
      // standalone number before "at" (e.g., "long 0.01 at 78000")
      /(?:long|short|buy|sell)\s+(\d+\.?\d*)\s+(?:at|@)/i,
      // standalone number after side keyword
      /(?:long|short|buy|sell)\s+(\d+\.?\d*)/i,
    ];

    let size: number | undefined;
    for (const pattern of sizePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        size = parseFloat(match[1]);
        break;
      }
    }
    if (!size || isNaN(size) || size <= 0) {
      return { success: false, error: "Could not determine trade size" };
    }
    trade.size = size;

    // Extract price - look for "at $X", "@ X", "price X"
    const isMarketOrder = MARKET_ORDER_KEYWORDS.some((k) => text.includes(k));

    if (isMarketOrder) {
      trade.price = "market";
      trade.options!.ioc = true;
    } else {
      const pricePatterns = [
        // "at $78000", "at 78000", "@ 78000"
        /(?:at|@)\s*\$?(\d+\.?\d*)/i,
        // "price 78000", "price: 78000"
        /price[:\s]+\$?(\d+\.?\d*)/i,
      ];

      let price: number | undefined;
      for (const pattern of pricePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          price = parseFloat(match[1]);
          break;
        }
      }
      if (!price || isNaN(price) || price <= 0) {
        return { success: false, error: "Could not determine price (use 'at market' for market orders)" };
      }
      trade.price = price;
    }

    // Extract leverage (only for open orders)
    if (trade.action === "open") {
      const leveragePatterns = [
        // "10x leverage", "10x", "leverage 10"
        /(\d+\.?\d*)x\s*(?:leverage)?/i,
        /leverage[:\s]+(\d+\.?\d*)/i,
        /with\s+(\d+\.?\d*)x/i,
      ];

      let leverage: number | undefined;
      for (const pattern of leveragePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          leverage = parseFloat(match[1]);
          break;
        }
      }
      trade.leverage = leverage || 1; // Default to 1x if not specified
    }

    // Check for post-only
    if (POST_ONLY_KEYWORDS.some((k) => text.includes(k))) {
      trade.options!.postOnly = true;
      trade.options!.ioc = false; // Post-only and IOC are mutually exclusive
    }

    // Build command string
    const command = buildCommand(trade as ParsedTrade);

    return {
      success: true,
      trade: trade as ParsedTrade,
      command,
    };
  } catch (err) {
    return {
      success: false,
      error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Build CLI command string from parsed trade
 */
export function buildCommand(trade: ParsedTrade): string {
  const parts = ["trade", trade.action];

  parts.push("--perp", trade.market);
  parts.push("--side", trade.side);
  parts.push("--size", String(trade.size));

  if (trade.price === "market") {
    // For market orders, we need a price (will be used as limit)
    // The skill should fetch current price, but we'll use a placeholder
    parts.push("--price", "MARKET_PRICE");
  } else {
    parts.push("--price", String(trade.price));
  }

  if (trade.action === "open" && trade.leverage) {
    parts.push("--leverage", String(trade.leverage));
  }

  if (trade.options.ioc) {
    parts.push("--ioc");
  }

  if (trade.options.postOnly) {
    parts.push("--post-only");
  }

  return parts.join(" ");
}

/**
 * Format trade for display/confirmation
 */
export function formatTrade(trade: ParsedTrade): string {
  const action = trade.action.toUpperCase();
  const side = trade.side.toUpperCase();
  const market = trade.market.toUpperCase();
  const size = trade.size;
  const price = trade.price === "market" ? "MARKET" : `$${trade.price.toLocaleString()}`;
  const leverage = trade.leverage ? ` (${trade.leverage}x leverage)` : "";
  const flags = [];

  if (trade.options.ioc) flags.push("IOC");
  if (trade.options.postOnly) flags.push("POST-ONLY");

  const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";

  return `${action} ${side} ${size} ${market} @ ${price}${leverage}${flagStr}`;
}
