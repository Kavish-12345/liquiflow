require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const hookABI = require('./hookABI.json');

const { BridgeKit } = require('@circle-fin/bridge-kit');
const { createAdapterFromPrivateKey } = require('@circle-fin/adapter-viem-v2');
BigInt.prototype.toJSON = function() {
  return this.toString();
};
const app = express();
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'https://liquiflow.vercel.app'
  ],
  credentials: true
}));
app.use(express.json());

console.log('🚀 LiquidFlow Agent Starting...\n');

// ============ CCTP Contract Addresses ============
// Updated with official Arc Testnet CCTP addresses from docs.arc.network
const CCTP_CONTRACTS = {
  11155111: { // Ethereum Sepolia
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
    messageTransmitter: '0x7865fAfC2db2093669d92c0F33AeEF291086BEFD',
    domain: 0
  },
  84532: { // Base Sepolia  
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
    messageTransmitter: '0x7865fAfC2db2093669d92c0F33AeEF291086BEFD',
    domain: 6
  },
  5042002: { // Arc Testnet (TREASURY HUB) - Official addresses from Arc docs
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    tokenMinter: '0xb43db544E2c27092c107639Ad201b3dEfAbcF192',
    domain: 26 // Official Arc Testnet CCTP domain
  }
};

const ATTESTATION_API = 'https://iris-api-sandbox.circle.com/v1/attestations';



// Define destination chains
const sepolia = {
  id: 11155111,
  name: 'Sepolia',
};

const baseSepolia = {
  id: 84532,
  name: 'Base Sepolia',
};

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
  },
  arc: { // TREASURY CHAIN (no hook needed!)
    chainId: 5042002,
    name: 'Arc Testnet',
    usdc: '0x3600000000000000000000000000000000000000', // Arc's native USDC (ERC-20 interface)
    rpc: process.env.ARC_RPC
  }
};

const providers = {
  ethereum: new ethers.JsonRpcProvider(CHAINS.ethereum.rpc),
  base: new ethers.JsonRpcProvider(CHAINS.base.rpc),
  arc: new ethers.JsonRpcProvider(CHAINS.arc.rpc)
};

const hooks = {
  ethereum: new ethers.Contract(CHAINS.ethereum.hook, hookABI, providers.ethereum),
  base: new ethers.Contract(CHAINS.base.hook, hookABI, providers.base)
};

// Treasury wallet now on Arc Testnet!
const treasury = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY, providers.arc);

console.log('💰 Treasury Address:', treasury.address);
console.log('🏦 Treasury Chain: Arc Testnet (5042002)');
console.log('📡 ETH Hook:', CHAINS.ethereum.hook);
console.log('📡 Base Hook:', CHAINS.base.hook);
console.log();

// ============ Storage ============
let data = { events: [], claimed: {}, claims: [] };

function loadData() {
  try {
    if (fs.existsSync('./data.json')) {
      const content = fs.readFileSync('./data.json', 'utf8');
      if (content.trim()) {
        const loaded = JSON.parse(content);
        if (!loaded.claims) loaded.claims = [];
        return loaded;
      }
    }
  } catch (e) {}
  return { events: [], claimed: {}, claims: [] };
}

function saveData() {
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

data = loadData();
console.log(`📂 Loaded ${data.events.length} events\n`);

// ============ Treasury Balance (ON ARC!) ============
async function getTreasuryBalance() {
  const usdc = new ethers.Contract(
    CHAINS.arc.usdc,
    ['function balanceOf(address) view returns (uint256)'],
    providers.arc
  );
  return await usdc.balanceOf(treasury.address);
}

// ============ Calculate Rewards ============
async function calculateRewards() {
  const positions = new Map();
  for (const event of data.events) {
    const key = event.provider.toLowerCase();
    if (event.type === 'LiquidityAdded') {
      const existing = positions.get(key) || {
        liquidity: 0n,
        lastUpdate: Number(event.timestamp),
        chain: event.chain,
        provider: event.provider
      };

      positions.set(key, {
        ...existing,
        liquidity: BigInt(existing.liquidity) + BigInt(event.liquidityDelta),
      });
    }
  }
  if (positions.size === 0) return [];
  const now = Math.floor(Date.now() / 1000);
  const treasuryBalance = await getTreasuryBalance();
  let totalLiquidityTime = 0n;
  const posData = [];
  for (const [address, pos] of positions) {
    const timeHeld = BigInt(now - pos.lastUpdate);
    const liquidityTime = pos.liquidity * timeHeld;
    totalLiquidityTime += liquidityTime;
    posData.push({ ...pos, liquidityTime, address });
  }
  if (totalLiquidityTime === 0n) return [];
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

console.log('🎧 Listening for LP events on Ethereum & Base...\n');
hooks.ethereum.on('LiquidityAdded', handleEvent('ethereum', 'LiquidityAdded'));
hooks.ethereum.on('LiquidityRemoved', handleEvent('ethereum', 'LiquidityRemoved'));
hooks.base.on('LiquidityAdded', handleEvent('base', 'LiquidityAdded'));
hooks.base.on('LiquidityRemoved', handleEvent('base', 'LiquidityRemoved'));

// ============ API ============
app.get('/api/health', (req, res) => res.json({ 
  status: 'running', 
  treasury: treasury.address,
  treasuryChain: 'Arc Testnet (5042002)',
  chains: Object.keys(CHAINS), 
  events: data.events.length 
}));

app.get('/api/chains', (req, res) => res.json({ 
  chains: Object.entries(CHAINS).map(([key, config]) => ({ 
    id: key, 
    chainId: config.chainId, 
    name: config.name 
  })) 
}));

app.get('/api/rewards/:address', async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const rewards = await calculateRewards();
    const userReward = rewards.find(r => r.provider.toLowerCase() === address);
    if (!userReward) return res.json({ 
      address, 
      pending: '0', 
      claimed: '0', 
      pendingUSDC: '0.00', 
      claimedUSDC: '0.00' 
    });
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

app.get('/api/positions/:address', (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const userEvents = data.events.filter(e => 
      e.provider.toLowerCase() === address && e.type === 'LiquidityAdded'
    );
    const positions = {};
    for (const event of userEvents) {
      if (!positions[event.chain]) positions[event.chain] = { 
        liquidity: 0n, 
        chainId: CHAINS[event.chain].chainId, 
        chainName: CHAINS[event.chain].name 
      };
      positions[event.chain].liquidity += BigInt(event.liquidityDelta);
    }
    
    res.json({ 
      address, 
      positions: Object.entries(positions).map(([chain, data]) => {
        const totalLiquidity = data.liquidity;
        const usdcAmount = totalLiquidity / 2n;
        const wethAmount = totalLiquidity / 2n;
        
        return {
          chain, 
          chainId: data.chainId, 
          chainName: data.chainName, 
          totalLiquidity: totalLiquidity.toString(),
          usdc: usdcAmount.toString(),
          weth: wethAmount.toString()
        };
      }) 
    });
  } catch (error) { 
    res.status(500).json({ error: error.message }); 
  }
});

// ============ CLAIMS ENDPOINTS ============
app.get('/api/claims/:claimId', (req, res) => {
  try {
    const claim = data.claims?.find(c => c.id === req.params.claimId);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    res.json(claim);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/claims/user/:address', (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const userClaims = data.claims?.filter(c => 
      c.recipient.toLowerCase() === address
    ) || [];
    res.json({ claims: userClaims });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



app.post('/api/claim', async (req, res) => {
  req.setTimeout(1800000);
  res.setTimeout(1800000);
  
  try {
    const { address, amount, destinationChainId } = req.body;
    
    if (destinationChainId === 5042002) {
      return res.status(400).json({ 
        error: 'Cannot claim to Arc Testnet (treasury chain).' 
      });
    }
    
    const addressLower = address.toLowerCase();
    const rewards = await calculateRewards();
    const userReward = rewards.find(r => r.provider.toLowerCase() === addressLower);
    
    if (!userReward || BigInt(userReward.pending) === 0n) {
      return res.status(400).json({ error: 'No rewards available' });
    }
    
    let claimAmount = amount ? BigInt(amount) : BigInt(userReward.pending);
    
    if (claimAmount > BigInt(userReward.pending)) {
      return res.status(400).json({ error: 'Claim amount exceeds available rewards' });
    }
    
    console.log(`\n💰 CLAIM INITIATED VIA BRIDGE KIT`);
    console.log(`   User: ${address}`);
    console.log(`   Amount: ${Number(claimAmount) / 1e6} USDC`);
    console.log(`   Source: Arc Testnet`);
    console.log(`   Destination: Chain ${destinationChainId}\n`);
    
    const claimId = `claim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const destinationChainName = destinationChainId === 84532 ? 'Base_Sepolia' : 'Ethereum_Sepolia';
    
    console.log('🔧 Initializing Bridge Kit...');
    const kit = new BridgeKit();
    
    const adapter = createAdapterFromPrivateKey({
      privateKey: process.env.TREASURY_PRIVATE_KEY,
      chain: 'Arc_Testnet',
    });
    
    // Enhanced event logging
    kit.on('approve', (event) => {
      console.log(`✅ Approval: ${event.values?.txHash || 'pending'}`);
    });
    
    kit.on('burn', (event) => {
      console.log(`🔥 Burn: ${event.values?.txHash || 'pending'}`);
      console.log(`   Message Hash: ${event.values?.messageHash || 'N/A'}`);
    });
    
    kit.on('attestation', (event) => {
      console.log(`📝 Attestation: ${event.values?.attestation ? 'received' : 'pending'}`);
      console.log(`   Status: ${event.state || 'unknown'}`);
    });
    
    kit.on('mint', (event) => {
      console.log(`✨ Mint: ${event.values?.txHash || 'completed'}`);
      console.log(`   Recipient: ${event.values?.recipient || 'N/A'}`);
    });
    
    // NEW: Listen for errors
    kit.on('error', (event) => {
      console.error(`❌ Bridge Error at step ${event.name}:`, event.error?.message || event.error);
    });
    
    console.log('🌉 Executing bridge transfer...');
    const result = await kit.bridge({
      from: {
        adapter: adapter,
        chain: 'Arc_Testnet',
      },
      to: {
        adapter: adapter,
        chain: destinationChainName,
        recipientAddress: address,
      },
      amount: (Number(claimAmount) / 1e6).toFixed(6),
    });
    
    console.log('✅ Bridge completed!');
    console.log(`   State: ${result.state}`);
    
    // Log all steps for debugging
    if (result.steps) {
      console.log('   Steps:');
      result.steps.forEach(step => {
        console.log(`     - ${step.name}: ${step.state} ${step.error ? `(Error: ${step.error.message})` : ''}`);
      });
    }
    
    const approveStep = result.steps?.find(s => s.name === 'approve');
    const burnStep = result.steps?.find(s => s.name === 'burn');
    const attestStep = result.steps?.find(s => s.name === 'attestation');
    const mintStep = result.steps?.find(s => s.name === 'mint');
    
    const claim = {
      id: claimId,
      recipient: address,
      amount: claimAmount.toString(),
      amountUSDC: (Number(claimAmount) / 1e6).toFixed(2),
      approveTx: approveStep?.txHash,
      burnTx: burnStep?.txHash,
      mintTx: mintStep?.txHash,
      attestation: attestStep?.values?.attestation,
      sourceChain: 'Arc Testnet',
      destinationChainId: destinationChainId,
      destinationChain: destinationChainId === 84532 ? 'Base Sepolia' : 'Ethereum Sepolia',
      status: result.state === 'success' ? 'completed' : result.state,
      timestamp: Date.now(),
      bridgeSteps: result.steps?.map(s => ({
        name: s.name,
        state: s.state,
        txHash: s.txHash,
        error: s.error?.message
      }))
    };
    
    data.claims.push(claim);
    const previousClaimed = BigInt(data.claimed[addressLower] || '0');
    data.claimed[addressLower] = (previousClaimed + claimAmount).toString();
    saveData();
    
    console.log('🎉 CLAIM COMPLETED!\n');
    
    res.json({ 
      success: result.state === 'success',
      status: result.state,
      claimId: claimId,
      approveTx: approveStep?.txHash,
      burnTx: burnStep?.txHash,
      mintTx: mintStep?.txHash,
      amountUSDC: (Number(claimAmount) / 1e6).toFixed(2),
      remainingUSDC: (Number(BigInt(userReward.pending) - claimAmount) / 1e6).toFixed(2),
      steps: result.steps,
      message: result.state === 'success' ? 'Bridge transfer completed successfully!' : 'Bridge encountered an error - check logs'
    });
    
  } catch (error) {
    console.error('❌ CLAIM ERROR:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.reason || error.code || error.shortMessage || 'Unknown error'
    });
  }
});

app.get('/api/treasury', async (req, res) => {
  try {
    const balance = await getTreasuryBalance();
    const rewards = await calculateRewards();
    const totalClaimed = Object.values(data.claimed).reduce((sum, val) => sum + BigInt(val), 0n);
    res.json({ 
      address: treasury.address,
      chain: 'Arc Testnet',
      chainId: 5042002,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`✅ Server running on port :${PORT}`);
  console.log(`🏦 Treasury Hub: Arc Testnet`);
  try {
    const balance = await getTreasuryBalance();
    console.log(`💰 Arc Treasury Balance: ${(Number(balance) / 1e6).toFixed(2)} USDC\n`);
  } catch (e) {
    console.log(`⚠️  Could not fetch Arc treasury balance (may need funding)\n`);
  }
  console.log('Ready! 🚀\n');
});