// ponytail: in-memory, per-instance. Fine for a single Railway replica;
// move to Airtable/Redis if this ever needs to survive restarts or scale out.
//
// This only tracks whether the trigger *request* was sent, not whether the
// n8n workflow has finished — n8n's webhook typically responds as soon as it
// accepts the run, while the actual scrape + scoring keeps going for a
// minute or two after that. The UI is worded around that honestly rather
// than implying real-time completion tracking it doesn't have.
type RunState = { lastTriggeredAt: string | null };

const state: RunState = { lastTriggeredAt: null };

export function getRunState() {
  return state;
}

export function recordTrigger() {
  state.lastTriggeredAt = new Date().toISOString();
}
