import { ethers } from 'ethers';

// Action types matching the PositionManager contract
export const ACTIONS = {
  MINT_POSITION: 0x00,
  INCREASE_LIQUIDITY: 0x01,
  DECREASE_LIQUIDITY: 0x02,
  BURN_POSITION: 0x03,
  SETTLE_PAIR: 0x09,
  TAKE_PAIR: 0x0a,
  CLOSE_CURRENCY: 0x0b,
  SWEEP: 0x0e,
};

export interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

function encodeMintParams(
  poolKey: PoolKey,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  amount0Max: bigint,
  amount1Max: bigint,
  owner: string,
  hookData: string = '0x'
) {
  // Encode the pool key
  const poolKeyEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)'],
    [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
  );

  // Encode mint parameters
  const paramsEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes'],
    [tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData]
  );

  return ethers.concat([poolKeyEncoded, paramsEncoded]);
}

function encodeSettleParams(currency: string, amount: bigint, payerIsUser: boolean) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bool'],
    [currency, amount, payerIsUser]
  );
}

function encodeTakeParams(currency: string, recipient: string, amount: bigint) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint256'],
    [currency, recipient, amount]
  );
}

function encodeActions(actions: number[]): string {
  return ethers.hexlify(new Uint8Array(actions));
}

export function createMintLiquidityParams(
  poolKey: PoolKey,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  amount0Max: bigint,
  amount1Max: bigint,
  owner: string,
  hookData: string = '0x'
): { actions: string; params: string[] } {
  const actions: number[] = [
    ACTIONS.MINT_POSITION,
    ACTIONS.SETTLE_PAIR,
    ACTIONS.SETTLE_PAIR,
  ];

  const params: string[] = [
    encodeMintParams(poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData),
    encodeSettleParams(poolKey.currency0, amount0Max, true),
    encodeSettleParams(poolKey.currency1, amount1Max, true),
  ];

  return {
    actions: encodeActions(actions),
    params,
  };
}