import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import initSqlJs from 'sql.js';
import { DB_PATH } from '../config.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = await initSqlJs({ locateFile: f => join(__dirname, '../../node_modules/sql.js/dist/', f) });
let sqlDb;
if (existsSync(DB_PATH)) { sqlDb = new SQL.Database(readFileSync(DB_PATH)); } else { sqlDb = new SQL.Database(); }
function saveDb() { writeFileSync(DB_PATH, Buffer.from(sqlDb.export())); }
class Statement {
  constructor(sql) { this._sql = sql; }
  run(...args) {
    const p = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    sqlDb.run(this._sql, p); saveDb();
    const r = sqlDb.exec('SELECT last_insert_rowid() as id');
    return { changes: 1, lastInsertRowid: r[0]?.values[0]?.[0] ?? 0 };
  }
  get(...args) {
    const p = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    const s = sqlDb.prepare(this._sql); s.bind(p);
    let res; if (s.step()) res = s.getAsObject(); s.free(); return res;
  }
  all(...args) {
    const p = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    const results = sqlDb.exec(this._sql, p);
    if (!results.length) return [];
    const { columns, values } = results[0];
    return values.map(row => { const o = {}; columns.forEach((c, i) => { o[c] = row[i]; }); return o; });
  }
}
class DatabaseWrapper {
  pragma(s) { if (s.toLowerCase().includes('wal')) return; try { sqlDb.run('PRAGMA ' + s); } catch (_) {} }
  exec(sql) { sqlDb.run(sql); saveDb(); }
  prepare(sql) { return new Statement(sql); }
  transaction(fn) { return (...args) => { const r = fn(...args); saveDb(); return r; }; }
  close() { saveDb(); sqlDb.close(); }
}
export const db = new DatabaseWrapper();
export function initDb() {
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS saved_wallets (label TEXT PRIMARY KEY, address TEXT NOT NULL UNIQUE, created_at_ms INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, signature TEXT, signal_key TEXT, candidate_json TEXT NOT NULL, filter_result_json TEXT NOT NULL, UNIQUE(signature, mint));CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER, mint TEXT NOT NULL, kind TEXT NOT NULL, sent_at_ms INTEGER NOT NULL, telegram_message_id INTEGER, payload_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS llm_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER, mint TEXT NOT NULL, created_at_ms INTEGER NOT NULL, verdict TEXT NOT NULL, confidence REAL NOT NULL, reason TEXT, risks_json TEXT NOT NULL, raw_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS llm_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at_ms INTEGER NOT NULL, trigger_candidate_id INTEGER, selected_candidate_id INTEGER, selected_mint TEXT, verdict TEXT NOT NULL, confidence REAL NOT NULL, reason TEXT, risks_json TEXT NOT NULL, raw_json TEXT NOT NULL, candidate_ids_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS dry_run_positions (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER, mint TEXT NOT NULL, symbol TEXT, status TEXT NOT NULL, opened_at_ms INTEGER NOT NULL, closed_at_ms INTEGER, size_sol REAL NOT NULL, entry_price REAL, entry_mcap REAL, token_amount_est REAL, high_water_price REAL, high_water_mcap REAL, tp_percent REAL NOT NULL, sl_percent REAL NOT NULL, trailing_enabled INTEGER NOT NULL, trailing_percent REAL NOT NULL, trailing_armed INTEGER NOT NULL DEFAULT 0, exit_price REAL, exit_mcap REAL, exit_reason TEXT, pnl_percent REAL, pnl_sol REAL, llm_decision_id INTEGER, execution_mode TEXT DEFAULT 'dry_run', entry_signature TEXT, exit_signature TEXT, token_amount_raw TEXT, snapshot_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS dry_run_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER NOT NULL, mint TEXT NOT NULL, side TEXT NOT NULL, at_ms INTEGER NOT NULL, price REAL, mcap REAL, size_sol REAL, token_amount_est REAL, reason TEXT, payload_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS tp_sl_rules (position_id INTEGER PRIMARY KEY, tp_percent REAL NOT NULL, sl_percent REAL NOT NULL, trailing_enabled INTEGER NOT NULL, trailing_percent REAL NOT NULL, updated_at_ms INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS trade_intents (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER NOT NULL, mint TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, side TEXT NOT NULL, size_sol REAL NOT NULL, confidence REAL, reason TEXT, llm_decision_id INTEGER, payload_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS decision_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, batch_id INTEGER, trigger_candidate_id INTEGER, selected_candidate_id INTEGER, selected_mint TEXT, mode TEXT NOT NULL, action TEXT NOT NULL, verdict TEXT, confidence REAL, reason TEXT, guardrails_json TEXT NOT NULL, token_json TEXT NOT NULL, candidate_json TEXT NOT NULL, batch_json TEXT NOT NULL, execution_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS signal_events (id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, kind TEXT NOT NULL, at_ms INTEGER NOT NULL, source TEXT NOT NULL, payload_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS learning_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at_ms INTEGER NOT NULL, window_ms INTEGER NOT NULL, summary_json TEXT NOT NULL, lessons_json TEXT NOT NULL, raw_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS learning_lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', lesson TEXT NOT NULL, evidence_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS strategies (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, config_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS price_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, strategy_id TEXT NOT NULL, alert_type TEXT NOT NULL, target_price_usd REAL, target_mcap_usd REAL, target_ath_distance_percent REAL, candidate_json TEXT NOT NULL, signals_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at_ms INTEGER NOT NULL, triggered_at_ms INTEGER, expires_at_ms INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS idx_alerts_status ON price_alerts(status, expires_at_ms);CREATE INDEX IF NOT EXISTS idx_candidates_mint ON candidates(mint);CREATE INDEX IF NOT EXISTS idx_positions_status ON dry_run_positions(status);CREATE INDEX IF NOT EXISTS idx_trade_intents_status ON trade_intents(status);CREATE INDEX IF NOT EXISTS idx_decision_logs_mint ON decision_logs(selected_mint);CREATE INDEX IF NOT EXISTS idx_signal_events_mint ON signal_events(mint);CREATE INDEX IF NOT EXISTS idx_learning_lessons_status ON learning_lessons(status, created_at_ms);`);
  ensureColumn('candidates','signal_key','TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_signal_key ON candidates(signal_key) WHERE signal_key IS NOT NULL');
  ensureColumn('dry_run_positions','execution_mode',"TEXT DEFAULT 'dry_run'");
  ensureColumn('dry_run_positions','entry_signature','TEXT');
  ensureColumn('dry_run_positions','exit_signature','TEXT');
  ensureColumn('dry_run_positions','token_amount_raw','TEXT');
  ensureColumn('dry_run_positions','strategy_id',"TEXT DEFAULT 'sniper'");
  ensureColumn('dry_run_positions','partial_tp_done','INTEGER DEFAULT 0');
  ensureColumn('decision_logs','strategy_id','TEXT');
  const defaults = {agent_enabled:'true',trading_mode:process.env.TRADING_MODE||'dry_run',llm_candidate_pick_count:'10',llm_candidate_max_age_ms:String(10*60*1000),llm_min_confidence:'75',max_open_positions:process.env.MAX_OPEN_POSITIONS||'10',dry_run_buy_sol:'0.05',default_tp_percent:'20',default_sl_percent:'-15',default_trailing_enabled:'true',default_trailing_percent:'8',min_fee_claim_sol:'0',min_mcap_usd:'0',max_mcap_usd:'0',min_gmgn_total_fee_sol:'0',min_graduated_volume_usd:'0',max_top20_holder_percent:'100',min_saved_wallet_holders:'0',gmgn_request_delay_ms:'2500',gmgn_max_retries:'2',trending_enabled:'true',trending_source:'jupiter',trending_allow_degen:'true',trending_interval:'1m',trending_limit:'200',trending_order_by:'volume',trending_min_volume_usd:'0',trending_min_swaps:'0',trending_max_rug_ratio:'0.3',trending_max_bundler_rate:'0.5'};
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k,v] of Object.entries(defaults)) ins.run(k,v);
  const si = db.prepare('INSERT OR IGNORE INTO strategies (id, name, enabled, config_json, created_at_ms) VALUES (?, ?, ?, ?, ?)');
  const ts = Date.now();
  si.run('sniper','Sniper',0,JSON.stringify({entry_mode:'immediate',min_source_count:2,require_fee_claim:true,token_age_max_ms:3600000,min_mcap_usd:7000,max_mcap_usd:200000,min_fee_claim_sol:0.5,min_gmgn_total_fee_sol:10,min_holders:0,max_top20_holder_percent:100,min_saved_wallet_holders:0,max_ath_distance_pct:0,min_graduated_volume_usd:0,trending_min_volume_usd:0,trending_min_swaps:0,trending_max_rug_ratio:0.3,trending_max_bundler_rate:0.5,position_size_sol:0.1,max_open_positions:3,tp_percent:50,sl_percent:-25,trailing_enabled:true,trailing_percent:20,partial_tp:false,partial_tp_at_percent:0,partial_tp_sell_percent:0,max_hold_ms:0,use_llm:false,llm_min_confidence:0}),ts);
  si.run('dip_buy','Dip Buy',0,JSON.stringify({entry_mode:'wait_for_dip',min_source_count:1,require_fee_claim:false,token_age_max_ms:86400000,min_mcap_usd:25000,max_mcap_usd:500000,min_fee_claim_sol:0,min_gmgn_total_fee_sol:0,min_holders:0,max_top20_holder_percent:100,min_saved_wallet_holders:0,max_ath_distance_pct:-40,min_graduated_volume_usd:0,trending_min_volume_usd:0,trending_min_swaps:0,trending_max_rug_ratio:0.3,trending_max_bundler_rate:0.5,position_size_sol:0.05,max_open_positions:3,tp_percent:30,sl_percent:-20,trailing_enabled:true,trailing_percent:15,partial_tp:false,partial_tp_at_percent:0,partial_tp_sell_percent:0,max_hold_ms:0,use_llm:false,llm_min_confidence:0}),ts);
  si.run('smart_money','Smart Money',0,JSON.stringify({entry_mode:'immediate',min_source_count:2,require_fee_claim:false,token_age_max_ms:86400000,min_mcap_usd:10000,max_mcap_usd:1000000,min_fee_claim_sol:0,min_gmgn_total_fee_sol:0,min_holders:1000,max_top20_holder_percent:50,min_saved_wallet_holders:0,max_ath_distance_pct:0,min_graduated_volume_usd:0,trending_min_volume_usd:5000,trending_min_swaps:100,trending_max_rug_ratio:0.2,trending_max_bundler_rate:0.3,position_size_sol:0.1,max_open_positions:3,tp_percent:100,sl_percent:-25,trailing_enabled:false,trailing_percent:0,partial_tp:true,partial_tp_at_percent:100,partial_tp_sell_percent:50,max_hold_ms:0,use_llm:false,llm_min_confidence:0}),ts);
  si.run('degen','Degen',1,JSON.stringify({entry_mode:'immediate',min_source_count:1,require_fee_claim:false,token_age_max_ms:3600000,min_mcap_usd:500,max_mcap_usd:500000,min_fee_claim_sol:0,min_gmgn_total_fee_sol:0,min_holders:0,max_top20_holder_percent:100,min_saved_wallet_holders:0,max_ath_distance_pct:0,min_graduated_volume_usd:0,trending_min_volume_usd:0,trending_min_swaps:0,trending_max_rug_ratio:0.3,trending_max_bundler_rate:0.2,position_size_sol:0.05,max_open_positions:10,tp_percent:20,sl_percent:-15,trailing_enabled:true,trailing_percent:8,partial_tp:false,partial_tp_at_percent:0,partial_tp_sell_percent:0,max_hold_ms:60000,use_llm:false,llm_min_confidence:0}),ts);
}
export function ensureColumn(table, column, ddl) {
  const cols = db.prepare('PRAGMA table_info(' + table + ')').all().map(r => r.name);
  if (!cols.includes(column)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + ddl);
}
