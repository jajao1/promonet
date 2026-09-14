// Requires the isolated promonet-check Compose project from README, never production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const compose = ['compose', '--env-file', '.env.example', '-p', 'promonet-check'];
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 });
const sql = (query) => docker(...compose, 'exec', '-T', 'postgres', 'psql', '-U', 'promonet', '-d', 'promonet', '-Atc', query).trim();

test('isolated Docker stack authenticates, deduplicates and persists simulated jobs', { timeout: 60000 }, async () => {
  const container = JSON.parse(docker('inspect', 'promonet-check-bot-1'))[0];
  assert.equal(container.Config.Labels['com.docker.compose.project'], 'promonet-check');
  assert.ok(container.Config.Env.includes('DRY_RUN=true'), 'Refuse to test a live worker');
  assert.ok(container.Config.Env.includes('WEBHOOK_SECRET=localTestOnlyChangeBeforeUseWebhook123456'));
  const base = 'http://127.0.0.1:13000';
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const unauthorized = await fetch(`${base}/webhooks/evolution`, { method: 'POST', body: '{}' });
  assert.equal(unauthorized.status, 401);
  const id = randomUUID();
  const body = JSON.stringify({
    event: 'messages.upsert', instance: 'promonet',
    data: {
      key: { id, remoteJid: '120363000000001@g.us', fromMe: false },
      message: { conversation: `Oferta de teste ${id} https://produto.mercadolivre.com.br/MLB-123456789-produto-_JM?searchVariation=42` },
    },
  });
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/webhooks/evolution`, {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'x-webhook-secret': 'localTestOnlyChangeBeforeUseWebhook123456' },
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).accepted, 1);
  }
  let result;
  for (let i = 0; i < 20; i++) {
    result = sql(`SELECT status || ':' || (payload IS NULL)::text FROM promonet.jobs WHERE message_id='${id}'`);
    if (result === 'simulated:true') break;
    await setTimeout(500);
  }
  assert.equal(result, 'simulated:true');
  assert.equal(sql(`SELECT count(*) FROM promonet.jobs WHERE message_id='${id}'`), '1');
  docker(...compose, 'restart', 'bot');
  assert.equal(sql(`SELECT count(*) FROM promonet.jobs WHERE message_id='${id}' AND status='simulated'`), '1');
});
