# AMM/Oracle Contract Interface Requirements

The Escrow contract dynamically adjusts its platform fee based on the real-time price of MNT/USDC. To achieve this, it makes a cross-contract call to an Automated Market Maker (AMM) or Oracle contract.

## Required Interface

The contract deployed at the address specified via `set_liquidity_pool` **must** implement the following interface:

```rust
pub fn get_price(env: Env) -> (i128, u64)
```

### Return Values
The `get_price` function must return a tuple containing two elements:
1. `price` (`i128`): The current TWAP or spot price of MNT in terms of USDC, scaled by `10_000_000` (e.g., a price of $0.75 should be returned as `7_500_000`).
2. `updated_at` (`u64`): The UNIX timestamp (in seconds) representing the last time the price was updated. This is crucial for the staleness check.

### Staleness Check
The Escrow contract strictly enforces a staleness check based on the `updated_at` timestamp. 
If `current_ledger_timestamp - updated_at > ORACLE_MAX_AGE` (default: 300 seconds), the price is considered stale, and the Escrow contract will automatically fall back to the default static fee (500 bps).

### Error Handling & Fallback
The `get_price` call is executed using `env.try_invoke_contract`. If the AMM contract:
- Panics (e.g., due to insufficient liquidity to calculate a reliable TWAP)
- Returns a different type than `(i128, u64)`
- Is uninitialized or halted

The Escrow contract will gracefully catch the error and fall back to the `DEFAULT_FEE_BPS` (5%), ensuring that escrows can still be released securely even if the pricing pool is temporarily unavailable.

### Price Caching
To optimize gas usage and prevent excessive cross-contract calls, the Escrow contract caches the fetched price per ledger. If multiple escrows are released within the exact same ledger sequence, the cross-contract call to the AMM pool is only performed once.
