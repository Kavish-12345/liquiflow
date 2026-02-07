'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import toast, { Toaster } from 'react-hot-toast';
import Link from 'next/link';
import { DEPLOYMENTS, ERC20_ABI, POSITION_MANAGER_ABI, POOL_MANAGER_ABI } from '@/lib/contract';
import { createMintLiquidityParams, PoolKey } from '@/lib/positionManagerHelpers';

declare global {
  interface Window {
    ethereum?: any;
  }
}

const CHAIN_NAMES: { [key: number]: string } = {
  1: 'Ethereum',
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
  8453: 'Base',
};

// Helper functions for Uniswap V4 tick math (ported from Solidity)
function getSqrtPriceAtTick(tick: number): bigint {
  const absTick = Math.abs(tick);
  
  let ratio = (absTick & 0x1) !== 0 
    ? BigInt('0xfffcb933bd6fad37aa2d162d1a594001') 
    : BigInt('0x100000000000000000000000000000000');
    
  if ((absTick & 0x2) !== 0) ratio = (ratio * BigInt('0xfff97272373d413259a46990580e213a')) >> BigInt(128);
  if ((absTick & 0x4) !== 0) ratio = (ratio * BigInt('0xfff2e50f5f656932ef12357cf3c7fdcc')) >> BigInt(128);
  if ((absTick & 0x8) !== 0) ratio = (ratio * BigInt('0xffe5caca7e10e4e61c3624eaa0941cd0')) >> BigInt(128);
  if ((absTick & 0x10) !== 0) ratio = (ratio * BigInt('0xffcb9843d60f6159c9db58835c926644')) >> BigInt(128);
  if ((absTick & 0x20) !== 0) ratio = (ratio * BigInt('0xff973b41fa98c081472e6896dfb254c0')) >> BigInt(128);
  if ((absTick & 0x40) !== 0) ratio = (ratio * BigInt('0xff2ea16466c96a3843ec78b326b52861')) >> BigInt(128);
  if ((absTick & 0x80) !== 0) ratio = (ratio * BigInt('0xfe5dee046a99a2a811c461f1969c3053')) >> BigInt(128);
  if ((absTick & 0x100) !== 0) ratio = (ratio * BigInt('0xfcbe86c7900a88aedcffc83b479aa3a4')) >> BigInt(128);
  if ((absTick & 0x200) !== 0) ratio = (ratio * BigInt('0xf987a7253ac413176f2b074cf7815e54')) >> BigInt(128);
  if ((absTick & 0x400) !== 0) ratio = (ratio * BigInt('0xf3392b0822b70005940c7a398e4b70f3')) >> BigInt(128);
  if ((absTick & 0x800) !== 0) ratio = (ratio * BigInt('0xe7159475a2c29b7443b29c7fa6e889d9')) >> BigInt(128);
  if ((absTick & 0x1000) !== 0) ratio = (ratio * BigInt('0xd097f3bdfd2022b8845ad8f792aa5825')) >> BigInt(128);
  if ((absTick & 0x2000) !== 0) ratio = (ratio * BigInt('0xa9f746462d870fdf8a65dc1f90e061e5')) >> BigInt(128);
  if ((absTick & 0x4000) !== 0) ratio = (ratio * BigInt('0x70d869a156d2a1b890bb3df62baf32f7')) >> BigInt(128);
  if ((absTick & 0x8000) !== 0) ratio = (ratio * BigInt('0x31be135f97d08fd981231505542fcfa6')) >> BigInt(128);
  if ((absTick & 0x10000) !== 0) ratio = (ratio * BigInt('0x9aa508b5b7a84e1c677de54f3e99bc9')) >> BigInt(128);
  if ((absTick & 0x20000) !== 0) ratio = (ratio * BigInt('0x5d6af8dedb81196699c329225ee604')) >> BigInt(128);
  if ((absTick & 0x40000) !== 0) ratio = (ratio * BigInt('0x2216e584f5fa1ea926041bedfe98')) >> BigInt(128);
  if ((absTick & 0x80000) !== 0) ratio = (ratio * BigInt('0x48a170391f7dc42444e8fa2')) >> BigInt(128);

  if (tick > 0) ratio = (BigInt(2) ** BigInt(256) - BigInt(1)) / ratio;
  
  return ratio >> BigInt(32);
}

function calculateLiquidity(
  sqrtPriceX96: bigint,
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  amount0: bigint,
  amount1: bigint
): bigint {
  // Ensure A < B
  if (sqrtPriceAX96 > sqrtPriceBX96) {
    [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];
  }

  if (sqrtPriceX96 <= sqrtPriceAX96) {
    // Current price below range - use only token0
    return getLiquidityForAmount0(sqrtPriceAX96, sqrtPriceBX96, amount0);
  } else if (sqrtPriceX96 < sqrtPriceBX96) {
    // Current price in range - use both tokens (take minimum)
    const liquidity0 = getLiquidityForAmount0(sqrtPriceX96, sqrtPriceBX96, amount0);
    const liquidity1 = getLiquidityForAmount1(sqrtPriceAX96, sqrtPriceX96, amount1);
    return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  } else {
    // Current price above range - use only token1
    return getLiquidityForAmount1(sqrtPriceAX96, sqrtPriceBX96, amount1);
  }
}

function getLiquidityForAmount0(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  amount0: bigint
): bigint {
  if (sqrtPriceAX96 > sqrtPriceBX96) {
    [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];
  }
  const intermediate = mulDiv(sqrtPriceAX96, sqrtPriceBX96, BigInt(2) ** BigInt(96));
  return mulDiv(amount0, intermediate, sqrtPriceBX96 - sqrtPriceAX96);
}

function getLiquidityForAmount1(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  amount1: bigint
): bigint {
  if (sqrtPriceAX96 > sqrtPriceBX96) {
    [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];
  }
  return mulDiv(amount1, BigInt(2) ** BigInt(96), sqrtPriceBX96 - sqrtPriceAX96);
}

function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  return (a * b) / denominator;
}

export default function AddLiquidity() {
  const [address, setAddress] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [usdcAmount, setUsdcAmount] = useState('');
  const [wethAmount, setWethAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [balances, setBalances] = useState({ usdc: '0', weth: '0' });
  const [poolInitialized, setPoolInitialized] = useState<boolean | null>(null);

  async function connectWallet() {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send('eth_requestAccounts', []);
        const network = await provider.getNetwork();
        setAddress(accounts[0]);
        setChainId(Number(network.chainId));
        toast.success('Wallet connected successfully');
      } catch (error) {
        console.error(error);
        toast.error('Failed to connect wallet');
      }
    } else {
      toast.error('Please install MetaMask!');
    }
  }

  function disconnectWallet() {
    setAddress('');
    setChainId(null);
    setBalances({ usdc: '0', weth: '0' });
    setPoolInitialized(null);
    toast.success('Wallet disconnected');
  }

  useEffect(() => {
    if (typeof window.ethereum !== 'undefined') {
      const handleChainChanged = (chainIdHex: string) => {
        const newChainId = parseInt(chainIdHex, 16);
        setChainId(newChainId);
        setPoolInitialized(null);
        toast.success(`Switched to ${CHAIN_NAMES[newChainId] || 'Unknown Chain'}`);
      };

      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnectWallet();
        } else if (accounts[0] !== address) {
          setAddress(accounts[0]);
          toast.success('Account changed');
        }
      };

      window.ethereum.on('chainChanged', handleChainChanged);
      window.ethereum.on('accountsChanged', handleAccountsChanged);

      return () => {
        window.ethereum.removeListener('chainChanged', handleChainChanged);
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      };
    }
  }, [address]);

  // Check pool initialization status
  useEffect(() => {
    async function checkPoolStatus() {
      if (!chainId || !address) return;
      
      const deployment = DEPLOYMENTS[chainId as keyof typeof DEPLOYMENTS];
      if (!deployment) return;

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const poolManagerContract = new ethers.Contract(
          deployment.poolManager,
          POOL_MANAGER_ABI,
          provider
        );

        const storedPoolId = deployment.poolId;
        console.log('Using Stored Pool ID:', storedPoolId);

        try {
          const poolStateData = await poolManagerContract.extsload(storedPoolId);
          
          console.log('Pool State Data:', poolStateData);

          if (poolStateData === '0x0000000000000000000000000000000000000000000000000000000000000000') {
            console.log('⚠️ Pool not found');
            setPoolInitialized(false);
          } else {
            const value = BigInt(poolStateData);
            const sqrtPriceX96 = value & ((BigInt(1) << BigInt(160)) - BigInt(1));
            
            console.log('Pool state:', {
              sqrtPriceX96: sqrtPriceX96.toString(),
              raw: poolStateData,
            });

            const isInitialized = sqrtPriceX96 > BigInt(0);
            setPoolInitialized(isInitialized);
            
            if (!isInitialized) {
              console.log('⚠️ Pool exists but NOT initialized (sqrtPriceX96 = 0)');
            } else {
              console.log('✅ Pool is initialized and ready!');
            }
          }
        } catch (error: any) {
          console.error('Pool check error:', error);
          setPoolInitialized(false);
        }
      } catch (error) {
        console.error('Error checking pool status:', error);
        setPoolInitialized(null);
      }
    }

    checkPoolStatus();
  }, [address, chainId]);

  // Fetch token balances
  useEffect(() => {
    async function fetchBalances() {
      if (!address || !chainId) return;
      
      const deployment = DEPLOYMENTS[chainId as keyof typeof DEPLOYMENTS];
      if (!deployment) return;

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const usdcContract = new ethers.Contract(deployment.usdc, ERC20_ABI, provider);
        const wethContract = new ethers.Contract(deployment.weth, ERC20_ABI, provider);

        const [usdcBal, wethBal, usdcDecimals, wethDecimals] = await Promise.all([
          usdcContract.balanceOf(address),
          wethContract.balanceOf(address),
          usdcContract.decimals(),
          wethContract.decimals(),
        ]);

        setBalances({
          usdc: ethers.formatUnits(usdcBal, usdcDecimals),
          weth: ethers.formatUnits(wethBal, wethDecimals),
        });
      } catch (error) {
        console.error('Error fetching balances:', error);
      }
    }

    fetchBalances();
  }, [address, chainId]);

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  async function checkAndApproveToken(
    tokenAddress: string,
    spenderAddress: string,
    amount: string,
    tokenSymbol: string,
    provider: ethers.BrowserProvider
  ) {
    try {
      const signer = await provider.getSigner();
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      
      const decimals = await tokenContract.decimals();
      const amountWei = ethers.parseUnits(amount, decimals);
      
      const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
      
      const currentAllowance = await tokenContract.allowance(address, PERMIT2_ADDRESS);
      
      if (currentAllowance < amountWei) {
        toast.loading(`Approving ${tokenSymbol} to Permit2...`);
        const approveTx = await tokenContract.approve(PERMIT2_ADDRESS, ethers.MaxUint256);
        await approveTx.wait();
        toast.dismiss();
        toast.success(`${tokenSymbol} approved to Permit2!`);
      }
      
      return { amountWei, decimals };
    } catch (error) {
      toast.dismiss();
      console.error(`Error approving ${tokenSymbol}:`, error);
      throw error;
    }
  }

  async function addLiquidity() {
    if (!chainId || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    const deployment = DEPLOYMENTS[chainId as keyof typeof DEPLOYMENTS];
    if (!deployment) {
      toast.error('Unsupported network. Please switch to Sepolia or Base Sepolia');
      return;
    }

    if (!usdcAmount || !wethAmount) {
      toast.error('Please enter both USDC and WETH amounts');
      return;
    }

    if (parseFloat(usdcAmount) <= 0 || parseFloat(wethAmount) <= 0) {
      toast.error('Amounts must be greater than 0');
      return;
    }

    if (poolInitialized === false) {
      toast.error('Pool not initialized. Please run your initialization script first.');
      return;
    }

    setIsLoading(true);

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const usdcContract = new ethers.Contract(deployment.usdc, ERC20_ABI, provider);
      const wethContract = new ethers.Contract(deployment.weth, ERC20_ABI, provider);
      
      const [usdcBal, wethBal, usdcDecimals, wethDecimals] = await Promise.all([
        usdcContract.balanceOf(address),
        wethContract.balanceOf(address),
        usdcContract.decimals(),
        wethContract.decimals(),
      ]);

      // USE USER INPUT, NOT HARDCODED VALUES
      const usdcAmountWei = ethers.parseUnits(usdcAmount, usdcDecimals);
      const wethAmountWei = ethers.parseUnits(wethAmount, wethDecimals);

      console.log('User input amounts:', {
        usdcAmount,
        wethAmount,
        usdcAmountWei: usdcAmountWei.toString(),
        wethAmountWei: wethAmountWei.toString(),
      });

      if (usdcBal < usdcAmountWei) {
        toast.error('Insufficient USDC balance');
        setIsLoading(false);
        return;
      }

      if (wethBal < wethAmountWei) {
        toast.error('Insufficient WETH balance');
        setIsLoading(false);
        return;
      }

      // Determine currency order (CRITICAL FIX)
      const currency0 = deployment.usdc.toLowerCase() < deployment.weth.toLowerCase() 
        ? deployment.usdc 
        : deployment.weth;
      const currency1 = deployment.usdc.toLowerCase() < deployment.weth.toLowerCase() 
        ? deployment.weth 
        : deployment.usdc;

      // Map amounts to correct currency order
      const amount0Wei = currency0.toLowerCase() === deployment.usdc.toLowerCase() 
        ? usdcAmountWei 
        : wethAmountWei;
      const amount1Wei = currency0.toLowerCase() === deployment.usdc.toLowerCase() 
        ? wethAmountWei 
        : usdcAmountWei;

      console.log('Currency order:', {
        currency0,
        currency1,
        amount0Wei: amount0Wei.toString(),
        amount1Wei: amount1Wei.toString(),
        token0IsUsdc: currency0.toLowerCase() === deployment.usdc.toLowerCase(),
      });

      toast.loading('Checking token approvals...');
      
      await checkAndApproveToken(
        deployment.usdc,
        deployment.positionManager,
        usdcAmount,
        'USDC',
        provider
      );

      await checkAndApproveToken(
        deployment.weth,
        deployment.positionManager,
        wethAmount,
        'WETH',
        provider
      );

      toast.dismiss();

      // ============ Permit2 Allowance (FIXED) ============
      const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
      const PERMIT2_ABI = [
        'function approve(address token, address spender, uint160 amount, uint48 expiration) external',
        'function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)',
      ];

      const permit2 = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, signer);

      // Check and set Permit2 allowance for USDC
      toast.loading('Checking Permit2 allowances...');
      const usdcPermit2Allowance = await permit2.allowance(address, deployment.usdc, deployment.positionManager);
      console.log('USDC Permit2 allowance:', usdcPermit2Allowance.amount.toString());

      if (BigInt(usdcPermit2Allowance.amount) < usdcAmountWei) {
        toast.dismiss();
        toast.loading('Setting Permit2 allowance for USDC...');
        const maxUint160 = (BigInt(1) << BigInt(160)) - BigInt(1);
        const maxUint48 = (BigInt(1) << BigInt(48)) - BigInt(1);
        const approveTx = await permit2.approve(
          deployment.usdc,
          deployment.positionManager,
          maxUint160,
          maxUint48
        );
        await approveTx.wait();
        toast.dismiss();
        toast.success('USDC Permit2 allowance set!');
      }

      // Check and set Permit2 allowance for WETH
      toast.loading('Checking WETH Permit2 allowance...');
      const wethPermit2Allowance = await permit2.allowance(address, deployment.weth, deployment.positionManager);
      console.log('WETH Permit2 allowance:', wethPermit2Allowance.amount.toString());

      if (BigInt(wethPermit2Allowance.amount) < wethAmountWei) {
        toast.dismiss();
        toast.loading('Setting Permit2 allowance for WETH...');
        const maxUint160 = (BigInt(1) << BigInt(160)) - BigInt(1);
        const maxUint48 = (BigInt(1) << BigInt(48)) - BigInt(1);
        const approveTx = await permit2.approve(
          deployment.weth,
          deployment.positionManager,
          maxUint160,
          maxUint48
        );
        await approveTx.wait();
        toast.dismiss();
        toast.success('WETH Permit2 allowance set!');
      }

      toast.dismiss();

      toast.loading('Checking pool status...');
      
      const poolManagerContract = new ethers.Contract(
        deployment.poolManager,
        POOL_MANAGER_ABI,
        provider
      );

      const storedPoolId = deployment.poolId;
      console.log('Using Stored Pool ID:', storedPoolId);

      let currentTick: number;
      let sqrtPriceX96: bigint;

      try {
        const poolStateData = await poolManagerContract.extsload(storedPoolId);
        
        const value = BigInt(poolStateData);
        sqrtPriceX96 = value & ((BigInt(1) << BigInt(160)) - BigInt(1));
        
        const tickShifted = (value >> BigInt(160)) & ((BigInt(1) << BigInt(24)) - BigInt(1));
        currentTick = Number(tickShifted);
        
        if (currentTick >= 0x800000) {
          currentTick = currentTick - 0x1000000;
        }
        
        console.log('Pool state:', {
          sqrtPriceX96: sqrtPriceX96.toString(),
          tick: currentTick,
        });
        
        if (sqrtPriceX96 === BigInt(0)) {
          toast.dismiss();
          toast.error('Pool not initialized!');
          setIsLoading(false);
          setPoolInitialized(false);
          return;
        }
        
        setPoolInitialized(true);
        toast.dismiss();
        console.log('Pool is initialized. Current tick:', currentTick);
        
      } catch (error: any) {
        toast.dismiss();
        console.error('Error checking pool:', error);
        toast.error('Pool not found.');
        setIsLoading(false);
        setPoolInitialized(false);
        return;
      }

      // MATCH FORGE SCRIPT: Use narrower tick range centered around current price
      // Forge uses: tickLower = (currentTick - 1000 * tickSpacing) and tickUpper = (currentTick + 1000 * tickSpacing)
      const tickSpacing = 60;
      const tickRange = 1000 * tickSpacing; // 60,000 ticks
      
      // Truncate to tick spacing multiples
      const tickLower = Math.floor((currentTick - tickRange) / tickSpacing) * tickSpacing;
      const tickUpper = Math.floor((currentTick + tickRange) / tickSpacing) * tickSpacing;

      console.log('Tick range:', { tickLower, tickUpper, currentTick, tickRange });

      // CRITICAL FIX: Calculate liquidity the same way as Forge script
      // For the test amounts (0.1 USDC + 0.001 WETH), Forge calculated liquidity = 105,240
      // We need to implement getLiquidityForAmounts() or use a proportional calculation
      
      // For now, use a formula that works with the tick range and amounts
      const sqrtPriceAX96 = getSqrtPriceAtTick(tickLower);
      const sqrtPriceBX96 = getSqrtPriceAtTick(tickUpper);
      
      const finalLiquidity = calculateLiquidity(
        sqrtPriceX96,
        sqrtPriceAX96,
        sqrtPriceBX96,
        amount0Wei,
        amount1Wei
      );
      
      console.log('Liquidity calculation:', {
        sqrtPriceX96: sqrtPriceX96.toString(),
        sqrtPriceAX96: sqrtPriceAX96.toString(),
        sqrtPriceBX96: sqrtPriceBX96.toString(),
        liquidityCalculated: finalLiquidity.toString(),
        forgeScriptLiquidity: '105240 (for 0.1 USDC + 0.001 WETH)',
      });

      // Add small buffer to max amounts (1 wei)
      const amount0Max = amount0Wei + BigInt(1);
      const amount1Max = amount1Wei + BigInt(1);

      console.log('Liquidity parameters:', {
        amount0Wei: amount0Wei.toString(),
        amount1Wei: amount1Wei.toString(),
        amount0Max: amount0Max.toString(),
        amount1Max: amount1Max.toString(),
        liquidityDelta: finalLiquidity.toString(),
      });

      toast.loading('Adding liquidity to pool...');
      
      const positionManager = new ethers.Contract(
        deployment.positionManager,
        POSITION_MANAGER_ABI,
        signer
      );

      const poolKeyForHelper: PoolKey = {
        currency0,
        currency1,
        fee: 3000,
        tickSpacing: 60,
        hooks: deployment.hook,
      };

      const { actions, params } = createMintLiquidityParams(
        poolKeyForHelper,
        tickLower,
        tickUpper,
        finalLiquidity,  // Use calculated liquidity
        amount0Max,
        amount1Max,
        address,
        '0x'
      );

      const unlockData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'bytes[]'],
        [actions, params]
      );

      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

      const valueToSend = currency0 === ethers.ZeroAddress 
        ? amount0Wei 
        : (currency1 === ethers.ZeroAddress ? amount1Wei : BigInt(0));

      console.log('Sending transaction with:', {
        deadline,
        valueToSend: valueToSend.toString(),
        actionsHex: actions,
        paramsCount: params.length,
      });

      // DIAGNOSTIC: Decode to verify encoding
      const decodedCheck = ethers.AbiCoder.defaultAbiCoder().decode(['bytes', 'bytes[]'], unlockData);
      const mintCheck = ethers.AbiCoder.defaultAbiCoder().decode(
        ['tuple(address,address,uint24,int24,address)', 'int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes'],
        decodedCheck[1][0]
      );
      console.log('🔍 FINAL VERIFICATION - Decoded tickLower:', Number(mintCheck[1]));
      console.log('🔍 FINAL VERIFICATION - Decoded liquidity:', mintCheck[3].toString());

      if (Number(mintCheck[1]) !== -60000) {
        console.error('❌ ERROR: tickLower not encoded correctly!');
        toast.error('Encoding error detected - tickLower is wrong');
        setIsLoading(false);
        return;
      }

      // Use direct modifyLiquidities call (same as Forge after multicall wrapper)
      toast.loading('Sending transaction to add liquidity...');
      
      const tx = await positionManager.modifyLiquidities(unlockData, deadline, {
        value: valueToSend,
        gasLimit: 2500000,
      });

      toast.dismiss();
      toast.loading('Confirming transaction...');
      
      const receipt = await tx.wait();
      
      toast.dismiss();
      
      if (receipt.status === 0) {
        throw new Error('Transaction failed');
      }
      
      toast.success('Liquidity added successfully! 🎉');
      
      console.log('Transaction receipt:', receipt);
      console.log('Transaction hash:', receipt.hash);
      
      setUsdcAmount('');
      setWethAmount('');
      
      // Refresh balances
      const [newUsdcBal, newWethBal] = await Promise.all([
        usdcContract.balanceOf(address),
        wethContract.balanceOf(address),
      ]);

      setBalances({
        usdc: ethers.formatUnits(newUsdcBal, usdcDecimals),
        weth: ethers.formatUnits(newWethBal, wethDecimals),
      });
      
    } catch (error: any) {
      toast.dismiss();
      console.error('Error adding liquidity:', error);
      
      // Enhanced error logging
      if (error.receipt) {
        console.error('Transaction receipt:', error.receipt);
      }
      if (error.data) {
        console.error('Error data:', error.data);
      }
      
      if (error.code === 'ACTION_REJECTED') {
        toast.error('Transaction rejected by user');
      } else if (error.message?.includes('insufficient funds')) {
        toast.error('Insufficient funds for gas');
      } else if (error.message?.includes('PoolNotInitialized')) {
        toast.error('Pool not initialized');
        setPoolInitialized(false);
      } else if (error.reason) {
        toast.error(`Failed: ${error.reason}`);
      } else {
        toast.error(`Failed to add liquidity: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setIsLoading(false);
    }
  }

  const isSupportedChain = chainId && (chainId === 11155111 || chainId === 84532);

  return (
    <div className="min-h-screen bg-black text-white">
      <Toaster 
        position="top-right"
        toastOptions={{
          style: {
            background: '#0a0a0a',
            color: '#fff',
            border: '1px solid #262626',
          },
          success: {
            iconTheme: {
              primary: '#fff',
              secondary: '#0a0a0a',
            },
          },
          error: {
            iconTheme: {
              primary: '#fff',
              secondary: '#0a0a0a',
            },
          },
        }}
      />
      
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          
          <div className="border-b border-gray-800 pb-8 mb-12 flex items-center justify-between">
            
            <div className="flex items-center gap-8">
              <Link href="/" className="hover:opacity-70 transition-opacity">
                <h1 className="text-6xl font-light tracking-tight mb-3">
                  LiquiFlow
                </h1>
                <p className="text-gray-500 text-lg font-light">
                  Cross-Chain LP Rewards Protocol
                </p>
              </Link>
            </div>

            {!address && (
              <button
                onClick={connectWallet}
                className="border border-white bg-white text-black px-10 py-4 text-sm uppercase tracking-wider font-medium hover:bg-black hover:text-white transition-all duration-300"
              >
                Connect MetaMask
              </button>
            )}

            {address && (
              <div className="flex items-center gap-4">
                {chainId && (
                  <div className="border border-gray-800 bg-neutral-950 px-4 py-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Chain</p>
                    <p className="text-sm font-medium">{CHAIN_NAMES[chainId] || `Chain ${chainId}`}</p>
                  </div>
                )}
                
                <div className="border border-gray-800 bg-neutral-950 px-4 py-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Wallet</p>
                  <p className="text-sm font-mono">{truncateAddress(address)}</p>
                </div>
                
                <button
                  onClick={disconnectWallet}
                  className="border border-gray-800 bg-neutral-950 px-4 py-2 text-xs uppercase tracking-wider font-medium hover:border-white hover:bg-black transition-all"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>

          {address && (
            <div className="space-y-8">
              
              <div className="border border-gray-800 bg-neutral-950 p-6">
                <p className="text-xs uppercase tracking-wider text-gray-600 mb-2 font-medium">Network Status</p>
                <p className="text-2xl font-light mb-4">{chainId ? CHAIN_NAMES[chainId] || `Chain ${chainId}` : 'Not Connected'}</p>
                
                {isSupportedChain && poolInitialized !== null && (
                  <div className={`mt-4 p-3 border ${poolInitialized ? 'border-green-800 bg-green-950' : 'border-yellow-800 bg-yellow-950'}`}>
                    <p className="text-sm">
                      {poolInitialized ? (
                        <span className="text-green-400">✓ Pool initialized and ready</span>
                      ) : (
                        <span className="text-yellow-400">⚠️ Pool not initialized - please run initialization script</span>
                      )}
                    </p>
                  </div>
                )}
                
                {!isSupportedChain && chainId && (
                  <p className="text-sm text-red-400 mt-2">
                    ⚠️ Please switch to Sepolia or Base Sepolia
                  </p>
                )}
              </div>

              {isSupportedChain && (
                <div className="border border-gray-800 bg-neutral-950 p-6">
                  <h3 className="text-xs uppercase tracking-wider mb-4 font-medium text-gray-600">
                    Your Balances
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="border border-gray-900 p-4 bg-black">
                      <p className="text-xs text-gray-500 mb-1">USDC</p>
                      <p className="text-xl font-light">{parseFloat(balances.usdc).toFixed(2)}</p>
                    </div>
                    <div className="border border-gray-900 p-4 bg-black">
                      <p className="text-xs text-gray-500 mb-1">WETH</p>
                      <p className="text-xl font-light">{parseFloat(balances.weth).toFixed(4)}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="border border-gray-800 bg-neutral-950 p-8">
                <h3 className="text-sm uppercase tracking-wider mb-8 font-medium">
                  Provide Liquidity
                </h3>
                
                <div className="mb-6">
                  <label className="block text-xs uppercase tracking-wider text-gray-600 mb-3 font-medium">
                    USDC Amount
                  </label>
                  <input
                    type="number"
                    value={usdcAmount}
                    onChange={(e) => setUsdcAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    disabled={!isSupportedChain || isLoading || poolInitialized === false}
                    className="w-full bg-black border border-gray-800 px-5 py-4 text-xl font-light focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {isSupportedChain && (
                    <p className="text-xs text-gray-600 mt-2">
                      Balance: {parseFloat(balances.usdc).toFixed(2)} USDC
                    </p>
                  )}
                </div>

                <div className="mb-8">
                  <label className="block text-xs uppercase tracking-wider text-gray-600 mb-3 font-medium">
                    WETH Amount
                  </label>
                  <input
                    type="number"
                    value={wethAmount}
                    onChange={(e) => setWethAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.0001"
                    disabled={!isSupportedChain || isLoading || poolInitialized === false}
                    className="w-full bg-black border border-gray-800 px-5 py-4 text-xl font-light focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {isSupportedChain && (
                    <p className="text-xs text-gray-600 mt-2">
                      Balance: {parseFloat(balances.weth).toFixed(4)} WETH
                    </p>
                  )}
                </div>

                <button
                  onClick={addLiquidity}
                  disabled={!isSupportedChain || isLoading || poolInitialized === false}
                  className="w-full border border-white bg-white text-black px-6 py-4 text-sm uppercase tracking-wider font-medium hover:bg-black hover:text-white transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-black"
                >
                  {isLoading ? 'Processing...' : poolInitialized === false ? 'Pool Not Initialized' : !isSupportedChain ? 'Unsupported Network' : 'Add Liquidity'}
                </button>

                <div className="mt-6 border border-gray-800 p-4 bg-black">
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Enter your desired amounts. You'll need to approve USDC and WETH tokens before adding liquidity.
                  </p>
                </div>
              </div>

              <div className="border border-gray-800 bg-neutral-950 p-8">
                <h3 className="text-sm uppercase tracking-wider mb-6 font-medium">
                  Pool Information
                </h3>
                
                <div className="space-y-4">
                  <div className="flex justify-between items-center pb-3 border-b border-gray-900">
                    <span className="text-sm text-gray-500">Pool Type</span>
                    <span className="text-sm font-medium">USDC / WETH</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b border-gray-900">
                    <span className="text-sm text-gray-500">Fee Tier</span>
                    <span className="text-sm font-medium">0.3%</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b border-gray-900">
                    <span className="text-sm text-gray-500">Tick Spacing</span>
                    <span className="text-sm font-medium">60</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b border-gray-900">
                    <span className="text-sm text-gray-500">Reward Token</span>
                    <span className="text-sm font-medium">USDC</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Protocol Fee</span>
                    <span className="text-sm font-medium">0%</span>
                  </div>
                </div>
              </div>

              <div className="text-center pt-4">
                <Link
                  href="/claim-rewards"
                  className="inline-block border border-gray-800 bg-neutral-950 px-8 py-3 text-xs uppercase tracking-wider font-medium hover:border-white transition-all"
                >
                  View Rewards →
                </Link>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
}