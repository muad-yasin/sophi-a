// The allow-list of providers a cnc-harness end user may pick for the `cnc` and `advisor` seats
// (PLAN.md "Addendum (2026-09-09, second)"). Backed by relay's own multi-provider
// src/providers.js `call(provider, opts)` - no new provider-calling code here, just this app's
// own policy of which of relay's supported providers get offered in cnc-harness's UI.
//
// xai (Grok) is deliberately excluded - a standing product rule (the author's explicit
// instruction, "anything goes, but Grok"), not a technical gap. Do not add it back without
// asking first, even though relay's providers.js itself supports it.
// envVar matches relay's own src/providers.js key names exactly (OPENAI_COMPAT + the Anthropic
// constant) - this is how a key entered in Sophi-A's own onboarding UI reaches relay's call().
export const ALLOWED_PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic (Claude / Fable)', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY' },
  { id: 'google', label: 'Google (Gemini)', envVar: 'GOOGLE_API_KEY' },
  { id: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY' },
  { id: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY' },
  { id: 'cohere', label: 'Cohere', envVar: 'COHERE_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
  { id: 'together', label: 'Together', envVar: 'TOGETHER_API_KEY' },
  { id: 'zai', label: 'Z.ai', envVar: 'ZAI_API_KEY' },
];

export function isAllowedProvider(id) {
  return ALLOWED_PROVIDERS.some(p => p.id === id);
}

export function envVarForProvider(id) {
  return ALLOWED_PROVIDERS.find(p => p.id === id)?.envVar;
}

// `cnc`'s native invocation_mode is claude-code-subprocess (Anthropic only - real tool use, file
// edits, --resume continuity). PLAN.md's second 2026-09-09 addendum makes `cnc` (and `advisor`,
// already messages-api) provider-selectable: when a seat declares `provider` and it isn't
// `anthropic`, a claude-code-subprocess seat falls back to messages-api - a real chat seat on
// that provider, honestly without tool-use/file-editing, never a faked equivalent coding agent.
//
// Moved here (out of index.js, security-review fix 2026-09-16) so preflight.js can derive a
// seat's readiness requirement from the same live rule index.js's own dispatch path uses,
// instead of keeping two independent readings of "what does this seat actually need right now" -
// one of index.js's own hard rules (loose coupling through one composition point; derive, don't
// duplicate).
export function effectiveInvocationMode(seat) {
  if (seat.invocation_mode === 'claude-code-subprocess' && seat.provider && seat.provider !== 'anthropic') {
    return 'messages-api';
  }
  return seat.invocation_mode;
}
