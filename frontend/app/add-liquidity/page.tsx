'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import toast, { Toaster } from 'react-hot-toast';
import Link from 'next/link';
import { DEPLOYMENTS, ERC20_ABI, POSITION_MANAGER_ABI, POOL_MANAGER_ABI, getPoolId } from '@/lib/contract';
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

export default function AddLiquidity() {
  const [address, setAddress] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [usdcAmount, setUsdcAmount] = useState('');
  const [wethAmount, setWethAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [balances, setBalances] = useState({ usdc: '0', weth: '0' });

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
    toast.success('Wallet disconnected');
  }

  useEffect(() => {
    if (typeof window.ethereum !== 'undefined') {
      const handleChainChanged = (chainIdHex: string) => {
        const newChainId = parseInt(chainIdHex, 16);
        setChainId(newChainId);
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
      
      // Check current allowance
      const currentAllowance = await tokenContract.allowance(address, spenderAddress);
      
      if (currentAllowance < amountWei) {
        toast.loading(`Approving ${tokenSymbol}...`);
        const approveTx = await tokenContract.approve(spenderAddress, ethers.MaxUint256);
        await approveTx.wait();
        toast.dismiss();
        toast.success(`${tokenSymbol} approved!`);
      }
      
      return { amountWei, decimals };
    } catch (error) {
      toast.dismiss();
      console.error(`Error approving ${tokenSymbol}:`, error);
      throw error;
    }
  }

  // Calculate liquidity from token amounts (simplified)
  function calculateLiquidity(amount0Wei: bigint, amount1Wei: bigint, decimals0: number, decimals1: number): bigint {
    // For full range position, use a simple formula based on the smaller amount
    // Normalize to 18 decimals for calculation
    const normalized0 = decimals0 < 18 ? amount0Wei * BigInt(10 ** (18 - decimals0)) : amount0Wei / BigInt(10 ** (decimals0 - 18));
    const normalized1 = decimals1 < 18 ? amount1Wei * BigInt(10 ** (18 - decimals1)) : amount1Wei / BigInt(10 ** (decimals1 - 18));
    
    // Use the smaller normalized amount as liquidity (simplified)
    // For production, you'd want to use the proper Uniswap v3 math library
    const liquidity = normalized0 < normalized1 ? normalized0 : normalized1;
    
    // Scale down if the liquidity is too large
    return liquidity > BigInt(10 ** 24) ? BigInt(10 ** 24) : liquidity;
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

    setIsLoading(true);

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Step 1: Check balances
      const usdcContract = new ethers.Contract(deployment.usdc, ERC20_ABI, provider);
      const wethContract = new ethers.Contract(deployment.weth, ERC20_ABI, provider);
      
      const [usdcBal, wethBal, usdcDecimals, wethDecimals] = await Promise.all([
        usdcContract.balanceOf(address),
        wethContract.balanceOf(address),
        usdcContract.decimals(),
        wethContract.decimals(),
      ]);

      const usdcAmountWei = ethers.parseUnits(usdcAmount, usdcDecimals);
      const wethAmountWei = ethers.parseUnits(wethAmount, wethDecimals);

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

      // Step 1: Approve tokens to PositionManager (not PoolManager)
      toast.loading('Checking token approvals...');
      
      const { amountWei: usdc0Wei } = await checkAndApproveToken(
        deployment.usdc,
        deployment.positionManager, // Approve to PositionManager
        usdcAmount,
        'USDC',
        provider
      );

      const { amountWei: weth1Wei } = await checkAndApproveToken(
        deployment.weth,
        deployment.positionManager, // Approve to PositionManager
        wethAmount,
        'WETH',
        provider
      );

      toast.dismiss();

      // Step 3: Prepare pool key (ensure currency0 < currency1)
      const currency0 = deployment.usdc.toLowerCase() < deployment.weth.toLowerCase() 
        ? deployment.usdc 
        : deployment.weth;
      const currency1 = deployment.usdc.toLowerCase() < deployment.weth.toLowerCase() 
        ? deployment.weth 
        : deployment.usdc;

      const poolKey = {
        currency0,
        currency1,
        fee: 3000, // 0.3% fee
        tickSpacing: 60,
        hooks: deployment.hook,
      };

      // Step 4: Check if pool is initialized and get current tick
      toast.loading('Checking pool status...');
      
      const poolManagerContract = new ethers.Contract(
        deployment.poolManager,
        POOL_MANAGER_ABI,
        provider
      );

      // Compute the pool ID from the pool key
      const computedPoolId = getPoolId(poolKey);
      console.log('Computed Pool ID:', computedPoolId);
      console.log('Expected Pool ID:', deployment.poolId);

      let currentTick: number;
      let sqrtPriceX96: bigint;

      try {
        const slot0 = await poolManagerContract.getSlot0(computedPoolId);
        sqrtPriceX96 = slot0.sqrtPriceX96;
        
        console.log('Slot0 result:', {
          sqrtPriceX96: sqrtPriceX96.toString(),
          tick: slot0.tick.toString(),
          protocolFee: slot0.protocolFee?.toString(),
          lpFee: slot0.lpFee?.toString(),
        });
        
        // If sqrtPriceX96 is 0, the pool is not initialized
        if (sqrtPriceX96 === BigInt(0)) {
          toast.dismiss();
          toast.error('Pool not initialized! Please contact the protocol admin to initialize the pool first.');
          console.error('Pool ID used:', computedPoolId);
          setIsLoading(false);
          return;
        }
        
        currentTick = Number(slot0.tick);
        toast.dismiss();
        console.log('Pool is initialized. Current tick:', currentTick);
        console.log('Current sqrt price:', sqrtPriceX96.toString());
        
      } catch (error: any) {
        toast.dismiss();
        console.error('Error checking pool:', error);
        console.error('Pool ID attempted:', computedPoolId);
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          data: error.data,
        });
        toast.error(`Could not verify pool status: ${error.message || 'Unknown error'}`);
        setIsLoading(false);
        return;
      }

      // Step 5: Calculate tick range around current price
      const tickSpacing = 60;
      const tickRange = 1000; // Range of ticks around current price
      
      // Helper function to round tick to nearest valid tick spacing
      const roundToTickSpacing = (tick: number, spacing: number) => {
        return Math.floor(tick / spacing) * spacing;
      };

      const tickLower = roundToTickSpacing(currentTick - (tickRange * tickSpacing), tickSpacing);
      const tickUpper = roundToTickSpacing(currentTick + (tickRange * tickSpacing), tickSpacing);

      console.log('Tick range:', { tickLower, tickUpper, currentTick });

      // Calculate liquidity delta
      const amount0Wei = currency0 === deployment.usdc ? usdc0Wei : weth1Wei;
      const amount1Wei = currency0 === deployment.usdc ? weth1Wei : usdc0Wei;
      const decimals0 = currency0 === deployment.usdc ? usdcDecimals : wethDecimals;
      const decimals1 = currency0 === deployment.usdc ? wethDecimals : usdcDecimals;
      
      const liquidityDelta = calculateLiquidity(amount0Wei, amount1Wei, decimals0, decimals1);

      console.log('Pool Key:', poolKey);
      console.log('Liquidity Delta:', liquidityDelta.toString());

      // Step 6: Execute add liquidity using PositionManager
      toast.loading('Adding liquidity to pool...');
      
      const positionManager = new ethers.Contract(
        deployment.positionManager,
        POSITION_MANAGER_ABI,
        signer
      );

      // Create mint liquidity parameters using the helper
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
        liquidityDelta,
        amount0Wei,
        amount1Wei,
        address,
        '0x' // Empty hook data
      );

      // Encode the modifyLiquidities call
      const unlockData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes', 'bytes[]'],
        [actions, params]
      );

      const deadline = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now

      // Determine if we need to send ETH
      const valueToSend = currency0 === ethers.ZeroAddress 
        ? amount0Wei 
        : (currency1 === ethers.ZeroAddress ? amount1Wei : BigInt(0));

      const tx = await positionManager.modifyLiquidities(unlockData, deadline, {
        value: valueToSend,
        gasLimit: 1000000,
      });

      toast.dismiss();
      toast.loading('Confirming transaction...');
      
      const receipt = await tx.wait();
      
      toast.dismiss();
      toast.success('Liquidity added successfully! 🎉');
      
      console.log('Transaction receipt:', receipt);
      console.log('Transaction hash:', receipt.hash);
      
      // Reset form and refresh balances
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
      
      if (error.code === 'ACTION_REJECTED') {
        toast.error('Transaction rejected by user');
      } else if (error.message?.includes('insufficient funds')) {
        toast.error('Insufficient funds for gas');
      } else if (error.message?.includes('PoolNotInitialized')) {
        toast.error('Pool not initialized. Please contact support.');
      } else {
        toast.error(`Failed to add liquidity: ${error.reason || error.message}`);
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
          
          {/* Header */}
          <div className="border-b border-gray-800 pb-8 mb-12 flex items-center justify-between">
            
            {/* Left side */}
            <div className="flex items-center gap-8">
              <Link href="/" className="hover:opacity-70 transition-opacity">
                <h1 className="text-6xl font-light tracking-tight mb-3">
                  LiquidFlow
                </h1>
                <p className="text-gray-500 text-lg font-light">
                  Cross-Chain LP Rewards Protocol
                </p>
              </Link>
            </div>

            {/* Right side */}
            {!address && (
              <button
                onClick={connectWallet}
                className="border border-white bg-white text-black px-10 py-4 text-sm uppercase tracking-wider font-medium hover:bg-black hover:text-white transition-all duration-300"
              >
                Connect MetaMask
              </button>
            )}

            {/* Wallet Info */}
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

          {/* Add Liquidity Form */}
          {address && (
            <div className="space-y-8">
              
              {/* Chain Selection Info */}
              <div className="border border-gray-800 bg-neutral-950 p-6">
                <p className="text-xs uppercase tracking-wider text-gray-600 mb-2 font-medium">Selected Chain</p>
                <p className="text-2xl font-light">{chainId ? CHAIN_NAMES[chainId] || `Chain ${chainId}` : 'Not Connected'}</p>
                {!isSupportedChain && chainId && (
                  <p className="text-sm text-red-400 mt-2">
                    ⚠️ Please switch to Sepolia or Base Sepolia to add liquidity
                  </p>
                )}
                {isSupportedChain && (
                  <p className="text-sm text-gray-500 mt-2">
                    Switch networks in MetaMask to add liquidity on a different chain
                  </p>
                )}
              </div>

              {/* Token Balances */}
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

              {/* Liquidity Form */}
              <div className="border border-gray-800 bg-neutral-950 p-8">
                <h3 className="text-sm uppercase tracking-wider mb-8 font-medium">
                  Provide Liquidity
                </h3>
                
                {/* USDC Input */}
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
                    disabled={!isSupportedChain || isLoading}
                    className="w-full bg-black border border-gray-800 px-5 py-4 text-xl font-light focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {isSupportedChain && (
                    <p className="text-xs text-gray-600 mt-2">
                      Balance: {parseFloat(balances.usdc).toFixed(2)} USDC
                    </p>
                  )}
                </div>

                {/* WETH Input */}
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
                    disabled={!isSupportedChain || isLoading}
                    className="w-full bg-black border border-gray-800 px-5 py-4 text-xl font-light focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {isSupportedChain && (
                    <p className="text-xs text-gray-600 mt-2">
                      Balance: {parseFloat(balances.weth).toFixed(4)} WETH
                    </p>
                  )}
                </div>

                {/* Add Liquidity Button */}
                <button
                  onClick={addLiquidity}
                  disabled={!isSupportedChain || isLoading}
                  className="w-full border border-white bg-white text-black px-6 py-4 text-sm uppercase tracking-wider font-medium hover:bg-black hover:text-white transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-black"
                >
                  {isLoading ? 'Processing...' : !isSupportedChain ? 'Unsupported Network' : 'Add Liquidity'}
                </button>

                <div className="mt-6 border border-gray-800 p-4 bg-black">
                  <p className="text-xs text-gray-500 leading-relaxed">
                    You'll need to approve USDC and WETH tokens before adding liquidity. Make sure you have both tokens in your wallet.
                  </p>
                </div>
              </div>

              {/* Pool Info */}
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
                    <span className="text-sm text-gray-500">Reward Token</span>
                    <span className="text-sm font-medium">USDC</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b border-gray-900">
                    <span className="text-sm text-gray-500">Rewards Distribution</span>
                    <span className="text-sm font-medium">Pro-rata by liquidity</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Protocol Fee</span>
                    <span className="text-sm font-medium">0%</span>
                  </div>
                </div>
              </div>

              {/* Navigation */}
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