export type PanelState = 'flag-off' | 'loading' | 'error' | 'empty' | 'active';

export function classifyPanelState(input: {
  seatEnabled: boolean;
  loading: boolean;
  error: string | null;
  family: { sessions: unknown[] } | null;
}): PanelState;

export const FORBIDDEN_PANEL_PHRASES: string[];

export interface FamilyPanelDescription {
  emptyText: string | null;
  isError: boolean;
  showCreateButton: boolean;
  sessions: Array<{ sessionId: unknown; status: string; turnCount: number }>;
  showComposer: boolean;
}

export function describeFamilyPanel(
  state: PanelState,
  data?: { seatReason?: string | null; error?: string | null; family?: { sessions: unknown[] } | null }
): FamilyPanelDescription;

export function buildFamilyPanelDom(description: FamilyPanelDescription): DocumentFragment;
