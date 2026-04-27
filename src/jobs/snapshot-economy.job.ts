import { gggApi } from '../adapters/ggg-api.adapter';
import { EconomySnapshot } from '../models/economy-snapshot.model';
import { logger } from '../logger';

const PATCH_VERSION = process.env.PATCH_VERSION ?? '0.1.0';

export async function snapshotEconomy(league: string): Promise<void> {
  logger.info({ league }, 'Starting economy snapshot');

  const rawData = await gggApi.fetchCurrencyExchange(league) as {
    lines?: Array<{ currencyTypeName: string; chaosEquivalent: number }>;
  };

  const currencyRates = (rawData.lines ?? []).map(line => ({
    currency_id: line.currencyTypeName,
    chaos_value: line.chaosEquivalent,
    source: 'currency_exchange' as const,
  }));

  await EconomySnapshot.create({
    captured_at: new Date(),
    league,
    patch_version: PATCH_VERSION,
    currency_rates: currencyRates,
    affix_prices: [], // Phase 2 — requires trade API whitelist
  });

  logger.info({ currencies: currencyRates.length }, 'Economy snapshot complete');
}
