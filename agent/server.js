require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const hookABI = require('./hookABI.json');

const app = express();
app.use(cors());
app.use(express.json());

console.log('🚀 LiquidFlow Agent Starting...\n');

// ============ CCTP Contract Addresses ============
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
  }
};

const ATTESTATION_API = 'https://iris-api-sandbox.circle.com/v1/attestations';

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

const providers = {
  ethereum: new ethers.JsonRpcProvider(CHAINS.ethereum.rpc),
  base: new ethers.JsonRpcProvider(CHAINS.base.rpc)
};

const hooks = {
  ethereum: new ethers.Contract(CHAINS.ethereum.hook, hookABI, providers.ethereum),
  base: new ethers.Contract(CHAINS.base.hook, hookABI, providers.base)
};

const treasury = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY, providers.ethereum);

console.log('💰 Treasury:', treasury.address);
console.log('📡 ETH Hook:', CHAINS.ethereum.hook);
console.log('📡 Base Hook:', CHAINS.base.hook, '\n');

// ============ Storage ============
let data = { events: [], claimed: {} };

function loadData() {
  try {
    if (fs.existsSync('./data.json')) {
      const content = fs.readFileSync('./data.json', 'utf8');
      if (content.trim()) return JSON.parse(content);
    }
  } catch (e) {}
  return { events: [], claimed: {} };
}

function saveData() {
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

data = loadData();
console.log(`📂 Loaded ${data.events.length} events\n`);

// ============ Treasury Balance ============
async function getTreasuryBalance() {
  const usdc = new ethers.Contract(
    CHAINS.ethereum.usdc,
    ['function balanceOf(address) view returns (uint256)'],
    providers.ethereum
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
    lastUpdate: Number(event.timestamp), // FIRST time they added
    chain: event.chain,
    provider: event.provider
  };

  positions.set(key, {
    ...existing,
    liquidity: BigInt(existing.liquidity) + BigInt(event.liquidityDelta),
    // DON'T update lastUpdate - keep it as FIRST add time
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
    return { provider: pos.provider, chain: pos.chain, pending: pending.toString(), claimed: claimed.toString(), total: totalReward.toString() };
  });
}

// ============ Event Handlers ============
function handleEvent(chain, type) {
  return (provider, poolId, liquidityDelta, timestamp, chainId, event) => {
    const emoji = type === 'LiquidityAdded' ? '✅' : '❌';
    console.log(`${emoji} [${chain.toUpperCase()}] ${type}`);
    console.log(`   ${provider.slice(0, 10)}... - ${liquidityDelta.toString()}`);
    console.log(`   Tx: ${event.log.transactionHash}\n`);
    data.events.push({ type, chain, provider, poolId, liquidityDelta: liquidityDelta.toString(), timestamp: timestamp.toString(), chainId: chainId.toString(), txHash: event.log.transactionHash, blockNumber: event.log.blockNumber });
    saveData();
  };
}

console.log('🎧 Listening...\n');
hooks.ethereum.on('LiquidityAdded', handleEvent('ethereum', 'LiquidityAdded'));
hooks.ethereum.on('LiquidityRemoved', handleEvent('ethereum', 'LiquidityRemoved'));
hooks.base.on('LiquidityAdded', handleEvent('base', 'LiquidityAdded'));
hooks.base.on('LiquidityRemoved', handleEvent('base', 'LiquidityRemoved'));

// ============ API ============
app.get('/api/health', (req, res) => res.json({ status: 'running', treasury: treasury.address, chains: Object.keys(CHAINS), events: data.events.length }));
app.get('/api/chains', (req, res) => res.json({ chains: Object.entries(CHAINS).map(([key, config]) => ({ id: key, chainId: config.chainId, name: config.name })) }));
app.get('/api/rewards/:address', async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const rewards = await calculateRewards();
    const userReward = rewards.find(r => r.provider.toLowerCase() === address);
    if (!userReward) return res.json({ address, pending: '0', claimed: '0', pendingUSDC: '0.00', claimedUSDC: '0.00' });
    res.json({ address: userReward.provider, pending: userReward.pending, claimed: userReward.claimed, pendingUSDC: (Number(userReward.pending) / 1e6).toFixed(2), claimedUSDC: (Number(userReward.claimed) / 1e6).toFixed(2) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/api/positions/:address', (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const userEvents = data.events.filter(e => e.provider.toLowerCase() === address && e.type === 'LiquidityAdded');
    const positions = {};
    for (const event of userEvents) {
      if (!positions[event.chain]) positions[event.chain] = { liquidity: 0n, chainId: CHAINS[event.chain].chainId, chainName: CHAINS[event.chain].name };
      positions[event.chain].liquidity += BigInt(event.liquidityDelta);
    }
    res.json({ address, positions: Object.entries(positions).map(([chain, data]) => ({ chain, chainId: data.chainId, chainName: data.chainName, liquidity: data.liquidity.toString() })) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============ CCTP CLAIM ============
app.post('/api/claim', async (req, res) => {
  try {
    const { address, destinationChainId } = req.body;
    const addressLower = address.toLowerCase();
    const rewards = await calculateRewards();
    const userReward = rewards.find(r => r.provider.toLowerCase() === addressLower);
    if (!userReward || BigInt(userReward.pending) === 0n) return res.status(400).json({ error: 'No rewards' });
    
    console.log(`💰 Claim: ${address} → ${Number(userReward.pending) / 1e6} USDC to chain ${destinationChainId}`);
    
    // Step 1: Approve USDC
    const usdc = new ethers.Contract(CHAINS.ethereum.usdc, ['function approve(address,uint256) returns (bool)'], treasury);
    const approveTx = await usdc.approve(CCTP_CONTRACTS[11155111].tokenMessenger, userReward.pending);
    await approveTx.wait();
    console.log('✅ USDC approved');
    
    // Step 2: Burn USDC
    const messenger = new ethers.Contract(
      CCTP_CONTRACTS[11155111].tokenMessenger,
      ['function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64)'],
      treasury
    );
    const mintRecipient = ethers.zeroPadValue(address, 32);
    const burnTx = await messenger.depositForBurn(userReward.pending, CCTP_CONTRACTS[destinationChainId].domain, mintRecipient, CHAINS.ethereum.usdc);
    const burnReceipt = await burnTx.wait();
    console.log(`🔥 Burned on Ethereum: ${burnTx.hash}`);
    
    // Step 3: Get attestation (polling)
    console.log('⏳ Waiting for attestation (10-15 min)...');
    let attestation;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 30000)); // 30s
      try {
        const response = await axios.get(`${ATTESTATION_API}/${burnTx.hash}`);
        if (response.data.status === 'complete') {
          attestation = response.data.attestation;
          break;
        }
      } catch (e) {}
    }
    if (!attestation) return res.status(500).json({ error: 'Attestation timeout' });
    console.log('✅ Attestation received');
    
    // Step 4: Mint on destination
    const destProvider = destinationChainId === 84532 ? providers.base : providers.ethereum;
    const destSigner = treasury.connect(destProvider);
    const transmitter = new ethers.Contract(
      CCTP_CONTRACTS[destinationChainId].messageTransmitter,
      ['function receiveMessage(bytes calldata message, bytes calldata attestation) returns (bool)'],
      destSigner
    );
    const messageBytes = burnReceipt.logs[0].data; // Simplified - actual parsing needed
    const mintTx = await transmitter.receiveMessage(messageBytes, attestation);
    await mintTx.wait();
    console.log(`✨ Minted on destination: ${mintTx.hash}\n`);
    
    data.claimed[addressLower] = userReward.pending;
    saveData();
    
    res.json({ success: true, burnTx: burnTx.hash, mintTx: mintTx.hash, amountUSDC: (Number(userReward.pending) / 1e6).toFixed(2) });
  } catch (error) {
    console.error('❌', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/treasury', async (req, res) => {
  try {
    const balance = await getTreasuryBalance();
    const rewards = await calculateRewards();
    const totalClaimed = Object.values(data.claimed).reduce((sum, val) => sum + BigInt(val), 0n);
    res.json({ address: treasury.address, balance: balance.toString(), balanceUSDC: (Number(balance) / 1e6).toFixed(2), totalClaimed: totalClaimed.toString(), totalClaimedUSDC: (Number(totalClaimed) / 1e6).toFixed(2), activeProviders: rewards.length });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`✅ Server on :${PORT}`);
  try {
    const balance = await getTreasuryBalance();
    console.log(`💰 Treasury: ${(Number(balance) / 1e6).toFixed(2)} USDC\n`);
  } catch (e) {}
  console.log('Ready! 🚀\n');
});