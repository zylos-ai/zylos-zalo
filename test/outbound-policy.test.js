import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { outboundDenialReason } from '../src/lib/outbound.js';
import { isGroupOpenFor } from '../src/lib/auth.js';
import { cleanupDir, makeTempHome, repoRoot, runNode } from './helpers.js';

const owner = { user_id: 'u-owner', name: 'O' };
const ep = (chatId, type, msg) => ({ chatId, type, msg });

const dmCases = [
  ['owner', { owner, dmPolicy: 'owner' }, 'u-owner', true],
  ['owner with unknown dmPolicy', { owner, dmPolicy: 'Owner' }, 'u-owner', true],
  ['stranger under owner policy', { owner, dmPolicy: 'owner' }, 'u-x', false],
  ['allowlisted user', { owner, dmPolicy: 'allowlist', dmAllowFrom: ['u-a'] }, 'u-a', true],
  ['unapproved user under pairing', { owner, dmPolicy: 'pairing', dmAllowFrom: [] }, 'u-x', false],
  ['anyone under open', { owner, dmPolicy: 'open' }, 'u-x', true],
];
for (const [name, config, to, allowed] of dmCases) {
  test(`outbound DM: ${name}`, () => {
    assert.equal(outboundDenialReason(config, ep(to, 'dm')) === null, allowed);
  });
}

test('outbound DM without type is checked as a DM', () => {
  assert.match(outboundDenialReason({ owner, dmPolicy: 'owner' }, ep('u-x')), /DM u-x is not allowed/);
});

test('outbound DM: reply proven by the component log of a still-allowed sender', () => {
  const config = { owner, dmPolicy: 'allowlist', dmAllowFrom: ['u-a'] };
  const log = { 'c-1/m1': { message_id: 'm1', user_id: 'u-a' }, 'c-1/m2': { message_id: 'm2', user_id: 'bot' } };
  const find = (chatId, msg) => log[`${chatId}/${msg}`] || null;
  assert.equal(outboundDenialReason(config, ep('c-1', 'dm', 'm1'), find), null);
  assert.notEqual(outboundDenialReason(config, ep('c-1', 'dm', 'm2'), find), null, 'bot records are not proof');
  assert.notEqual(outboundDenialReason(config, ep('c-1', 'dm', 'm9'), find), null, 'missing entry denies');
  assert.notEqual(outboundDenialReason({ ...config, dmAllowFrom: [] }, ep('c-1', 'dm', 'm1'), find), null,
    'sender removed from the allowlist since');
  assert.notEqual(outboundDenialReason(config, ep('c-1', 'dm'), find), null, 'proactive send has no proof');
});

test('outbound group follows the inbound group policy', () => {
  const allowlist = { owner, groupPolicy: 'allowlist', groups: { gA: { name: 'a' } } };
  const log = { 'gX/m1': { message_id: 'm1', user_id: 'u-owner' }, 'gX/m2': { message_id: 'm2', user_id: 'u-x' },
    'gA/m1': { message_id: 'm1', user_id: 'u-owner' } };
  const find = (chatId, msg) => log[`${chatId}/${msg}`] || null;
  assert.equal(outboundDenialReason(allowlist, ep('gA', 'group')), null);
  assert.equal(outboundDenialReason({ owner, groupPolicy: 'open' }, ep('gX', 'group')), null);
  assert.match(outboundDenialReason(allowlist, ep('gX', 'group'), find), /group gX is not allowed/, 'proactive send blocked');
  assert.equal(outboundDenialReason(allowlist, ep('gX', 'group', 'm1'), find), null, 'reply to the owner allowed');
  assert.notEqual(outboundDenialReason(allowlist, ep('gX', 'group', 'm2'), find), null, 'reply to a non-owner blocked');
  assert.notEqual(outboundDenialReason(allowlist, ep('gX', 'group', 'm9'), find), null, 'missing log entry blocked');
  const disabled = { ...allowlist, groupPolicy: 'disabled' };
  assert.notEqual(outboundDenialReason(disabled, ep('gA', 'group', 'm1'), find), null, 'disabled blocks the owner reply');
});

test('inbound group gate: owner in an unlisted group, disabled rejects everyone', () => {
  const allowlist = { owner, groupPolicy: 'allowlist', groups: { gA: { name: 'a' } } };
  assert.equal(isGroupOpenFor(allowlist, 'gA', 'u-x'), true, 'allowlisted group');
  assert.equal(isGroupOpenFor(allowlist, 'gX', 'u-owner'), true, 'owner in unlisted group accepted');
  assert.equal(isGroupOpenFor(allowlist, 'gX', 'u-x'), false, 'non-owner in unlisted group rejected');
  const disabled = { ...allowlist, groupPolicy: 'disabled' };
  assert.equal(isGroupOpenFor(disabled, 'gA', 'u-owner'), false, 'disabled rejects the owner');
  assert.equal(isGroupOpenFor(disabled, 'gX', 'u-owner'), false);
});

test('send script blocks before any network call or record', async () => {
  const home = makeTempHome();
  const dir = path.join(home, 'zylos/components/zalo');
  const fetchLog = path.join(home, 'fetch.log');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ botToken: 't', internal_port: 9, owner, dmPolicy: 'owner' }));
  fs.writeFileSync(path.join(dir, '.internal-token'), 'test-internal-token', { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '.internal-endpoint.json'), JSON.stringify({ port: 9 }), { mode: 0o600 });
  try {
    const result = await runNode([
      '--import', path.join(repoRoot, 'test/fixtures/mock-fetch.js'),
      'scripts/send.js', 'u-x|type:dm', 'hello'
    ], { env: { HOME: home, ZALO_FETCH_LOG: fetchLog } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /outbound blocked: DM u-x is not allowed/);
    assert.equal(fs.existsSync(fetchLog), false, 'no HTTP call was made');
  } finally {
    cleanupDir(home);
  }
});
