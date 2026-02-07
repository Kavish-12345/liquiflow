import { ethers } from 'ethers';

export interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

// Action IDs from Uniswap V4 PositionManager
const Actions = {
  INCREASE_LIQUIDITY: '00',
  DECREASE_LIQUIDITY: '01',
  MINT_POSITION: '02',
  BURN_POSITION: '03',
  SWAP: '04',
  // ...other actions
  SETTLE: '0b',
  SETTLE_ALL: '0c',
  SETTLE_PAIR: '0d', // Used by Forge script
  TAKE: '0e',
  TAKE_ALL: '0f',
  TAKE_PORTION: '10',
  SETTLE_TAKE_PAIR: '11',
  TAKE_PAIR: '12',
  CLOSE_CURRENCY: '13',
  CLEAR_OR_TAKE: '14', // Used by Forge script
  SWEEP: '15',
};

/**
 * Creates the parameters for minting liquidity - MATCHES FORGE SCRIPT EXACTLY
 */
export function createMintLiquidityParams(
  poolKey: PoolKey,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  amount0Max: bigint,
  amount1Max: bigint,
  recipient: string,
  hookData: string
): { actions: string; params: string[] } {
  
  // CRITICAL: Use the same actions as Forge script
  // Forge uses: MINT_POSITION + SETTLE_PAIR + CLEAR_OR_TAKE + CLEAR_OR_TAKE
  const actions = '0x' + Actions.MINT_POSITION + Actions.SETTLE_PAIR + Actions.CLEAR_OR_TAKE + Actions.CLEAR_OR_TAKE;
  
  console.log('Creating params with actions:', actions);

  const params = [];

  // 1. MINT_POSITION params
  const mintParams = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      'tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)',
      'int24',
      'int24',
      'uint256',
      'uint128',
      'uint128',
      'address',
      'bytes',
    ],
    [
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      recipient,
      hookData,
    ]
  );
  params.push(mintParams);

  // 2. SETTLE_PAIR params - settles both currencies at once
  // This is encoded as: [currency0, currency1]
  const settlePairParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address'],
    [poolKey.currency0, poolKey.currency1]
  );
  params.push(settlePairParams);

  // 3. CLEAR_OR_TAKE for currency0
  // Takes the currency from the Position Manager if there's a positive balance
  const clearOrTake0Params = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address'],
    [poolKey.currency0, recipient]
  );
  params.push(clearOrTake0Params);

  // 4. CLEAR_OR_TAKE for currency1
  const clearOrTake1Params = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address'],
    [poolKey.currency1, recipient]
  );
  params.push(clearOrTake1Params);

  console.log('Encoded params:', {
    mint: mintParams.slice(0, 66) + '...',
    settlePair: settlePairParams,
    clearOrTake0: clearOrTake0Params,
    clearOrTake1: clearOrTake1Params,
  });

  return { actions, params };
}

/**
 * Alternative implementation using simple SETTLE actions (if SETTLE_PAIR doesn't work)
 */
export function createMintLiquidityParamsSimple(
  poolKey: PoolKey,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  amount0Max: bigint,
  amount1Max: bigint,
  recipient: string,
  hookData: string
): { actions: string; params: string[] } {
  
  // Simple approach: MINT + SETTLE + SETTLE
  const actions = '0x' + Actions.MINT_POSITION + Actions.SETTLE + Actions.SETTLE;

  const params = [];

  // 1. MINT_POSITION params
  const mintParams = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      'tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)',
      'int24',
      'int24',
      'uint256',
      'uint128',
      'uint128',
      'address',
      'bytes',
    ],
    [
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      recipient,
      hookData,
    ]
  );
  params.push(mintParams);

  // 2. SETTLE currency0 - payerIsUser = true
  const settle0Params = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bool'],
    [poolKey.currency0, amount0Max, true]
  );
  params.push(settle0Params);

  // 3. SETTLE currency1 - payerIsUser = true  
  const settle1Params = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bool'],
    [poolKey.currency1, amount1Max, true]
  );
  params.push(settle1Params);

  return { actions, params };
}