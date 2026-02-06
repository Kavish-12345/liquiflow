// lib/contracts.ts
import { ethers } from 'ethers';

export const DEPLOYMENTS = {
  11155111: { // Ethereum Sepolia
    hook: '0xABa7EC5298eb6D179926B5bf605FEC3f2e1Cc500',
    poolId: '0x2b9016b34a2ab49879a45d1adbcf6e589ae7d479b1a5cb22ed7a31fe8339f5e7',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
    positionManager: '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4', // PositionManager for production use
  },
  84532: { // Base Sepolia
    hook: '0x4d85A01C422Db1362FEcF9DF112dE42ea5a14500',
    poolId: '0xd995d8c2ab3c658024c216b6064f4e13075216400040100c5929e20c8e44ddfb',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    weth: '0x4200000000000000000000000000000000000006',
    poolManager: '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408',
    positionManager: '0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80', // PositionManager for production use
  },
} as const;

export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

export const POSITION_MANAGER_ABI = [
  'function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable',
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory)',
];

export const POOL_MANAGER_ABI = [
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function initialize((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) returns (int24)',
];

// Helper function to calculate pool ID from pool key
export function getPoolId(poolKey: {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
  );
  return ethers.keccak256(encoded);
}

export const HOOK_ABI = [
  'event LiquidityAdded(address indexed provider, bytes32 indexed poolId, int256 liquidityDelta, uint256 timestamp, uint256 chainId)',
  'event LiquidityRemoved(address indexed provider, bytes32 indexed poolId, int256 liquidityDelta, uint256 timestamp, uint256 chainId)',
];