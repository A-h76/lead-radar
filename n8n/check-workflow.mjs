import fs from 'fs'; import assert from 'assert';
const d = JSON.parse(fs.readFileSync('n8n/lead-radar.workflow.json','utf8'));
const code = n => d.nodes.find(x=>x.name===n).parameters.jsCode;
const run = (src, items) => new Function('$input', src)({ all: () => items.map(json=>({json})) });

// Normalize drops junk, never returns []
const up = code('Normalize: Upwork');
assert.deepEqual(run(up, [{}]), [{json:{__empty:'Upwork',__raw:0}}]);
assert.deepEqual(run(up, [{title:'x'}]), [{json:{__empty:'Upwork',__raw:1}}]); // no url -> sentinel
assert.equal(run(up, [{title:'Medical writer',url:'u'}])[0].json.platform,'Upwork');
assert.equal(run(code('Normalize: Company Sites'), [{}])[0].json.__empty,'Company Site');

// Pre-filter: all-empty throws, sentinels stripped, keywords applied
const kf = code('Keyword Pre-Filter');
assert.throws(()=>run(kf,[{__empty:'Upwork'},{__empty:'Company Site'}]), /Upwork, Company Site/);
assert.deepEqual(run(kf,[{__empty:'Upwork'},{title:'Plumbing quotes',description:'drains'}]), []);
// both pillars reach scoring
for (const t of ['Clinical nutrition writer','SaaS white paper writer','B2B technical writer'])
  assert.equal(run(kf,[{__empty:'Upwork'},{title:t,description:'',url:'u'}]).length,1,t);
// secondary tier passes the filter on purpose -- the model tiers it, not the keyword list
assert.equal(run(kf,[{title:'SEO blog writer',description:'',url:'u'}]).length,1);
// RD/RDN-required postings are dropped before scoring (MSc Nutrition, not an RD)
const rd = (title, description='') => run(kf,[{title,description,url:'u'}]).length;
assert.equal(rd('Nutrition writer','Must be an RD'), 0);
assert.equal(rd('Nutrition writer','RDN credential required'), 0);
assert.equal(rd('Nutrition writer','Registered Dietitian preferred'), 0);
assert.equal(rd('Nutrition writer','Evidence-based nutrition blog'), 1);
assert.equal(rd('Nutrition writer','Office at 3rd St, Oxford Rd'), 1);  // lowercase rd is not the credential

// legal is gone from the automation
assert.ok(!code('Keyword Pre-Filter').includes("'rfp'"));
assert.ok(!/legal|compliance|RFP/.test(d.nodes.find(n=>n.name==='OpenAI: Score Lead').parameters.jsonBody));

// Upwork branch is parked: neatrat~upwork-job-scraper hit its 100-result free-tier
// lifetime cap. The 15 Apify nodes are disabled; a disabled node forwards its input on
// output 0 only, so the trigger item reaches Normalize: Upwork (-> __empty sentinel)
// only if every node's output 0 leads there. Re-enable = flip these 15 flags back.
for (const n of d.nodes.filter(n=>n.name.startsWith('Apify: Run Done?'))) {
  const src = n.name.replace('Run Done? ', '');
  assert.equal(d.connections[n.name].main[0][0].node, src.replace('Apify: ', 'Apify: Get Items '), n.name+' output 0 must be "finished"');
  assert.equal(d.connections[n.name].main[1][0].node, src.replace('Apify: ', 'Apify: Wait '), n.name+' output 1 must loop to Wait');
  assert.ok(n.parameters.conditions.conditions.every(c=>c.operator.operation==='notEquals') && n.parameters.conditions.combinator==='and');
}
// OpenAI sits after the Airtable IF, so $json there is Airtable's response, not the lead
const ob = d.nodes.find(n=>n.name==='OpenAI: Score Lead').parameters.jsonBody;
assert.ok(!/\$json\./.test(ob) && !ob.includes('\n'), 'OpenAI body must read $(\'Loop Leads\') and contain no raw newline');
assert.equal(d.nodes.filter(n=>n.disabled).length, 15);
assert.ok(d.nodes.filter(n=>n.disabled).every(n=>/^Apify: .*Upwork \d$/.test(n.name)));
assert.ok(!d.nodes.find(n=>n.name==='Normalize: Upwork').disabled);  // must stay on to emit the sentinel
assert.ok(!d.nodes.find(n=>n.name==='Apify: Start Company Sites').disabled);

// Merge is append, Get Items always emit
assert.equal(d.nodes.find(n=>n.name==='Merge Sources').parameters.mode,'append');
// Normalize: Upwork must run once. With 3 direct parents it ran 3 times, and n8n executed the 2
// leftover Merge Sources runs after the loop with only the Upwork sentinel -> "0 items (Upwork)".
const into = n => Object.entries(d.connections).flatMap(([s,c]) => c.main.flat().filter(o=>o.node===n).map(()=>s));
assert.deepEqual(into('Normalize: Upwork'), ['Merge Upwork']);
const mu = d.nodes.find(n=>n.name==='Merge Upwork');
assert.ok(mu.parameters.numberInputs === 3 && mu.parameters.mode === 'append' && !mu.disabled);
assert.equal(d.nodes.filter(n=>n.alwaysOutputData).length,4);
// actor input must match the real schemas -- perPage/pagesToScrape do not exist on the Upwork actor
const ALLOWED = ['query','maxJobAge','paymentVerified','experienceLevel','jobType','clientHistory'];
for (const n of d.nodes.filter(n=>n.name.startsWith('Apify: Start Upwork'))) {
  const body = JSON.parse(n.parameters.jsonBody.slice(1));
  assert.deepEqual(Object.keys(body).filter(k=>!ALLOWED.includes(k)), [], n.name);
  assert.equal(body.maxJobAge.value, 24);          // must match the daily schedule
  assert.equal(body.paymentVerified, true);
  assert.ok(!body.experienceLevel.includes('entry'));
}
const cs = JSON.parse(d.nodes.find(n=>n.name==='Apify: Start Company Sites').parameters.jsonBody.slice(1));
assert.ok(cs.crawlerType.startsWith('playwright'));  // both boards render client-side
assert.ok(!JSON.stringify(cs).includes('example-'), 'placeholder URLs still present');
// list pages never become leads: the crawler follows only job-post links, Normalize drops the rest
assert.deepEqual(cs.includeUrlGlobs.map(g=>g.glob), ['https://problogger.com/jobs/job/**','https://cozyjobs.com/jobs/**']);
const ncs = code('Normalize: Company Sites');
for (const url of ['https://problogger.com/jobs/','https://cozyjobs.com/writing-jobs'])
  assert.equal(run(ncs,[{url,text:'Nutrition writer jobs',metadata:{title:'Jobs'}}])[0].json.__empty,'Company Site',url);
assert.equal(run(ncs,[{url:'https://problogger.com/jobs/job/x/',text:'t',metadata:{title:'X'}}])[0].json.platform,'Company Site');
// "ProBlogger" is in every job page title; it must not satisfy the 'blog' keyword
assert.equal(run(kf,[{title:'Garden writer - ProBlogger Jobs',description:'Product descriptions',url:'u'}]).length,0);

// --- Runs health-check layer -------------------------------------------------------------------

// Both triggers funnel through one "Start Run" choke point, which still reaches all 4 Apify
// Start nodes (same fan-out the triggers used to drive directly).
const APIFY_STARTS = ['Apify: Start Upwork 1','Apify: Start Upwork 2','Apify: Start Upwork 3','Apify: Start Company Sites'];
for (const trig of ['Manual Run (Webhook)','Daily Schedule'])
  assert.deepEqual(d.connections[trig].main[0].map(c=>c.node), ['Start Run'], trig);
assert.deepEqual(d.connections['Start Run'].main[0].map(c=>c.node).sort(), [...APIFY_STARTS].sort());

// Merge Sources -> Record Source Stats -> Keyword Pre-Filter (stats tap doesn't reorder anything)
assert.deepEqual(d.connections['Merge Sources'].main[0].map(c=>c.node), ['Record Source Stats']);
assert.deepEqual(d.connections['Record Source Stats'].main[0].map(c=>c.node), ['Keyword Pre-Filter']);

// A Runs record is written on every run (manual or scheduled); only the digest email is gated.
assert.deepEqual(d.connections['Was Scheduled?'].main[0].map(c=>c.node).sort(), ['Scheduled Run?','Write Run Record'].sort());
assert.deepEqual(d.connections['Write Run Record'].main[0].map(c=>c.node), ['Airtable: Write Run']);
assert.ok(d.nodes.find(n=>n.name==='Airtable: Write Run').parameters.url.includes('/Runs'));
assert.ok(d.nodes.find(n=>n.name==='Airtable: Write Run').retryOnFail);

// run2: same isolation-test approach as run(), but for the new nodes, which read $getWorkflowStaticData/
// $execution/$now/$('Node') in addition to $input.
const run2 = (src, items, {sd = {}, execId = 'exec_test', now = '2026-09-20T06:00:00.000Z', ran = []} = {}) => {
  const ctx = {
    $input: { all: () => items.map(json => ({ json })) },
    $getWorkflowStaticData: () => sd,
    $execution: { id: execId },
    $now: { toISO: () => now },
    $: (name) => { if (!ran.includes(name)) throw new Error(`"${name}" has not run`); return { item: null }; },
  };
  return new Function(...Object.keys(ctx), src)(...Object.values(ctx));
};

// Start Run: reads which trigger actually executed, stamps a fresh counters object
{
  const sd = {};
  const out = run2(code('Start Run'), [{}], { sd, ran: ['Manual Run (Webhook)'], execId: 'e1' });
  assert.equal(sd.trigger, 'manual');
  assert.equal(sd.runId, 'e1');
  assert.deepEqual(sd.sources, {});
  assert.equal(sd.itemsDiscovered, 0);
  assert.deepEqual(out, [{json:{}}]);  // passthrough, unchanged
}
{
  const sd = {};
  run2(code('Start Run'), [{}], { sd, ran: [] });  // Manual Run node did not fire this execution
  assert.equal(sd.trigger, 'scheduled');
}

// Record Source Stats: tallies per source, passes items through byte-for-byte unchanged
{
  const sd = {};
  const items = [{__empty:'Upwork', __raw:0}, {platform:'Company Site', title:'a'}, {platform:'Company Site', title:'b'}];
  const out = run2(code('Record Source Stats'), items, { sd });
  assert.deepEqual(sd.sources, { Upwork: 0, 'Company Site': 2 });
  assert.equal(sd.itemsDiscovered, 2);
  assert.deepEqual(out.map(i=>i.json), items);
}

// Write Run Record: tells duplicates from created leads, counts AI-parse failures, flags "No Items Found"
{
  const sd = { runId: 'e2', trigger: 'scheduled', startedAt: '2026-09-20T06:00:00.000Z',
    sources: { Upwork: 0, 'Company Site': 5 }, itemsDiscovered: 5 };
  const items = [
    { title: 'dup', url: 'u1', platform: 'Company Site' },                                       // duplicate-skip shape
    { id: 'rec1', fields: { 'Score Reasoning': 'AI response was not valid JSON -- check the prompt/model.' } }, // ai failure
    { id: 'rec2', fields: { 'Score Reasoning': 'Pillar 1 Tier A' } },                              // real create
  ];
  const rec = run2(code('Write Run Record'), items, { sd, now: '2026-09-20T06:05:00.000Z' })[0].json;
  assert.equal(rec.runId, 'e2');
  assert.equal(rec.trigger, 'Scheduled');
  assert.equal(rec.newOpportunities, 2);
  assert.equal(rec.duplicates, 1);
  assert.equal(rec.aiAnalyses, 2);
  assert.equal(rec.aiFailures, 1);
  assert.equal(rec.itemsFiltered, Math.max(5 - 3, 0));
  assert.equal(rec.overallStatus, 'Success');
  assert.equal(rec.sourceStatus, 'Upwork: 0 items | Company Site: 5 items');
  assert.equal(rec.durationSec, 300);
}
{
  // every source genuinely empty -> distinct from a crash, not "Success"
  const sd = { runId: 'e3', trigger: 'manual', startedAt: '2026-09-20T06:00:00.000Z', sources: { Upwork: 0, 'Company Site': 0 }, itemsDiscovered: 0 };
  const rec = run2(code('Write Run Record'), [], { sd })[0].json;
  assert.equal(rec.overallStatus, 'No Items Found');
  assert.equal(rec.newOpportunities, 0);
}

console.log('all checks pass');
