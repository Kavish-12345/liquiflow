'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import toast, { Toaster } from 'react-hot-toast';
import Link from 'next/link';

declare global {
  interface Window {
    ethereum?: any;
  }
}
const API_URL = 'https://liquiflow-1.onrender.com/api';

// Chain mapping
const CHAIN_NAMES: { [key: number]: string } = {
  1: 'Ethereum',
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
  8453: 'Base',
};

export default function ClaimRewards() {
  const [address, setAddress] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [rewards, setRewards] = useState<any>(null);
  const [positions, setPositions] = useState<any>(null);
  const [treasury, setTreasury] = useState<any>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimAmount, setClaimAmount] = useState('');
  const [destinationChain, setDestinationChain] = useState('11155111');

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
    setRewards(null);
    setPositions(null);
    toast.success('Wallet disconnected');
  }

  useEffect(() => {
    if (address) {
      // Fetch rewards
      fetch(`${API_URL}/rewards/${address}`)
        .then(res => res.json())
        .then(setRewards)
        .catch(err => {
          console.error(err);
          toast.error('Failed to fetch rewards');
        });
      
      // Fetch positions
      fetch(`${API_URL}/positions/${address}`)
        .then(res => res.json())
        .then(setPositions)
        .catch(err => {
          console.error(err);
          toast.error('Failed to fetch positions');
        });
    }
    
    // Fetch treasury info
    fetch(`${API_URL}/treasury`)
      .then(res => res.json())
      .then(setTreasury)
      .catch(err => {
        console.error(err);
        toast.error('Failed to fetch treasury data');
      });
  }, [address]);

  // Listen for chain changes
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

  async function claim() {
    const amount = parseFloat(claimAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    
    const maxClaim = parseFloat(rewards.pendingUSDC);
    if (amount > maxClaim) {
      toast.error(`Cannot claim more than ${maxClaim} USDC`);
      return;
    }

    setClaiming(true);
    const loadingToast = toast.loading('Processing claim...');
    
    try {
      const amountInWei = (amount * 1e6).toString(); // Convert to 6 decimals
      const res = await fetch(`${API_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          amount: amountInWei,
          destinationChainId: parseInt(destinationChain)
        })
      });
      const data = await res.json();
      
      toast.dismiss(loadingToast);
      
      if (data.success) {
        toast.success(`Successfully claimed ${amount} USDC!`);
        setClaimAmount('');
        // Refresh data
        setTimeout(() => window.location.reload(), 2000);
      } else {
        toast.error(data.error || 'Claim failed');
      }
    } catch (e: any) {
      toast.dismiss(loadingToast);
      toast.error(e.message || 'An error occurred');
    }
    setClaiming(false);
  }

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

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
        <div className="max-w-7xl mx-auto">
          
          {/* Header */}
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
                {/* Chain Badge */}
                {chainId && (
                  <div className="border border-gray-800 bg-neutral-950 px-4 py-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Chain</p>
                    <p className="text-sm font-medium">{CHAIN_NAMES[chainId] || `Chain ${chainId}`}</p>
                  </div>
                )}
                
                {/* Address Display */}
                <div className="border border-gray-800 bg-neutral-950 px-4 py-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Wallet</p>
                  <p className="text-sm font-mono">{truncateAddress(address)}</p>
                </div>
                
                {/* Disconnect Button */}
                <button
                  onClick={disconnectWallet}
                  className="border border-gray-800 bg-neutral-950 px-4 py-2 text-xs uppercase tracking-wider font-medium hover:border-white hover:bg-black transition-all"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>

          {/* Treasury Stats */}
          {treasury && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              <div className="border border-gray-800 bg-neutral-950 p-6 hover:border-gray-700 transition-colors">
                <p className="text-xs uppercase tracking-wider text-gray-600 mb-2 font-medium">Treasury Balance</p>
                <p className="text-3xl font-light">{treasury.balanceUSDC} <span className="text-sm text-gray-500">USDC</span></p>
              </div>
              <div className="border border-gray-800 bg-neutral-950 p-6 hover:border-gray-700 transition-colors">
                <p className="text-xs uppercase tracking-wider text-gray-600 mb-2 font-medium">Total Claimed</p>
                <p className="text-3xl font-light">{treasury.totalClaimedUSDC} <span className="text-sm text-gray-500">USDC</span></p>
              </div>
              <div className="border border-gray-800 bg-neutral-950 p-6 hover:border-gray-700 transition-colors">
                <p className="text-xs uppercase tracking-wider text-gray-600 mb-2 font-medium">Active Providers</p>
                <p className="text-3xl font-light">{treasury.activeProviders}</p>
              </div>
            </div>
          )}

         

          {/* Dashboard */}
          {address && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Left Column - Positions */}
              <div className="lg:col-span-1 space-y-6">

                {/* Positions */}
                {positions && positions.positions.length > 0 && (
                  <div className="border border-gray-800 bg-neutral-950 p-6">
                    <h3 className="text-sm uppercase tracking-wider mb-6 font-medium">
                      Your LP Positions
                    </h3>
                    <div className="space-y-4">
                      {positions.positions.map((pos: any, idx: number) => (
                        <div key={idx} className="border border-gray-800 p-5 bg-black">
                          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-900">
                            <span className="font-medium text-sm">{pos.chainName}</span>
                            <span className="text-xs text-gray-600">ID: {pos.chainId}</span>
                          </div>
                          
                          {/* Token Breakdown */}
                          <div className="space-y-3 mb-4">
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-gray-500 uppercase tracking-wide">USDC</span>
                              <span className="font-mono text-sm">
                                {(Number(pos.usdc) / 1e6).toFixed(4)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-gray-500 uppercase tracking-wide">WETH</span>
                              <span className="font-mono text-sm">
                                {(Number(pos.weth) / 1e6).toFixed(6)}
                              </span>
                            </div>
                          </div>
                          
                          {/* Total Liquidity */}
                          <div className="pt-3 border-t border-gray-900">
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-gray-600 uppercase tracking-wide">Total Liquidity</span>
                              <span className="text-sm font-medium">
                                ${(Number(pos.totalLiquidity) / 1e6).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* Pool Info */}
                    <div className="mt-5 border border-gray-800 p-4 bg-neutral-950">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        You're providing liquidity to a USDC/WETH pool. Rewards are calculated based on your total liquidity and time held.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column - Rewards & Claim */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Pending Rewards */}
                {rewards && (
                  <div className="border border-gray-800 bg-neutral-950 p-10">
                    <p className="text-xs uppercase tracking-wider text-gray-600 mb-4 font-medium">Pending Rewards</p>
                    <p className="text-7xl font-light mb-2 tracking-tight">{rewards.pendingUSDC}</p>
                    <p className="text-lg text-gray-500 uppercase tracking-wider">USDC</p>
                  </div>
                )}

                {/* Claim Form */}
                {rewards && parseFloat(rewards.pendingUSDC) > 0 && (
                  <div className="border border-gray-800 bg-neutral-950 p-8">
                    <h3 className="text-sm uppercase tracking-wider mb-8 font-medium">
                      Claim Your Rewards
                    </h3>
                    
                    {/* Amount Input */}
                    <div className="mb-6">
                      <label className="block text-xs uppercase tracking-wider text-gray-600 mb-3 font-medium">Amount to Claim (USDC)</label>
                      <input
                        type="number"
                        value={claimAmount}
                        onChange={(e) => setClaimAmount(e.target.value)}
                        placeholder="0.00"
                        step="0.01"
                        max={rewards.pendingUSDC}
                        className="w-full bg-black border border-gray-800 px-5 py-4 text-xl font-light focus:outline-none focus:border-white transition-colors"
                      />
                      <p className="text-xs text-gray-600 mt-2">Maximum: {rewards.pendingUSDC} USDC</p>
                    </div>

                    {/* Destination Chain */}
                    <div className="mb-8">
                      <label className="block text-xs uppercase tracking-wider text-gray-600 mb-3 font-medium">Destination Chain</label>
                      <select
                        value={destinationChain}
                        onChange={(e) => setDestinationChain(e.target.value)}
                        className="w-full bg-black border border-gray-800 px-5 py-4 focus:outline-none focus:border-white transition-colors appearance-none cursor-pointer"
                      >
                        <option value="11155111">Ethereum Sepolia</option>
                        <option value="84532">Base Sepolia</option>
                      </select>
                    </div>

                    {/* Claim Button */}
                    <button
                      onClick={claim}
                      disabled={claiming}
                      className="w-full border border-white bg-white text-black px-6 py-4 text-sm uppercase tracking-wider font-medium hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
                    >
                      {claiming ? 'Processing...' : 'Claim Rewards'}
                    </button>

                    <div className="mt-6 border border-gray-800 p-4 bg-black">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        CCTP claims take 10-15 minutes to process. Your USDC will be minted on the destination chain.
                      </p>
                    </div>
                  </div>
                )}

                {/* No Rewards */}
                {rewards && parseFloat(rewards.pendingUSDC) === 0 && (
                  <div className="border border-gray-800 bg-neutral-950 p-12 text-center">
                    <p className="text-lg font-light text-gray-500 mb-2">No pending rewards</p>
                    <p className="text-sm text-gray-600">Add liquidity on Ethereum or Base to start earning</p>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}