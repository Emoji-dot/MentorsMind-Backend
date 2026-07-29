#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, contract, contractimpl, symbol_short};

#[contract]
pub struct MockAmmContract;

#[contractimpl]
impl MockAmmContract {
    pub fn get_price(env: Env) -> (i128, u64) {
        let price: i128 = env.storage().instance().get(&symbol_short!("PRICE")).unwrap_or(7_500_000);
        let timestamp: u64 = env.storage().instance().get(&symbol_short!("TIME")).unwrap_or(0);
        (price, timestamp)
    }

    pub fn set_data(env: Env, price: i128, timestamp: u64) {
        env.storage().instance().set(&symbol_short!("PRICE"), &price);
        env.storage().instance().set(&symbol_short!("TIME"), &timestamp);
    }
}

#[contract]
pub struct MockPanicAmmContract;

#[contractimpl]
impl MockPanicAmmContract {
    pub fn get_price(_env: Env) -> (i128, u64) {
        panic!("Simulated AMM failure");
    }
}

fn setup_escrow(env: &Env) -> (Address, EscrowContractClient<'static>) {
    let admin = Address::generate(env);
    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(env, &contract_id);
    
    // Initialize escrow contract
    let treasury = Address::generate(env);
    let approved_tokens = soroban_sdk::Vec::new(env);
    client.initialize(&admin, &treasury, &500, &approved_tokens, &0);
    
    // By default, set ORACLE_MAX_AGE to something reasonable, e.g. 300
    // We can't set it via client unless there's a function, but the code falls back to 300
    (admin, client)
}

#[test]
fn test_dynamic_fee_tiers() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (admin, client) = setup_escrow(&env);
    
    // Register mock AMM
    let amm_id = env.register_contract(None, MockAmmContract);
    let amm_client = MockAmmContractClient::new(&env, &amm_id);
    
    client.set_liquidity_pool(&amm_id);
    client.set_dynamic_fee_enabled(&true);
    
    let now = 1000;
    env.ledger().with_mut(|li| li.timestamp = now);
    
    // Tier 1: Price < $0.10 -> 500 bps
    amm_client.set_data(&900_000, &now); // $0.09
    // Clear cache by updating ledger sequence
    env.ledger().with_mut(|li| li.sequence += 1);
    let fee1 = client.get_dynamic_fee();
    assert_eq!(fee1, 500);

    // Tier 2: Price $0.10–$0.50 -> 400 bps
    amm_client.set_data(&2_500_000, &now); // $0.25
    env.ledger().with_mut(|li| li.sequence += 1);
    let fee2 = client.get_dynamic_fee();
    assert_eq!(fee2, 400);
    
    // Tier 3: Price $0.50–$1.00 -> 300 bps
    amm_client.set_data(&7_500_000, &now); // $0.75
    env.ledger().with_mut(|li| li.sequence += 1);
    let fee3 = client.get_dynamic_fee();
    assert_eq!(fee3, 300);

    // Tier 4: Price >= $1.00 -> 200 bps
    amm_client.set_data(&15_000_000, &now); // $1.50
    env.ledger().with_mut(|li| li.sequence += 1);
    let fee4 = client.get_dynamic_fee();
    assert_eq!(fee4, 200);
}

#[test]
fn test_dynamic_fee_fallback_on_panic() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (admin, client) = setup_escrow(&env);
    
    // Register panic AMM
    let amm_id = env.register_contract(None, MockPanicAmmContract);
    client.set_liquidity_pool(&amm_id);
    client.set_dynamic_fee_enabled(&true);
    
    env.ledger().with_mut(|li| li.sequence = 1);
    
    // Should safely fallback to DEFAULT_FEE_BPS (which is 500 in the fallback of `_calculate_fee_from_price(0)`)
    // Because if it panics, `_fetch_mnt_usdc_price` returns 0
    let fee = client.get_dynamic_fee();
    assert_eq!(fee, 500); // DEFAULT_FEE_BPS is hardcoded as 500 effectively inside _calculate_fee_from_price(0)
}

#[test]
fn test_dynamic_fee_staleness() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (admin, client) = setup_escrow(&env);
    
    let amm_id = env.register_contract(None, MockAmmContract);
    let amm_client = MockAmmContractClient::new(&env, &amm_id);
    
    client.set_liquidity_pool(&amm_id);
    client.set_dynamic_fee_enabled(&true);
    
    let max_age = 300;
    let now = 1000;
    env.ledger().with_mut(|li| li.timestamp = now);
    
    // Set a price that would normally yield 200 bps
    // But set timestamp to older than max_age (e.g. 1000 - 301 = 699)
    amm_client.set_data(&15_000_000, &(now - max_age - 1));
    env.ledger().with_mut(|li| li.sequence = 1);
    
    let fee = client.get_dynamic_fee();
    // Since it's stale, it should fallback to DEFAULT_FEE_BPS (500)
    assert_eq!(fee, 500);
    
    // If we update the time to be just at the limit
    amm_client.set_data(&15_000_000, &(now - max_age));
    env.ledger().with_mut(|li| li.sequence = 2);
    let fee2 = client.get_dynamic_fee();
    // Should now return the valid price fee (200 bps)
    assert_eq!(fee2, 200);
}

#[test]
fn test_dynamic_fee_cache() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (admin, client) = setup_escrow(&env);
    
    let amm_id = env.register_contract(None, MockAmmContract);
    let amm_client = MockAmmContractClient::new(&env, &amm_id);
    
    client.set_liquidity_pool(&amm_id);
    client.set_dynamic_fee_enabled(&true);
    
    let now = 1000;
    env.ledger().with_mut(|li| li.timestamp = now);
    env.ledger().with_mut(|li| li.sequence = 1);
    
    // Set initial price to yield 200 bps
    amm_client.set_data(&15_000_000, &now);
    
    let fee = client.get_dynamic_fee();
    assert_eq!(fee, 200);
    
    // Change price significantly in the AMM, but don't change ledger sequence (simulating same ledger)
    amm_client.set_data(&900_000, &now);
    let cached_fee = client.get_dynamic_fee();
    
    // Should still return 200 bps due to caching!
    assert_eq!(cached_fee, 200);
    
    // Change ledger sequence, it should now fetch the new price
    env.ledger().with_mut(|li| li.sequence = 2);
    let new_fee = client.get_dynamic_fee();
    assert_eq!(new_fee, 500);
}
