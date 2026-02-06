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
let data = { events: [], claimed: {}, claims: [] };

function loadData() {
  try {
    if (fs.existsSync('./data.json')) {
      const content = fs.readFileSync('./data.json', 'utf8');
      if (content.trim()) {
        const loaded = JSON.parse(content);
        // Ensure claims array exists
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

console.log('🎧 Listening...\n');
hooks.ethereum.on('LiquidityAdded', handleEvent('ethereum', 'LiquidityAdded'));
hooks.ethereum.on('LiquidityRemoved', handleEvent('ethereum', 'LiquidityRemoved'));
hooks.base.on('LiquidityAdded', handleEvent('base', 'LiquidityAdded'));
hooks.base.on('LiquidityRemoved', handleEvent('base', 'LiquidityRemoved'));

// ============ API ============
app.get('/api/health', (req, res) => res.json({ 
  status: 'running', 
  treasury: treasury.address, 
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

// ============ CCTP CLAIM (STOPS AT ATTESTATION - AUTO-RELAY HANDLES MINT) ============
app.post('/api/claim', async (req, res) => {
  req.setTimeout(1800000);
  res.setTimeout(1800000);
  
  try {
    const { address, amount, destinationChainId } = req.body;
    
    // Validate: Prevent same-chain claims
    if (destinationChainId === 11155111) {
      return res.status(400).json({ 
        error: 'Cannot claim to Ethereum Sepolia (same chain as treasury). Please select Base Sepolia as destination.' 
      });
    }
    
    const addressLower = address.toLowerCase();
    const rewards = await calculateRewards();
    const userReward = rewards.find(r => r.provider.toLowerCase() === addressLower);
    
    if (!userReward || BigInt(userReward.pending) === 0n) {
      return res.status(400).json({ error: 'No rewards available' });
    }
    
    let claimAmount;
    if (amount) {
      claimAmount = BigInt(amount);
      if (claimAmount > BigInt(userReward.pending)) {
        return res.status(400).json({ error: 'Claim amount exceeds available rewards' });
      }
    } else {
      claimAmount = BigInt(userReward.pending);
    }
    
    console.log(`\n💰 CLAIM INITIATED`);
    console.log(`   User: ${address}`);
    console.log(`   Amount: ${Number(claimAmount) / 1e6} USDC`);
    console.log(`   Destination: Chain ${destinationChainId}\n`);
    
    // Generate unique claim ID
    const claimId = `claim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Step 1: Approve USDC
    console.log('📝 Step 1/3: Approving USDC...');
    const usdc = new ethers.Contract(
      CHAINS.ethereum.usdc, 
      ['function approve(address,uint256) returns (bool)'], 
      treasury
    );
    const approveTx = await usdc.approve(
      CCTP_CONTRACTS[11155111].tokenMessenger, 
      claimAmount
    );
    await approveTx.wait();
    console.log('✅ USDC approved\n');
    
    // Step 2: Burn USDC
    console.log('🔥 Step 2/3: Burning USDC on Ethereum...');
    const messenger = new ethers.Contract(
      CCTP_CONTRACTS[11155111].tokenMessenger,
      ['function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64)'],
      treasury
    );
    const mintRecipient = ethers.zeroPadValue(address, 32);
    const burnTx = await messenger.depositForBurn(
      claimAmount, 
      CCTP_CONTRACTS[destinationChainId].domain, 
      mintRecipient, 
      CHAINS.ethereum.usdc
    );
    const burnReceipt = await burnTx.wait();
    console.log(`✅ Burned on Ethereum: ${burnTx.hash}\n`);
    
    // Step 3: Extract message
    console.log('📝 Step 3/3: Extracting message from burn transaction...');
    const messageTransmitterInterface = new ethers.Interface([
      'event MessageSent(bytes message)'
    ]);

    let messageBytes;
    for (const log of burnReceipt.logs) {
      try {
        const parsed = messageTransmitterInterface.parseLog({
          topics: log.topics,
          data: log.data
        });
        if (parsed && parsed.name === 'MessageSent') {
          messageBytes = parsed.args.message;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!messageBytes) {
      throw new Error('MessageSent event not found in transaction logs');
    }

    const messageHash = ethers.keccak256(messageBytes);
    console.log(`✅ Message hash: ${messageHash}\n`);
    
    // Step 4: Wait for attestation
    console.log('⏳ Step 4/4: Waiting for Circle attestation (this takes 10-15 min)...');
    let attestation;
    let attestationStatus = 'pending';
    let attemptCount = 0;
    const maxAttempts = 60;
    
    for (let i = 0; i < maxAttempts; i++) {
      attemptCount++;
      await new Promise(r => setTimeout(r, 15000));
      
      try {
        const response = await axios.get(`${ATTESTATION_API}/${messageHash}`);
        attestationStatus = response.data.status;
        
        if (response.data.status === 'complete') {
          attestation = response.data.attestation;
          console.log(`✅ Attestation received after ${attemptCount * 15} seconds\n`);
          break;
        } else {
          if (attemptCount % 4 === 0) {
            console.log(`   ⏳ Waiting... (${attemptCount * 15}s elapsed, status: ${response.data.status})`);
          }
        }
      } catch (e) {
        if (attemptCount % 4 === 0) {
          console.log(`   ⏳ Polling... (${attemptCount * 15}s elapsed)`);
        }
      }
    }
    
    if (!attestation) {
      // Save to queue as pending attestation
      const claim = {
        id: claimId,
        recipient: address,
        amount: claimAmount.toString(),
        amountUSDC: (Number(claimAmount) / 1e6).toFixed(2),
        burnTx: burnTx.hash,
        messageHash: messageHash,
        messageBytes: messageBytes,
        destinationChainId: destinationChainId,
        destinationChain: destinationChainId === 84532 ? 'Base Sepolia' : 'Ethereum Sepolia',
        status: 'pending_attestation',
        attestationStatus: attestationStatus,
        timestamp: Date.now(),
        attestationAttempts: attemptCount
      };
      
      data.claims.push(claim);
      
      // Update claimed amount immediately (tokens are already burned)
      const previousClaimed = BigInt(data.claimed[addressLower] || '0');
      data.claimed[addressLower] = (previousClaimed + claimAmount).toString();
      saveData();
      
      console.error('⚠️ Attestation timeout - claim saved to queue\n');
      return res.status(202).json({ 
        success: true,
        status: 'pending_attestation',
        claimId: claimId,
        burnTx: burnTx.hash,
        messageHash: messageHash,
        amountUSDC: (Number(claimAmount) / 1e6).toFixed(2),
        message: 'Claim queued. Circle CCTP will complete the transfer automatically within 15-20 minutes. You can close this page.'
      });
    }
    
    // ✅ ATTESTATION RECEIVED - STOP HERE, AUTO-RELAY WILL MINT
    console.log('✅ Attestation complete - Circle CCTP auto-relay will handle minting\n');
    
    const claim = {
      id: claimId,
      recipient: address,
      amount: claimAmount.toString(),
      amountUSDC: (Number(claimAmount) / 1e6).toFixed(2),
      burnTx: burnTx.hash,
      messageHash: messageHash,
      messageBytes: messageBytes,
      attestation: attestation.substring(0, 50) + '...', // Store shortened version
      destinationChainId: destinationChainId,
      destinationChain: destinationChainId === 84532 ? 'Base Sepolia' : 'Ethereum Sepolia',
      status: 'attested',
      timestamp: Date.now(),
      attestationTime: attemptCount * 15
    };
    
    data.claims.push(claim);
    
    // Update claimed amount
    const previousClaimed = BigInt(data.claimed[addressLower] || '0');
    data.claimed[addressLower] = (previousClaimed + claimAmount).toString();
    saveData();
    
    console.log('🎉 CLAIM COMPLETED - Auto-relay will mint tokens!\n');
    
    res.json({ 
      success: true,
      status: 'attested',
      claimId: claimId,
      burnTx: burnTx.hash,
      messageHash: messageHash,
      amountUSDC: (Number(claimAmount) / 1e6).toFixed(2),
      remainingUSDC: (Number(BigInt(userReward.pending) - claimAmount) / 1e6).toFixed(2),
      message: 'Attestation received! Circle CCTP auto-relay will deliver your USDC within 5 minutes.',
      estimatedDelivery: '2-5 minutes'
    });
    
  } catch (error) {
    console.error('❌ CLAIM ERROR:', error.message);
    res.status(500).json({ error: error.message });
  }
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`✅ Server on :${PORT}`);
  try {
    const balance = await getTreasuryBalance();
    console.log(`💰 Treasury: ${(Number(balance) / 1e6).toFixed(2)} USDC\n`);
  } catch (e) {}
  console.log('Ready! 🚀\n');
});