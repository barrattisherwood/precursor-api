import * as Sentry from '@sentry/node';
import { logger } from '../logger';

const runningJobs = new Set<string>();

async function notifyDiscord(message: string, isAlert = false): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: isAlert ? '@here' : undefined,
      embeds: [
        {
          description: message,
          color: isAlert ? 0xff0000 : 0x00cc44,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  }).catch(e => logger.error({ err: e }, 'Discord notify failed'));
}

export async function runJob(name: string, fn: () => Promise<void>): Promise<void> {
  if (runningJobs.has(name)) {
    logger.warn({ job: name }, 'Job already running — skipping duplicate trigger');
    return;
  }
  runningJobs.add(name);
  const startedAt = Date.now();
  logger.info({ job: name }, 'Job started');

  try {
    await fn();
    const duration = Date.now() - startedAt;
    logger.info({ job: name, duration }, 'Job completed');
    await notifyDiscord(`✅ **${name}** completed in ${(duration / 1000).toFixed(1)}s`);
  } catch (err) {
    const duration = Date.now() - startedAt;
    Sentry.captureException(err);
    logger.error({ job: name, duration, err }, 'Job failed');
    await notifyDiscord(
      `🚨 **${name}** FAILED after ${(duration / 1000).toFixed(1)}s\n\`\`\`${String(err)}\`\`\``,
      true,
    );
  } finally {
    runningJobs.delete(name);
  }
}
