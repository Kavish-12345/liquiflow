'use client';

import Link from 'next/link';

export default function Landing() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <div className="max-w-5xl w-full">
        
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-8xl md:text-9xl font-light tracking-tighter mb-6 leading-none">
            LiquiFlow
          </h1>
          <p className="text-xl md:text-2xl text-gray-500 font-light tracking-wide max-w-2xl mx-auto leading-relaxed">
            Cross-chain liquidity rewards protocol. Earn USDC on your LP positions across Ethereum and Base.
          </p>
        </div>
        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
          <Link
            href="/add-liquidity"
            className="w-full sm:w-auto border border-white bg-white text-black px-12 py-5 text-sm uppercase tracking-wider font-medium hover:bg-black hover:text-white transition-all duration-300 text-center"
          >
            Add Liquidity
          </Link>
          
          <Link
            href="/claim-rewards"
            className="w-full sm:w-auto border border-gray-800 bg-neutral-950 px-12 py-5 text-sm uppercase tracking-wider font-medium hover:border-white transition-all duration-300 text-center"
          >
            Claim Rewards
          </Link>
        </div>
      </div>
    </div>
  );
}