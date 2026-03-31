import { Env } from '../types';

const DEFAULT_FREE_DAILY_LIMIT = 10;

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

export function getDailyLimit(env: Env): number {
  const val = env.FREE_DAILY_LLM_LIMIT;
  if (!val) return DEFAULT_FREE_DAILY_LIMIT;
  const n = parseInt(val, 10);
  return isNaN(n) ? DEFAULT_FREE_DAILY_LIMIT : n;
}

interface UsageRow {
  count: number;
}

/**
 * Returns current usage for today without modifying it.
 */
export async function getDailyUsage(env: Env, userId: string): Promise<{ count: number; limit: number }> {
  const limit = getDailyLimit(env);
  const today = utcDateString();
  const row = await env.DB.prepare(
    'SELECT count FROM daily_llm_usage WHERE user_id = ? AND date = ?',
  )
    .bind(userId, today)
    .first<UsageRow>();
  return { count: row?.count ?? 0, limit };
}

/**
 * Check if a free-tier user is within their daily limit, then increment by `units`.
 * Returns { allowed: false } if the limit would be exceeded without modifying the count.
 */
export async function checkAndIncrementDailyUsage(
  env: Env,
  userId: string,
  units = 1,
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const limit = getDailyLimit(env);
  const today = utcDateString();

  const row = await env.DB.prepare(
    'SELECT count FROM daily_llm_usage WHERE user_id = ? AND date = ?',
  )
    .bind(userId, today)
    .first<UsageRow>();

  const current = row?.count ?? 0;

  if (current + units > limit) {
    return { allowed: false, count: current, limit };
  }

  await env.DB.prepare(`
    INSERT INTO daily_llm_usage (user_id, date, count)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET count = count + ?
  `)
    .bind(userId, today, units, units)
    .run();

  return { allowed: true, count: current + units, limit };
}
