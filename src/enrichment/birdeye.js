import { HELIUS_API_KEY } from '../config.js';

const BIRDEYE_BASE = 'https://public-api.birdeye.so';
const RUGCHECK_BASE = 'https://api.rugcheck.xyz/v1';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function fetchBirdeyeTokenInfo(mint, useCache = true) {
  if (!mint) return null;
  const cached = cache.get(mint);
  if (useCache && cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

  try {
    const [overviewRes, rugRes] = await Promise.allSettled([
      fetch(`${BIRDEYE_BASE}/defi/token_overview?address=${mint}`, {
        headers: { 'X-API-KEY': HELIUS_API_KEY || 'public', 'x-chain': 'solana' }
      }),
      fetch(`${RUGCHECK_BASE}/tokens/${mint}/report/summary`)
    ]);

    const overview = overviewRes.status === 'fulfilled' && overviewRes.value.ok
      ? await overviewRes.value.json() : null;
    const rug = rugRes.status === 'fulfilled' && rugRes.value.ok
      ? await rugRes.value.json() : null;

    const data = overview?.data ? {
      name: overview.data.name || '',
      symbol: overview.data.symbol || '',
      price: overview.data.price || 0,
      market_cap: overview.data.mc || 0,
      holder_count: overview.data.holder || 0,
      total_fee: 0,
      trade_fee: 0,
      liquidity: overview.data.liquidity || 0,
      volume_24h: overview.data.v24hUSD || 0,
      link: {
        website: overview.data.extensions?.website || '',
        twitter_username: overview.data.extensions?.twitter || '',
      },
      rug_score: rug?.score || 0,
      rug_risks: rug?.risks || [],
    } : null;

    cache.set(mint, { at: Date.now(), data });
    return data;
  } catch (err) {
    console.log(`[birdeye] ${mint?.slice(0,8)}... ${err.message}`);
    cache.set(mint, { at: Date.now(), data: null });
    return null;
  }
}

function marketCapFromBirdeye(info) {
  const direct = Number(info?.market_cap);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const price = Number(info?.price);
  return Number.isFinite(price) ? price : null;
}

function tokenPriceFromBirdeye(info) {
  const price = Number(info?.price);
  return Number.isFinite(price) ? price : null;
}

export {
  fetchBirdeyeTokenInfo,
  marketCapFromBirdeye,
  tokenPriceFromBirdeye,
};
