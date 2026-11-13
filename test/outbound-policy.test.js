import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { outboundDenialReason } from '../src/lib/outbound.js';
import { isGroupOpenFor } from '../src/lib/auth.js';
import { cleanupDir, makeTempHome, repoRoot, runNode } from './helpers.js';

const owner = { user_id: 'uowner', name: 'O' };
const ep = (chatId, type, msg) => ({ chatId, type, msg });

const dmCases = [
  ['owner', { owner, dmPolicy: 'owner' }, 'uowner', true],
  ['owner with unknown dmPolicy', { owner, dmPolicy: 'Owner' }, 'uowner', true],
  ['stranger under owner policy', { owner, dmPolicy: 'owner' }, 'ux', false],
  ['allowlisted user', { owner, dmPolicy: 'allowlist', dmAllowFrom: ['ua'] }, 'ua', true],
  ['unapproved user under pairing', { owner, dmPolicy: 'pairing', dmAllowFrom: [] }, 'ux', false],
  ['anyone under open', { owner, dmPolicy: 'open' }, 'ux', true],
];
for (const [name, config, to, allowed] of dmCases) {
  test(`outbound DM: ${name}`, () => {
    assert.equal(outboundDenialReason(config, ep(to, 'dm')) === null, allowed);
  });
}

test('outbound DM without type is checked as a DM', () => {
  assert.match(outboundDenialReason({ owner, dmPolicy: 'owner' }, ep('ux')), /DM ux is not allowed/);
});

test('outbound DM: reply proven by the component log of a still-allowed sender', () => {
  const config = { owner, dmPolicy: 'allowlist', dmAllowFrom: ['ua'] };
  const log = { 'ub/m1': { message_id: 'm1', user_id: 'ub' }, 'ub/m2': { message_id: 'm2', user_id: 'bot' },
    'uc/m3': { message_id: 'm3', user_id: 'ub' } };
  const find = (chatId, msg) => log[`${chatId}/${msg}`] || null;
  const allowB = { ...config, dmAllowFrom: ['ua', 'ub'] };
  assert.equal(outboundDenialReason(allowB, ep('ub', 'dm', 'm1'), find), null);
  assert.notEqual(outboundDenialReason(config, ep('ub', 'dm', 'm1'), find), null, 'sender removed from the allowlist since');
  assert.notEqual(outboundDenialReason(config, ep('ub', 'dm', 'm2'), find), null, 'bot records are not proof');
  assert.notEqual(outboundDenialReason({ ...config, dmAllowFrom: ['ub'] }, ep('uc', 'dm', 'm3'), find), null,
    'proof sender must be the DM user');
  assert.notEqual(outboundDenialReason(config, ep('ub', 'dm'), find), null, 'proactive send has no proof');
});

test('outbound group follows the inbound group policy', () => {
  const gA = 'zgr-aaa'; const gX = 'zgr-xxx';
  const allowlist = { owner, groupPolicy: 'allowlist', groups: { [gA]: { name: 'a' } } };
  const log = { [`${gX}/m1`]: { message_id: 'm1', user_id: 'uowner' }, [`${gX}/m2`]: { message_id: 'm2', user_id: 'ux' },
    [`${gA}/m1`]: { message_id: 'm1', user_id: 'uowner' } };
  const find = (chatId, msg) => log[`${chatId}/${msg}`] || null;
  assert.equal(outboundDenialReason(allowlist, ep(gA, 'group')), null);
  assert.equal(outboundDenialReason({ owner, groupPolicy: 'open' }, ep(gX, 'group')), null);
  assert.match(outboundDenialReason(allowlist, ep(gX, 'group'), find), /group zgr-xxx is not allowed/, 'proactive send blocked');
  assert.equal(outboundDenialReason(allowlist, ep(gX, 'group', 'm1'), find), null, 'reply to the owner allowed');
  assert.notEqual(outboundDenialReason(allowlist, ep(gX, 'group', 'm2'), find), null, 'reply to a non-owner blocked');
  assert.notEqual(outboundDenialReason(allowlist, ep(gX, 'group', 'm9'), find), null, 'missing log entry blocked');
  const disabled = { ...allowlist, groupPolicy: 'disabled' };
  assert.notEqual(outboundDenialReason(disabled, ep(gA, 'group', 'm1'), find), null, 'disabled blocks the owner reply');
});

test('outbound type comes from the chat id, not the endpoint (review #1)', () => {
  const g = 'zgr-0d5ae61ad6743f2a6665';
  const ownerLog = (chatId, msg) => (msg === 'm1' ? { message_id: 'm1', user_id: 'uowner' } : null);
  for (const dmPolicy of ['open', 'owner']) {
    const disabled = { owner, dmPolicy, groupPolicy: 'disabled' };
    assert.match(outboundDenialReason(disabled, ep(g), ownerLog), /group .* not allowed/, `untyped group, dm=${dmPolicy}`);
    assert.match(outboundDenialReason(disabled, ep(g, 'dm'), ownerLog), /does not match/, `type:dm disguise, dm=${dmPolicy}`);
    assert.match(outboundDenialReason(disabled, ep(g, undefined, 'm1'), ownerLog), /group .* not allowed/, 'legacy group endpoint with owner msg');
  }
  // Allowlisted group, bare id, proactive send under dmPolicy owner: allowed.
  const allow = { owner, dmPolicy: 'owner', groupPolicy: 'allowlist', groups: { [g]: { name: 'g' } } };
  assert.equal(outboundDenialReason(allow, ep(g)), null);
  // DM id claimed as group: refused.
  assert.match(outboundDenialReason({ owner, groupPolicy: 'open' }, ep('ecf1579cf0c2199c40d3', 'group')), /does not match/);
  // Configured legacy non-zgr group id, or one recorded as a group inbound, is a group.
  assert.equal(outboundDenialReason({ owner, groups: { g1: {} } }, ep('g1')), null);
  const rec = () => ({ message_id: 'm', user_id: 'uowner', chat_type: 'group' });
  assert.match(outboundDenialReason({ owner, groupPolicy: 'disabled', dmPolicy: 'open' }, ep('g2', undefined, 'm'), rec), /group g2/);
  // Unknown shape: strictest (refuse).
  assert.match(outboundDenialReason({ owner, dmPolicy: 'open' }, ep('weird id!')), /cannot determine/);
  // Admin notices are not replyable.
  assert.match(outboundDenialReason({ owner }, ep('admin', 'dm-pairing')), /admin notices are not replyable/);
});

test('inbound group gate: owner in an unlisted group, disabled rejects everyone', () => {
  const allowlist = { owner, groupPolicy: 'allowlist', groups: { gA: { name: 'a' } } };
  assert.equal(isGroupOpenFor(allowlist, 'gA', 'ux'), true, 'allowlisted group');
  assert.equal(isGroupOpenFor(allowlist, 'gX', 'uowner'), true, 'owner in unlisted group accepted');
  assert.equal(isGroupOpenFor(allowlist, 'gX', 'ux'), false, 'non-owner in unlisted group rejected');
  const disabled = { ...allowlist, groupPolicy: 'disabled' };
  assert.equal(isGroupOpenFor(disabled, 'gA', 'uowner'), false, 'disabled rejects the owner');
  assert.equal(isGroupOpenFor(disabled, 'gX', 'uowner'), false);
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
      'scripts/send.js', 'ux|type:dm', 'hello'
    ], { env: { HOME: home, ZALO_FETCH_LOG: fetchLog } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /outbound blocked: DM ux is not allowed/);
    assert.equal(fs.existsSync(fetchLog), false, 'no HTTP call was made');
  } finally {
    cleanupDir(home);
  }
});
