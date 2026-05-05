import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { UsageData } from './types.js';

const CACHE_FILE = path.join(os.tmpdir(), 'claude-kimicode-usage.json');
const LOCK_FILE = `${CACHE_FILE}.lock`;

const FRESH_MS = 60_000;
const STALE_OK_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 800;
const LOCK_TTL_MS = 2_000;

const FIVE_HOUR_DURATION_MIN = 300;

const DEBUG = process.env.DEBUG?.includes('claude-kimicode') || process.env.DEBUG === '*';

interface CacheRecord {
  fetchedAt: number;
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetAt: string | null;
  sevenDayResetAt: string | null;
}

function debug(...args: unknown[]): void {
  if (DEBUG) console.error('[claude-kimicode]', ...args);
}

function coerceNum(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}

function recordToUsageData(rec: CacheRecord): UsageData {
  return {
    fiveHour: rec.fiveHour,
    sevenDay: rec.sevenDay,
    fiveHourResetAt: rec.fiveHourResetAt ? new Date(rec.fiveHourResetAt) : null,
    sevenDayResetAt: rec.sevenDayResetAt ? new Date(rec.sevenDayResetAt) : null,
  };
}

function loadCache(): CacheRecord | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as CacheRecord;
    if (typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(record: CacheRecord): void {
  try {
    const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    debug('writeCache failed', err);
  }
}

function lockHeld(now: number): boolean {
  try {
    const stat = fs.statSync(LOCK_FILE);
    return now - stat.mtimeMs < LOCK_TTL_MS;
  } catch {
    return false;
  }
}

function acquireLock(now: number): boolean {
  try {
    if (fs.existsSync(LOCK_FILE) && !lockHeld(now)) {
      try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
    }
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // ignore
  }
}

interface KimiResponse {
  usage?: {
    limit?: string | number | null;
    remaining?: string | number | null;
    resetTime?: string | null;
  } | null;
  limits?: Array<{
    window?: { duration?: number | null; timeUnit?: string | null } | null;
    detail?: {
      limit?: string | number | null;
      used?: string | number | null;
      remaining?: string | number | null;
      resetTime?: string | null;
    } | null;
  }> | null;
}

function mapKimiResponse(json: KimiResponse): { fiveHour: number | null; sevenDay: number | null; fiveHourResetAt: string | null; sevenDayResetAt: string | null } {
  let fiveHour: number | null = null;
  let fiveHourResetAt: string | null = null;
  if (Array.isArray(json.limits)) {
    for (const item of json.limits) {
      const win = item?.window;
      if (win?.duration === FIVE_HOUR_DURATION_MIN && win?.timeUnit === 'TIME_UNIT_MINUTE') {
        const limit = coerceNum(item.detail?.limit);
        const used = coerceNum(item.detail?.used);
        if (limit !== null && limit > 0 && used !== null) {
          fiveHour = clampPercent((used / limit) * 100);
        }
        const resetDate = coerceDate(item.detail?.resetTime);
        fiveHourResetAt = resetDate ? resetDate.toISOString() : null;
        break;
      }
    }
  }

  let sevenDay: number | null = null;
  let sevenDayResetAt: string | null = null;
  if (json.usage) {
    const limit = coerceNum(json.usage.limit);
    const remaining = coerceNum(json.usage.remaining);
    if (limit !== null && limit > 0 && remaining !== null) {
      sevenDay = clampPercent(((limit - remaining) / limit) * 100);
    }
    const resetDate = coerceDate(json.usage.resetTime);
    sevenDayResetAt = resetDate ? resetDate.toISOString() : null;
  }

  return { fiveHour, sevenDay, fiveHourResetAt, sevenDayResetAt };
}

function resolveEndpoint(): string | null {
  const base = process.env.ANTHROPIC_BASE_URL?.trim();
  if (!base) return 'https://api.kimi.com/coding/v1/usages';
  const trimmed = base.replace(/\/+$/, '');
  if (/\/v\d+\/usages$/.test(trimmed)) return trimmed;
  if (/\/v\d+$/.test(trimmed)) return `${trimmed}/usages`;
  return `${trimmed}/v1/usages`;
}

function resolveAuthToken(): string | null {
  const token = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (!token) return null;
  if (!token.startsWith('sk-kimi-')) return null;
  return token;
}

async function fetchKimi(): Promise<CacheRecord | null> {
  const token = resolveAuthToken();
  if (!token) {
    debug('no Kimi token in ANTHROPIC_AUTH_TOKEN, skipping fetch');
    return null;
  }
  const endpoint = resolveEndpoint();
  if (!endpoint) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      debug(`fetch ${endpoint} returned ${res.status}`);
      return null;
    }
    const json = (await res.json()) as KimiResponse;
    const mapped = mapKimiResponse(json);
    return {
      fetchedAt: Date.now(),
      ...mapped,
    };
  } catch (err) {
    debug('fetch failed', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAndCache(): Promise<CacheRecord | null> {
  if (!acquireLock(Date.now())) return null;
  try {
    const record = await fetchKimi();
    if (record) {
      writeCache(record);
    }
    return record;
  } finally {
    releaseLock();
  }
}

export async function getUsageFromKimi(now: number = Date.now()): Promise<UsageData | null> {
  if (!resolveAuthToken()) return null;

  const cache = loadCache();
  const age = cache ? now - cache.fetchedAt : Infinity;

  if (cache && age < FRESH_MS) {
    return recordToUsageData(cache);
  }

  if (cache && age < STALE_OK_MS) {
    if (!lockHeld(now)) {
      void refreshAndCache();
    }
    return recordToUsageData(cache);
  }

  if (lockHeld(now) && cache) {
    return recordToUsageData(cache);
  }

  const fresh = await refreshAndCache();
  if (fresh) {
    return recordToUsageData(fresh);
  }
  return cache ? recordToUsageData(cache) : null;
}
