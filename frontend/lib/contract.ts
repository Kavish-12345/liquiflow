import { ethers } from 'ethers';

export interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

export const DEPLOYMENTS = {
  11155111: { // Ethereum Sepolia
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
    positionManager: '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4',
    hook: '0xABa7EC5298eb6D179926B5bf605FEC3f2e1Cc500',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
    poolId: '0xd0efb6e7b0c5cf16a2c4428ede00ba10454dcb62ed15888b225d0394355fa832',
  },
84532: { // Base Sepolia
  poolManager: '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408',     // ✅ From Forge trace
  positionManager: '0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80',  // ✅ From Forge trace
  hook: '0x4d85A01C422Db1362FEcF9DF112dE42ea5a14500',
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  weth: '0x4200000000000000000000000000000000000006',
  poolId: '0x2dd0e0ad16888ae5666b27ef91dabf4aebad0c3cff2910a9b8ed9af2e098172d',
}
} as const;
export const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

export const POOL_MANAGER_ABI = [
  'function extsload(bytes32 slot) external view returns (bytes32)',
];

export const POSITION_MANAGER_ABI = [
  'function modifyLiquidities(bytes unlockData, uint256 deadline) external payable',
];

export function getPoolId(poolKey: PoolKey): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const encoded = abiCoder.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ]
  );
  return ethers.keccak256(encoded);
}