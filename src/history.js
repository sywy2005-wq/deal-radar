import { comparisonConditions, comparisonKey } from './conditions.js';

export function summarizeHistory(rows) {
  const groups = new Map();
  let pendingCount = 0;
  for (const row of rows) {
    const conditions = comparisonConditions(row);
    if (!conditions.comparable || typeof row.observedAt !== 'string' || !Number.isFinite(Date.parse(row.observedAt))) {
      pendingCount++;
      continue;
    }
    const key = comparisonKey(row);
    const observedAt = new Date(row.observedAt).toISOString();
    if (!groups.has(key)) groups.set(key, {
      sourceId: row.sourceId, sourceName: row.sourceName,
      color: row.color, shippingRegion: row.shippingRegion,
      quantity: row.quantity, offerEligibility: row.offerEligibility,
      eligibilityKey: row.eligibilityKey, priceBasis: row.priceBasis,
      currency: row.currency, count: 0, minimumCents: conditions.totalCents,
      observedFrom: observedAt, observedTo: observedAt
    });
    const group = groups.get(key);
    group.count++;
    group.minimumCents = Math.min(group.minimumCents, conditions.totalCents);
    if (observedAt < group.observedFrom) group.observedFrom = observedAt;
    if (observedAt > group.observedTo) group.observedTo = observedAt;
  }
  return { observedCount: rows.length, pendingCount, groups: [...groups.values()] };
}
