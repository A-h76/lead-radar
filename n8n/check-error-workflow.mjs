import fs from 'fs'; import assert from 'assert';
const d = JSON.parse(fs.readFileSync('n8n/lead-radar-error-handler.workflow.json', 'utf8'));
const code = d.nodes.find((n) => n.name === 'Build Failure Record').parameters.jsCode;

const run = (json, now = '2026-09-20T06:10:00.000Z') => {
  const ctx = { $json: json, $now: { toISO: () => now } };
  return new Function(...Object.keys(ctx), code)(...Object.values(ctx))[0].json;
};

// The whole point of this workflow: a crash always produces a "Failed" row, never a healthy-looking one
{
  const rec = run({
    execution: { id: 'exec123', error: { message: 'Apify: token missing/invalid', node: { name: 'Apify: Start Upwork 1' } } },
    workflow: { id: 'wf1' },
    trigger: { mode: 'webhook' },
  });
  assert.equal(rec.overallStatus, 'Failed');
  assert.equal(rec.runId, 'exec123');
  assert.equal(rec.errors, 'Apify: Start Upwork 1: Apify: token missing/invalid');
  assert.equal(rec.trigger, 'webhook');
  // numeric Runs fields intentionally blank, not 0 -- 0 would misleadingly read as "ran clean, found nothing"
  assert.equal(rec.itemsDiscovered, '');
  assert.equal(rec.newOpportunities, '');
}

// Defensive fallback when n8n's actual Error Trigger payload shape differs from what's expected here
// (the version-dependent case n8n/README.md's error-handler section warns about)
{
  const rec = run({});
  assert.equal(rec.overallStatus, 'Failed');
  assert.equal(rec.runId, 'unknown');
  assert.ok(rec.errors.includes('Unknown error'));
}

console.log('all checks pass');
