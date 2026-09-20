import type { CallLogEntry, CustomerUser } from '../data/types';

export interface TeamSentimentAudit {
  totalCallsAnalyzed: number;
  positiveCount: number;
  positivePct: number;
  neutralCount: number;
  neutralPct: number;
  churnRiskCount: number;
  churnRiskPct: number;
  flaggedCalls: { user: CustomerUser; call: CallLogEntry }[];
}

/** Computes team-wide sentiment distribution and collects priority QA review calls. */
export function auditTeamSentiment(users: CustomerUser[]): TeamSentimentAudit {
  let positive = 0;
  let neutral = 0;
  let churnRisk = 0;
  const flagged: { user: CustomerUser; call: CallLogEntry }[] = [];

  for (const u of users) {
    for (const c of u.callHistory) {
      if (!c.analytics) continue;
      const s = c.analytics.sentiment;
      if (s === 'positive') positive++;
      else if (s === 'neutral') neutral++;
      else if (s === 'churn_risk' || s === 'negative') {
        churnRisk++;
        flagged.push({ user: u, call: c });
      }
    }
  }

  const total = positive + neutral + churnRisk;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  // Sort flagged calls by timestamp descending
  flagged.sort((a, b) => b.call.atTs - a.call.atTs);

  return {
    totalCallsAnalyzed: total,
    positiveCount: positive,
    positivePct: pct(positive),
    neutralCount: neutral,
    neutralPct: pct(neutral),
    churnRiskCount: churnRisk,
    churnRiskPct: pct(churnRisk),
    flaggedCalls: flagged.slice(0, 10),
  };
}
