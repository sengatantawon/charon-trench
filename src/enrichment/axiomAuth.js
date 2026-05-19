import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../../.env');

let _accessToken  = process.env.AXIOM_ACCESS_TOKEN  || '';
let _refreshToken = process.env.AXIOM_REFRESH_TOKEN || '';
let _expiresAt    = Number(process.env.AXIOM_TOKEN_EXPIRES_AT || 0);
let _refreshing   = null;

function patchEnv(updates) {
  try {
    let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    for (const [key, value] of Object.entries(updates)) {
      const escaped = String(value).replace(/\n/g, '\\n');
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${escaped}`);
      } else {
        content += `\n${key}=${escaped}`;
      }
    }
    fs.writeFileSync(ENV_PATH, content, 'utf8');
  } catch (err) {
    console.error('[axiomAuth] gagal patch .env:', err.message);
  }
}

function tokenTtlSeconds() {
  return Math.floor((_expiresAt - Date.now()) / 1000);
}

export function isAccessTokenValid() {
  return Boolean(_accessToken) && Date.now() < _expiresAt - 60_000;
}

export async function getAccessToken() {
  if (isAccessTokenValid()) return _accessToken;
  await refreshAccessToken();
  return _accessToken;
}

export async function axiomAuthHeaders() {
  const token = await getAccessToken();
  return {
    'Authorization': `Bearer ${token}`,
    'accept': '*/*',
    'origin': 'https://axiom.trade',
    'referer': 'https://axiom.trade/',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
}

export async function refreshAccessToken() {
  if (_refreshing) return _refreshing;
  _refreshing = _doRefresh().finally(() => { _refreshing = null; });
  return _refreshing;
}

async function _doRefresh() {
  const refreshToken = _refreshToken || process.env.AXIOM_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('AXIOM_REFRESH_TOKEN missing');
  console.log('[axiomAuth] refresh access token...');
  try {
    const res = await axios.post(
      'https://auth.axiom.trade/token?grant_type=refresh_token',
      { refresh_token: refreshToken },
      {
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTY0NjY0NTc3MCwiZXhwIjoxOTYyMjIxNzcwfQ.Dj1IB1Bx4NCQmjQq7c0Y-nBMEMEDmP_Sda2tVfCEKuI',
          'origin': 'https://axiom.trade',
        },
        timeout: 10_000,
      }
    );
    const { access_token, refresh_token, expires_in } = res.data;
    if (!access_token) throw new Error('Response tidak mengandung access_token');
    _accessToken  = access_token;
    _expiresAt    = Date.now() + (Number(expires_in) || 3600) * 1000;
    if (refresh_token) _refreshToken = refresh_token;
    patchEnv({
      AXIOM_ACCESS_TOKEN: _accessToken,
      AXIOM_REFRESH_TOKEN: _refreshToken,
      AXIOM_TOKEN_EXPIRES_AT: String(_expiresAt),
    });
    console.log(`[axiomAuth] token refreshed — valid ${tokenTtlSeconds()}s`);
    return _accessToken;
  } catch (err) {
    const status = err.response?.status;
    console.error(`[axiomAuth] refresh gagal ${status || ''} ${err.message}`);
    if (status === 400 || status === 401) {
      console.error('[axiomAuth] Refresh token invalid. Login ulang ke axiom.trade');
    }
    throw err;
  }
}

export async function initAxiomAuth() {
  _accessToken  = process.env.AXIOM_ACCESS_TOKEN  || '';
  _refreshToken = process.env.AXIOM_REFRESH_TOKEN || '';
  _expiresAt    = Number(process.env.AXIOM_TOKEN_EXPIRES_AT || 0);
  if (!_refreshToken) {
    console.warn('[axiomAuth] AXIOM_REFRESH_TOKEN tidak di-set');
    return false;
  }
  if (!isAccessTokenValid()) {
    try { await refreshAccessToken(); } catch { return false; }
  } else {
    console.log(`[axiomAuth] token masih valid ${tokenTtlSeconds()}s`);
  }
  return true;
}

export function axiomAuthStatus() {
  if (!_refreshToken) return 'no_refresh_token';
  if (!_accessToken)  return 'no_access_token';
  if (!isAccessTokenValid()) return `expired (${tokenTtlSeconds()}s)`;
  return `ok (${tokenTtlSeconds()}s left)`;
}
