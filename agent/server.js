require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const fs = require('fs');
const cors = require('cors');
const { createConfig, getRoutes, executeRoute } = require('@lifi/sdk');
const hookABI = require('./hookABI.json');

const app = express();
app.use(cors());
app.use(express.json());

console.log('🚀 LiquidFlow Agent Starting...\n');

// ============ Chain Configuration ============

const CHAINS = {
  ethereum: {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    usdc: process.env.USDC_ETHEREUM,
    rpc: process.env.ETHEREUM_RPC,
    hook: process.env.HOOK_ETHEREUM
  },
  base: {
    chainId: 84532,
    name: 'Base Sepolia',
    usdc: process.env.USDC_BASE,
    rpc: process.env.BASE_RPC,
    hook: process.env.HOOK_BASE
  }
};

// ============ Setup ============

const providers = {
  ethereum: new ethers.JsonRpcProvider(CHAINS.ethereum.rpc),
  base: new ethers.JsonRpcProvider(CHAINS.base.rpc)
};

const hooks = {
  ethereum: new ethers.Contract(CHAINS.ethereum.hook, hookABI, providers.ethereum),
  base: new ethers.Contract(CHAINS.base.hook, hookABI, providers.base)
};

const treasury = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY, providers.ethereum);

// Configure LI.FI SDK
createConfig({
  integrator: 'liquidflow'
});

console.log('💰 Treasury Address:', treasury.address);
console.log('📡 Ethereum Hook:', CHAINS.ethereum.hook);
console.log('📡 Base Hook:', CHAINS.base.hook);
console.log();

// ============ Storage ============

let data = { events: [], claimed: {} };
const STORAGE_FILE = './data.json';

function loadData() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const content = fs.readFileSync(STORAGE_FILE, 'utf8');
      if (content.trim()) return JSON.parse(content);
    }
  } catch (e) {
    console.log('⚠️  Creating new data file');
  }
  return { events: [], claimed: {} };
}

function saveData() {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
}

data = loadData();
console.log(`📂 Loaded ${data.events.length} existing events\n`);

// ============ Treasury Balance ============

async function getTreasuryBalance() {
  const usdcContract = new ethers.Contract(
    CHAINS.ethereum.usdc,
    ['function balanceOf(address) view returns (uint256)'],
    providers.ethereum
  );
  return await usdcContract.balanceOf(treasury.address);
}

// ============ Calculate Rewards ============

async function calculateRewards() {
  const positions = new Map();

  // Aggregate positions from ALL chains
  for (const event of data.events) {
    const key = event.provider.toLowerCase();

    if (event.type === 'LiquidityAdded') {
      const existing = positions.get(key) || {
        liquidity: 0n,
        lastUpdate: 0,
        chain: event.chain,
        provider: event.provider
      };

      positions.set(key, {
        ...existing,
        liquidity: BigInt(existing.liquidity) + BigInt(event.liquidityDelta),
        lastUpdate: Math.max(existing.lastUpdate, Number(event.timestamp))
      });
    }
  }

  if (positions.size === 0) return [];

  const now = Math.floor(Date.now() / 1000);
  const treasuryBalance = await getTreasuryBalance();

  let totalLiquidityTime = 0n;
  const posData = [];

  // Calculate time-weighted liquidity
  for (const [address, pos] of positions) {
    const timeHeld = BigInt(now - pos.lastUpdate);
    const liquidityTime = pos.liquidity * timeHeld;
    totalLiquidityTime += liquidityTime;
    posData.push({ ...pos, liquidityTime, address });
  }

  if (totalLiquidityTime === 0n) return [];

  // Calculate rewards
  return posData.map(pos => {
    const totalReward = (pos.liquidityTime * BigInt(treasuryBalance)) / totalLiquidityTime;
    const claimed = BigInt(data.claimed[pos.address] || '0');
    const pending = totalReward > claimed ? totalReward - claimed : 0n;

    return {
      provider: pos.provider,
      chain: pos.chain,
      pending: pending.toString(),
      claimed: claimed.toString(),
      total: totalReward.toString()
    };
  });
}

// ============ Event Handlers ============

function handleEvent(chain, type) {
  return (provider, poolId, liquidityDelta, timestamp, chainId, event) => {
    const emoji = type === 'LiquidityAdded' ? '✅' : '❌';
    console.log(`${emoji} [${chain.toUpperCase()}] ${type}`);
    console.log(`   ${provider.slice(0, 10)}... - ${liquidityDelta.toString()}`);
    console.log(`   Tx: ${event.log.transactionHash}\n`);

    data.events.push({
      type,
      chain,
      provider,
      poolId,
      liquidityDelta: liquidityDelta.toString(),
      timestamp: timestamp.toString(),
      chainId: chainId.toString(),
      txHash: event.log.transactionHash,
      blockNumber: event.log.blockNumber
    });

    saveData();
  };
}

// ============ Listen to Events ============

console.log('🎧 Listening to events...\n');

hooks.ethereum.on('LiquidityAdded', handleEvent('ethereum', 'LiquidityAdded'));
hooks.ethereum.on('LiquidityRemoved', handleEvent('ethereum', 'LiquidityRemoved'));
hooks.base.on('LiquidityAdded', handleEvent('base', 'LiquidityAdded'));
hooks.base.on('LiquidityRemoved', handleEvent('base', 'LiquidityRemoved'));

// ============ API ENDPOINTS ============

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'running',
    treasury: treasury.address,
    chains: Object.keys(CHAINS),
    events: data.events.length
  });
});

// Get supported chains
app.get('/api/chains', (req, res) => {
  res.json({
    chains: Object.entries(CHAINS).map(([key, config]) => ({
      id: key,
      chainId: config.chainId,
      name: config.name
    }))
  });
});

// Get user rewards
app.get('/api/rewards/:address', async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const rewards = await calculateRewards();
    const userReward = rewards.find(r => r.provider.toLowerCase() === address);

    if (!userReward) {
      return res.json({
        address,
        pending: '0',
        claimed: '0',
        pendingUSDC: '0.00',
        claimedUSDC: '0.00'
      });
    }

    res.json({
      address: userReward.provider,
      pending: userReward.pending,
      claimed: userReward.claimed,
      pendingUSDC: (Number(userReward.pending) / 1e6).toFixed(2),
      claimedUSDC: (Number(userReward.claimed) / 1e6).toFixed(2)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user positions
app.get('/api/positions/:address', (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const userEvents = data.events.filter(e =>
      e.provider.toLowerCase() === address &&
      e.type === 'LiquidityAdded'
    );

    const positions = {};

    for (const event of userEvents) {
      if (!positions[event.chain]) {
        positions[event.chain] = {
          liquidity: 0n,
          chainId: CHAINS[event.chain].chainId,
          chainName: CHAINS[event.chain].name
        };
      }
      positions[event.chain].liquidity += BigInt(event.liquidityDelta);
    }

    res.json({
      address,
      positions: Object.entries(positions).map(([chain, data]) => ({
        chain,
        chainId: data.chainId,
        chainName: data.chainName,
        liquidity: data.liquidity.toString()
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Claim rewards
app.post('/api/claim', async (req, res) => {
  try {
    const { address, destinationChainId } = req.body;

    if (!address || !destinationChainId) {
      return res.status(400).json({
        error: 'Missing required fields: address, destinationChainId'
      });
    }

    const addressLower = address.toLowerCase();

    // Calculate rewards
    const rewards = await calculateRewards();
    const userReward = rewards.find(r => r.provider.toLowerCase() === addressLower);

    if (!userReward || BigInt(userReward.pending) === 0n) {
      return res.status(400).json({ error: 'No pending rewards to claim' });
    }

    console.log(`💰 Claim request from ${address}`);
    console.log(`   Amount: ${Number(userReward.pending) / 1e6} USDC`);
    console.log(`   Destination: Chain ${destinationChainId}\n`);

    // Find destination chain config
    const destChain = Object.values(CHAINS).find(c => c.chainId === destinationChainId);
    if (!destChain) {
      return res.status(400).json({ error: 'Invalid destination chain' });
    }

    // Get LI.FI route
    const routeRequest = {
      fromChainId: CHAINS.ethereum.chainId,
      toChainId: destinationChainId,
      fromTokenAddress: CHAINS.ethereum.usdc,
      toTokenAddress: destChain.usdc,
      fromAmount: userReward.pending,
      fromAddress: treasury.address,
      toAddress: address
    };

    console.log('🔍 Getting LI.FI route...');
    const routes = await getRoutes(routeRequest);

    if (!routes.routes || routes.routes.length === 0) {
      return res.status(400).json({ error: 'No route found for this destination' });
    }

    const bestRoute = routes.routes[0];
    console.log(`✅ Route found via ${bestRoute.steps[0].tool}`);
    console.log('🚀 Executing transfer...\n');

    // Approve USDC for LI.FI
    const usdcContract = new ethers.Contract(
      CHAINS.ethereum.usdc,
      ['function approve(address,uint256) returns (bool)'],
      treasury
    );
    await usdcContract.approve(bestRoute.steps[0].estimate.approvalAddress, userReward.pending);

    // Execute transfer
    const execution = await executeRoute(bestRoute, {
      updateRouteHook: (route) => {
        console.log('📊 Route update:', route.status);
      },
      signer: treasury
    });

    // Mark as claimed
    data.claimed[addressLower] = userReward.pending;
    saveData();

    console.log(`✅ Claim successful!`);
    console.log(`   Tx: ${execution.transactionHash || execution.txHash}\n`);

    res.json({
      success: true,
      txHash: execution.transactionHash || execution.txHash,
      amount: userReward.pending,
      amountUSDC: (Number(userReward.pending) / 1e6).toFixed(2),
      destinationChain: destChain.name,
      destinationChainId: destinationChainId
    });

  } catch (error) {
    console.error('❌ Claim error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get treasury info
app.get('/api/treasury', async (req, res) => {
  try {
    const balance = await getTreasuryBalance();
    const rewards = await calculateRewards();
    const totalClaimed = Object.values(data.claimed).reduce((sum, val) => sum + BigInt(val), 0n);

    res.json({
      address: treasury.address,
      balance: balance.toString(),
      balanceUSDC: (Number(balance) / 1e6).toFixed(2),
      totalClaimed: totalClaimed.toString(),
      totalClaimedUSDC: (Number(totalClaimed) / 1e6).toFixed(2),
      activeProviders: rewards.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ Start Server ============

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}\n`);

  // Show initial treasury balance
  try {
    const balance = await getTreasuryBalance();
    console.log(`💰 Treasury Balance: ${(Number(balance) / 1e6).toFixed(2)} USDC\n`);
  } catch (error) {
    console.log('⚠️  Could not fetch treasury balance\n');
  }

  console.log('Ready to accept claims! 🚀\n');
});