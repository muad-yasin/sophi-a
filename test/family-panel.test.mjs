// test/family-panel.test.mjs - Sophi-A Seat Families F8 acceptance tests
// (relay/Docs/SophiA-Seat-Families-Plan.md §5 F8: "render functions called headlessly for all
// five states; forbidden-phrase test over the panel copy"). Tests only the pure,
// DOM-free layer (classifyPanelState/describeFamilyPanel) - buildFamilyPanelDom uses `document`
// and is browser-only, per this repo having no jsdom installed (an accepted F8 offline gap,
// named in DECISIONS.md: the live Chrome look is not verified in this overnight pass).
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPanelState, describeFamilyPanel, FORBIDDEN_PANEL_PHRASES } from '../src/ui/familyPanel.js';

test('classifyPanelState: flag-off wins regardless of family/loading/error', () => {
  assert.equal(classifyPanelState({ seatEnabled: false, loading: true, error: 'x', family: { sessions: [{}] } }), 'flag-off');
});

test('classifyPanelState: loading wins over error/family once flag is on', () => {
  assert.equal(classifyPanelState({ seatEnabled: true, loading: true, error: 'x', family: { sessions: [{}] } }), 'loading');
});

test('classifyPanelState: error wins over family once not loading', () => {
  assert.equal(classifyPanelState({ seatEnabled: true, loading: false, error: 'boom', family: { sessions: [{}] } }), 'error');
});

test('classifyPanelState: empty when no family, or a family with zero sessions', () => {
  assert.equal(classifyPanelState({ seatEnabled: true, loading: false, error: null, family: null }), 'empty');
  assert.equal(classifyPanelState({ seatEnabled: true, loading: false, error: null, family: { sessions: [] } }), 'empty');
});

test('classifyPanelState: active once a real family with at least one session exists', () => {
  assert.equal(classifyPanelState({ seatEnabled: true, loading: false, error: null, family: { sessions: [{ sessionId: 's1', status: 'idle' }] } }), 'active');
});

test('describeFamilyPanel: all five states produce the correct shape', () => {
  const flagOff = describeFamilyPanel('flag-off', { seatReason: 'not enabled for plan-2' });
  assert.equal(flagOff.emptyText, 'not enabled for plan-2');
  assert.equal(flagOff.showCreateButton, false);
  assert.equal(flagOff.showComposer, false);

  const loading = describeFamilyPanel('loading', {});
  assert.equal(loading.emptyText, 'Loading…');

  const error = describeFamilyPanel('error', { error: 'orchestrator unreachable' });
  assert.equal(error.emptyText, 'orchestrator unreachable');

  const empty = describeFamilyPanel('empty', {});
  assert.equal(empty.showCreateButton, true);
  assert.equal(empty.sessions.length, 0);

  const active = describeFamilyPanel('active', { family: { sessions: [{ sessionId: 's1', status: 'idle', turnCount: 2 }, { sessionId: 's2', status: 'failed-owned' }] } });
  assert.equal(active.emptyText, null);
  assert.equal(active.showComposer, true);
  assert.deepEqual(active.sessions, [
    { sessionId: 's1', status: 'idle', turnCount: 2 },
    { sessionId: 's2', status: 'failed-owned', turnCount: 0 },
  ]);
});

test('a disabled fan-out/composer control always carries its reason - flag-off never renders a bare blank', () => {
  const description = describeFamilyPanel('flag-off', { seatReason: null });
  assert.ok(description.emptyText && description.emptyText.length > 0, 'flag-off always has visible copy, even with no seatReason given');
});

test('forbidden-phrase list: none of the fixed panel copy strings contain a forbidden phrase', () => {
  const allCopy = [
    describeFamilyPanel('flag-off', { seatReason: 'not enabled for this seat' }).emptyText,
    describeFamilyPanel('loading', {}).emptyText,
    describeFamilyPanel('error', { error: 'network error' }).emptyText,
    describeFamilyPanel('empty', {}).emptyText,
  ].join(' ');
  for (const phrase of FORBIDDEN_PANEL_PHRASES) {
    assert.ok(!allCopy.toLowerCase().includes(phrase.toLowerCase()), `panel copy must never contain "${phrase}"`);
  }
});
