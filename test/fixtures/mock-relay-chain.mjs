// Sophi-A "family" MVP, build item 1 (relay/runs/2026-09-15T18-55-34-601Z/build.md §5.1):
// three canned relay-chain outcome scenarios for offline tests of anything that reads a chain
// run's report.json-shaped signoff data (the compassion-state classifier, the family receipts
// panel) - no network call, no real model, no real relay process ever involved.
//
// Contract:
//   SCENARIOS: the three scenario names below.
//   mockRelayChain(scenario) -> { signoff: [{ provider, model, signedOff, objections }],
//                                  holdout: null | { provider, objections },
//                                  rawCriticReplies: { [provider]: string } }
//     Pure, synchronous, deterministic - same shape every call for the same scenario name.
//     `signoff`/`holdout` mirror the real engine's report.json fields (relay's own
//     mcp__relay__run_status output), not a new shape invented for this fixture.

export const SCENARIOS = ['all-approve', 'one-holdout', 'malformed-json-critic'];

const PROVIDERS = ['deepseek', 'qwen', 'glm'];

function cleanSignoff() {
  return PROVIDERS.map(provider => ({
    provider,
    model: `mock/${provider}-1`,
    signedOff: true,
    objections: [],
  }));
}

function scenarioAllApprove() {
  return {
    signoff: cleanSignoff(),
    holdout: null,
    rawCriticReplies: Object.fromEntries(
      PROVIDERS.map(p => [p, JSON.stringify({ signedOff: true, objections: [] })])
    ),
  };
}

function scenarioOneHoldout() {
  const signoff = cleanSignoff();
  // The holdout critic's entry carries a `refusal` field (build.md §5.1's own acceptance
  // wording) distinct from `objections` - `objections` is the structured list any critic can
  // carry, `refusal` is the plain-English reason this one specifically declined to sign off,
  // the same field the compassion-state HOLDOUT badge (build.md §4) reveals verbatim via its
  // "Show Reason" button.
  const holdoutEntry = {
    provider: 'glm',
    model: 'mock/glm-1',
    signedOff: false,
    objections: ['item 4 proposes new test infrastructure, out of scope'],
    refusal: 'Declining to sign off: item 4 proposes new test infrastructure, out of scope for this round.',
  };
  const idx = signoff.findIndex(s => s.provider === 'glm');
  signoff[idx] = holdoutEntry;
  return {
    signoff,
    holdout: { provider: 'glm', objections: holdoutEntry.objections },
    rawCriticReplies: {
      deepseek: JSON.stringify({ signedOff: true, objections: [] }),
      qwen: JSON.stringify({ signedOff: true, objections: [] }),
      glm: JSON.stringify({ signedOff: false, objections: holdoutEntry.objections, refusal: holdoutEntry.refusal }),
    },
  };
}

function scenarioMalformedJsonCritic() {
  // Reproduces the real relay bug shape already fixed upstream this session: a critic reply
  // wrapped in a markdown code fence (```json ... ```) instead of bare JSON. The raw text here
  // is deliberately fenced and deliberately NOT pre-parsed - a consumer of this fixture is
  // exercising its own fence-stripping/parse-failure handling, not trusting this fixture to do
  // it. `signedOff: null` (not `false`) is the correct abstention shape for "no readable
  // verdict" per verification-and-critique's rule: unreadable is not a pass and not a clean
  // failure either.
  const signoff = cleanSignoff();
  const idx = signoff.findIndex(s => s.provider === 'qwen');
  signoff[idx] = { provider: 'qwen', model: 'mock/qwen-1', signedOff: null, objections: null };
  return {
    signoff,
    holdout: null,
    rawCriticReplies: {
      deepseek: JSON.stringify({ signedOff: true, objections: [] }),
      qwen: '```json\n{"signedOff": true, "objections": []}\n```',
      glm: JSON.stringify({ signedOff: true, objections: [] }),
    },
  };
}

const BUILDERS = {
  'all-approve': scenarioAllApprove,
  'one-holdout': scenarioOneHoldout,
  'malformed-json-critic': scenarioMalformedJsonCritic,
};

export function mockRelayChain(scenario) {
  const build = BUILDERS[scenario];
  if (!build) throw new Error(`mockRelayChain: unknown scenario "${scenario}" - expected one of ${SCENARIOS.join(', ')}`);
  return build();
}
