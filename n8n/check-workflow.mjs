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
console.log('all checks pass');
