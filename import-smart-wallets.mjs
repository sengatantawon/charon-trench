import dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';
import Database from 'better-sqlite3';

const db = new Database('./charon.sqlite');
const API_KEY = process.env.GMGN_API_KEY;

async function importSmartWallets() {
  console.log('[import] fetching GMGN smart money wallets...');
  try {
    const res = await axios.get('https://openapi.gmgn.ai/v1/smartmoney/sol/wallets', {
      headers: { 'X-APIKEY': API_KEY },
      params: { limit: 50, orderby: 'pnl_30d', direction: 'desc' },
      timeout: 15000,
    });

    const wallets = res.data?.data?.wallets || res.data?.data || res.data || [];
    console.log(`[import] found ${wallets.length} wallets`);

    const insert = db.prepare(
      'INSERT OR IGNORE INTO saved_wallets (address, label) VALUES (?, ?)'
    );

    let count = 0;
    for (const w of wallets) {
      const address = w.address || w.wallet_address || w.wallet;
      if (!address) continue;
      const winRate = w.win_rate ? `${Math.round(w.win_rate * 100)}%` : '';
      const pnl = w.pnl_30d ? `pnl:${Math.round(w.pnl_30d)}` : '';
      const label = `gmgn_smart|${winRate}|${pnl}`.replace(/\|+$/, '');
      insert.run(address, label);
      count++;
    }

    console.log(`[import] inserted ${count} wallets`);
    const total = db.prepare('SELECT COUNT(*) as n FROM saved_wallets').get();
    console.log(`[import] total saved_wallets: ${total.n}`);
  } catch (err) {
    console.error('[import] error:', err.response?.status, err.message);
    // Coba endpoint alternatif
    console.log('[import] trying alternative endpoint...');
    try {
      const res2 = await axios.get('https://openapi.gmgn.ai/v1/rank/sol/wallets/7d', {
        headers: { 'X-APIKEY': API_KEY },
        params: { limit: 50, orderby: 'pnl', direction: 'desc', tag: 'smart_degen' },
        timeout: 15000,
      });
      const wallets = res2.data?.data?.rank || res2.data?.data || [];
      console.log(`[import] alt found ${wallets.length} wallets`);
      const insert = db.prepare(
        'INSERT OR IGNORE INTO saved_wallets (address, label) VALUES (?, ?)'
      );
      let count = 0;
      for (const w of wallets) {
        const address = w.address || w.wallet_address;
        if (!address) continue;
        insert.run(address, `gmgn_smart_7d`);
        count++;
      }
      console.log(`[import] inserted ${count} wallets`);
    } catch (err2) {
      console.error('[import] alt error:', err2.response?.status, err2.message);
    }
  }
}

await importSmartWallets();
