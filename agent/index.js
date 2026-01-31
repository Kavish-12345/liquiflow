require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const hookABI = require('./hookABI.json');

// ============ Step 1: Listen to ONE chain ============

console.log('🎧 LiquidFlow Agent - Step 1: Single Chain Listener\n');

// Provider
const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC);

// Hook contract
const hook = new ethers.Contract(
  process.env.HOOK_ETHEREUM,
  hookABI,
  provider
);

const STORAGE_FILE = './positions.json';

function loadPositions() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const fileContent = fs.readFileSync(STORAGE_FILE, 'utf8');
      
      // Check if file is empty
      if (!fileContent || fileContent.trim() === '') {
        console.log('⚠️  positions.json is empty, creating new...\n');
        return { positions: [], events: [] };
      }
      
      return JSON.parse(fileContent);
    }
  } catch (error) {
    console.log('⚠️  Error reading positions.json, creating new...\n');
    console.log('   Error:', error.message, '\n');
  }
  
  return { positions: [], events: [] };
}

// Save data
function savePositions(data) {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
}

// Initial data
let data = loadPositions();

console.log(`📂 Loaded ${data.events.length} existing events\n`);
console.log('✅ Listening to Ethereum Sepolia...\n');

// Listen for LiquidityAdded
hook.on('LiquidityAdded', (provider, poolId, liquidityDelta, timestamp, chainId, event) => {
  console.log('✅ LiquidityAdded Event Detected!');
  console.log(`   Provider: ${provider}`);
  console.log(`   Pool ID: ${poolId}`);
  console.log(`   Liquidity: ${liquidityDelta.toString()}`);
  console.log(`   Timestamp: ${timestamp.toString()}`);
  console.log(`   Chain ID: ${chainId.toString()}`);
  console.log(`   Block: ${event.log.blockNumber}\n`);
  
  // Store event
  data.events.push({
    type: 'LiquidityAdded',
    chain: 'ethereum',
    provider: provider,
    poolId: poolId,
    liquidityDelta: liquidityDelta.toString(),
    timestamp: timestamp.toString(),
    chainId: chainId.toString(),
    blockNumber: event.log.blockNumber,
    txHash: event.log.transactionHash
  });
  
  savePositions(data);
  console.log(`💾 Saved event (${data.events.length} total)\n`);
});

// Listen for LiquidityRemoved
hook.on('LiquidityRemoved', (provider, poolId, liquidityDelta, timestamp, chainId, event) => {
  console.log('❌ LiquidityRemoved Event Detected!');
  console.log(`   Provider: ${provider}`);
  console.log(`   Liquidity: ${liquidityDelta.toString()}\n`);
  
  // Store event
  data.events.push({
    type: 'LiquidityRemoved',
    chain: 'ethereum',
    provider: provider,
    poolId: poolId,
    liquidityDelta: liquidityDelta.toString(),
    timestamp: timestamp.toString(),
    chainId: chainId.toString(),
    blockNumber: event.log.blockNumber,
    txHash: event.log.transactionHash
  });
  
  savePositions(data);
  console.log(`💾 Saved event (${data.events.length} total)\n`);
});

console.log('Agent running... Press Ctrl+C to stop\n');