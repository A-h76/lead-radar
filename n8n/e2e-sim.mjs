// Headless E2E simulator for lead-radar.workflow.json. Offline: Apify/OpenAI/Airtable/SMTP are mocked.
// Runs the real jsCode, jsonBody and expressions. Usage: node n8n/e2e-sim.mjs
// ponytail: mimics n8n v1 semantics that matter here (disabled = passthrough on output 0, IF strict
// types, splitInBatches v3 done=0/loop=1, merge append, $('Node').item = that node's latest item).
// It is not n8n -- a real smoke run is still the final word.
import fs from 'fs';
const WF = JSON.parse(fs.readFileSync(new URL('./lead-radar.workflow.json', import.meta.url), 'utf8'));

// ---- mocks -----------------------------------------------------------------------------------
const CRAWL_ROWS = [
  { url: 'https://problogger.com/jobs/1', text: 'We need an evidence-based nutrition writer for our clinic blog. $0.20/word.', metadata: { title: 'Nutrition Content Writer' } },
  { url: 'https://problogger.com/jobs/2', text: 'Nutrition writer. Must be an RD.', metadata: { title: 'Dietitian Writer' } },
  { url: 'https://cozyjobs.com/writing-jobs/3', text: 'Drain cleaning quotes', metadata: { title: 'Plumbing copy' } },
  { url: 'https://cozyjobs.com/writing-jobs/4', text: 'B2B SaaS white paper on API security', metadata: { title: 'SaaS White Paper Writer' } },
];
const UPWORK_ROWS = [{ title: 'Medical writer for clinical trial summaries', description: 'Pharma', url: 'https://upwork.com/jobs/~01' }];
const ACTOR_ID = /^([A-Za-z0-9]{17}|[\w.-]+~[\w.-]+)$/;               // Apify: "user~name" or 17-char id; "user/name" 404s in a URL path
const WCC_KEYS = ['startUrls', 'crawlerType', 'maxCrawlPages', 'maxCrawlDepth', 'saveMarkdown', 'saveHtml', 'removeCookieWarnings',
  'respectRobotsTxtFile', 'proxyConfiguration', 'includeUrlGlobs', 'excludeUrlGlobs', 'maxResults', 'initialConcurrency', 'maxConcurrency',
  'dynamicContentWaitSecs', 'clickElementsCssSelector', 'removeElementsCssSelector', 'htmlTransformer', 'readableTextCharThreshold', 'useSitemaps'];
const WCC_CRAWLERS = ['playwright:adaptive', 'playwright:firefox', 'playwright:chrome', 'cheerio', 'jsdom'];

function mockHttp(req, sc) {
  const u = new URL(req.url);
  const bad = (status, msg) => { throw new Error(`HTTP ${status} ${req.method} ${req.url} -- ${msg}`); };
  if (u.host === 'api.apify.com') {
    if (u.searchParams.get('token') !== sc.env.APIFY_TOKEN || !sc.env.APIFY_TOKEN) bad(401, 'Apify: token missing/invalid');
    let m;
    if ((m = u.pathname.match(/^\/v2\/acts\/(.*)\/runs$/))) {
      const id = decodeURIComponent(m[1]);
      if (!ACTOR_ID.test(id)) bad(404, `Apify: actor "${id}" not found (use "apify~website-content-crawler", not a slash)`);
      if (id.includes('website-content-crawler')) {
        const b = req.body, extra = Object.keys(b).filter(k => !WCC_KEYS.includes(k));
        if (extra.length) bad(400, 'crawler input has unknown keys ' + extra);
        if (!Array.isArray(b.startUrls) || !b.startUrls.every(s => /^https?:\/\//.test(s.url))) bad(400, 'startUrls invalid');
        if (!WCC_CRAWLERS.includes(b.crawlerType)) bad(400, 'crawlerType invalid');
      }
      const run = `run_${id.includes('crawler') ? 'cs' : 'up'}_${++sc.runs}`;
      sc.polls[run] = 0;
      return { data: { id: run, status: 'READY', defaultDatasetId: 'ds_' + run } };
    }
    if ((m = u.pathname.match(/^\/v2\/actor-runs\/(.+)$/))) {
      if (!(m[1] in sc.polls)) bad(404, `run "${m[1]}" not found (expression resolved wrong)`);
      return { data: { id: m[1], status: ++sc.polls[m[1]] < 2 ? 'RUNNING' : sc.runStatus } };
    }
    if ((m = u.pathname.match(/^\/v2\/datasets\/ds_(.+)\/items$/)))
      return sc.runStatus !== 'SUCCEEDED' ? [] : m[1].includes('_cs_') ? sc.crawlRows : UPWORK_ROWS;
    bad(404, 'unmocked Apify path');
  }
  if (u.host === 'api.openai.com') {
    if (req.headers.Authorization !== 'Bearer ' + sc.env.OPENAI_API_KEY || !sc.env.OPENAI_API_KEY) bad(401, 'OpenAI key missing');
    const b = req.body;
    if (b.model !== 'gpt-4o-mini' || b.messages?.length !== 2 || !b.messages.every(x => typeof x.content === 'string')) bad(400, 'malformed chat body');
    if (/undefined/.test(b.messages[1].content)) bad(400, 'user message contains "undefined" -- lead fields missing');
    sc.openaiBodies.push(b);
    return { choices: [{ message: { content: JSON.stringify({ client_name: 'Acme', need_summary: 'x', budget_signal: '$', fit_score: 8, score_reasoning: 'Pillar 1 Tier A', urgency: 'High' }) } }] };
  }
  if (u.host === 'api.airtable.com') {
    if (!sc.env.AIRTABLE_BASE_ID || !sc.env.AIRTABLE_API_KEY) bad(404, 'Airtable base/key missing');
    if (req.method === 'GET' && u.searchParams.has('maxRecords')) {
      const f = u.searchParams.get('filterByFormula');
      if (/undefined/.test(f)) bad(422, 'filterByFormula has undefined url: ' + f);
      return { records: sc.existingUrls.some(x => f.includes(x)) ? [{ id: 'rec1' }] : [] };
    }
    if (req.method === 'POST') { sc.created.push(req.body.fields); return { id: 'recNew', fields: req.body.fields }; }
    return { records: sc.created.filter(f => f['Fit Score'] >= 7).map(fields => ({ fields })) };
  }
  bad(404, 'unmocked host ' + u.host);
}

// ---- engine ----------------------------------------------------------------------------------
const byName = Object.fromEntries(WF.nodes.map(n => [n.name, n]));
const children = (name, out) => (WF.connections[name]?.main?.[out] || []);
const parents = name => Object.entries(WF.connections).flatMap(([src, c]) => c.main.flatMap((outs, i) => outs.filter(o => o.node === name).map(() => src)));
export const ENV_REFS = [...new Set(JSON.stringify(WF).match(/\$env\.\w+/g).map(s => s.slice(5)))];

function simulate(sc) {
  const last = {};                       // node -> latest output items (for $('Node').item)
  const trace = [], state = {};
  const ctxFor = (item, items) => ({
    $json: item?.json ?? {}, $env: sc.env, $input: { all: () => items, first: () => items[0], item },
    $now: { toISO: () => '2026-09-13T06:00:00.000Z' },
    $: n => { if (!last[n]) throw new Error(`Referenced node "${n}" has not run`); return { item: last[n][0], first: () => last[n][0], all: () => last[n] }; },
  });
  const run = (src, ctx) => new Function(...Object.keys(ctx), src)(...Object.values(ctx));
  const ev = (v, ctx) => {
    if (typeof v !== 'string' || !v.startsWith('=')) return v;
    const s = v.slice(1), whole = s.match(/^\{\{([\s\S]*)\}\}$/);
    const e = x => { try { return run('return (' + x + ')', ctx); } catch (err) { throw new Error(`Expression error in ${JSON.stringify(x.slice(0, 80))}...: ${err.message}`); } };
    if (whole) return e(whole[1]);
    return s.replace(/\{\{([\s\S]*?)\}\}/g, (_, x) => { const r = e(x); return typeof r === 'object' ? JSON.stringify(r) : r; });
  };
  const http = (p, item, items) => {
    const ctx = ctxFor(item, items), kv = l => Object.fromEntries((l?.parameters || []).map(q => [q.name, String(ev(q.value, ctx))]));
    const url = new URL(ev(p.url, ctx));
    for (const [k, v] of Object.entries(p.sendQuery ? kv(p.queryParameters) : {})) url.searchParams.set(k, v);
    let body;
    if (p.sendBody) {
      const raw = ev(p.jsonBody, ctx);
      try { body = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { throw new Error('JSON parameter needs to be valid JSON: ' + e.message); }
    }
    const req = { method: p.method || 'GET', url: url.toString(), headers: p.sendHeaders ? kv(p.headerParameters) : {}, body };
    sc.requests.push({ node: '', ...req });
    return { json: mockHttp(req, sc) };
  };
  const ifCheck = (p, item, items) => {
    const ctx = ctxFor(item, items), strict = p.conditions.options.typeValidation === 'strict';
    const res = p.conditions.conditions.map(c => {
      const l = ev(c.leftValue, ctx), r = c.rightValue, t = c.operator.type;
      if (strict && typeof l !== t) throw new Error(`Wrong type: '${l}' is a ${typeof l} but was expecting a ${t} [condition ${c.leftValue}]`);
      return { equals: l === r, notEquals: l !== r, gt: l > r }[c.operator.operation];
    });
    return p.conditions.combinator === 'or' ? res.some(Boolean) : res.every(Boolean);
  };
  const exec = (node, items, inputIdx) => {
    const p = node.parameters;
    if (node.disabled) return [items];                                   // n8n: disabled node forwards input on output 0
    switch (node.type) {
      case 'n8n-nodes-base.httpRequest': {
        const out = items.map(i => http(p, i, items)).flatMap(o => Array.isArray(o.json) ? o.json.map(json => ({ json })) : [o]);
        return [out.length || !node.alwaysOutputData ? out : [{ json: {} }]];
      }
      case 'n8n-nodes-base.webhook': case 'n8n-nodes-base.scheduleTrigger':
      case 'n8n-nodes-base.wait': return [items];
      case 'n8n-nodes-base.if': { const t = [], f = []; for (const i of items) (ifCheck(p, i, items) ? t : f).push(i); return [t, f]; }
      case 'n8n-nodes-base.code': {
        const out = run(p.jsCode, ctxFor(items[0], items));
        if (!Array.isArray(out)) throw new Error('Code doesn\'t return items properly');
        return [out];
      }
      case 'n8n-nodes-base.merge': return [items];                         // append, inputs pre-concatenated below
      case 'n8n-nodes-base.splitInBatches': {
        const s = state[node.name] ??= { queue: [], done: [] };
        if (inputIdx === 'fresh') { s.queue = [...items]; s.done = []; } else s.done.push(...items);
        if (s.queue.length) return [[], s.queue.splice(0, p.batchSize)];
        return [s.done.length ? s.done : [{ json: {} }], []];
      }
      case 'n8n-nodes-base.emailSend': sc.emails.push(ev(p.subject, ctxFor(items[0], items))); return [items];
      default: throw new Error('unsupported node type ' + node.type);
    }
  };

  const stack = [{ name: sc.trigger, items: [{ json: {} }], from: null }];
  const mergeBuf = {};
  let steps = 0;
  while (stack.length || Object.keys(mergeBuf).length) {
    if (!stack.length) {                                                     // v1: run a waiting merge with what it has
      const [name, buf] = Object.entries(mergeBuf)[0]; delete mergeBuf[name];
      stack.push({ name, items: [...(buf[0] || []), ...(buf[1] || [])], from: 'merge(partial:' + Object.keys(buf) + ')' });
      continue;
    }
    const { name, items, from, idx } = stack.shift();
    const node = byName[name];
    if (++steps > sc.maxSteps) return { sc, trace, error: { node: name, message: `Infinite loop: >${sc.maxSteps} node executions. Last 8: ${trace.slice(-8).map(t => t.node).join(' -> ')}` } };
    if (node.type === 'n8n-nodes-base.merge' && from !== null && !String(from).startsWith('merge')) {
      const buf = mergeBuf[name] ??= {}; (buf[idx] ??= []).push(...items);
      if (Object.keys(buf).length < node.parameters.numberInputs) continue;
      delete mergeBuf[name];
      stack.unshift({ name, items: [...buf[0], ...buf[1]], from: 'merge(all)' });
      continue;
    }
    const firstEntry = node.type === 'n8n-nodes-base.splitInBatches' && from !== 'Is New Lead?' && from !== 'Airtable: Create Lead' ? 'fresh' : idx;
    let outs;
    const reqBefore = sc.requests.length;
    try { outs = exec(node, items, firstEntry); }
    catch (e) { trace.push({ node: name, input: items, error: e.message }); return { sc, trace, error: { node: name, message: e.message, input: items } }; }
    sc.requests.slice(reqBefore).forEach(r => (r.node = name));
    last[name] = outs[0].length ? outs[0] : (outs[1] || []);
    trace.push({ node: name, disabled: !!node.disabled, in: items.length, out: outs.map(o => o.length), output: outs });
    // v1 order is depth-first: children of this node run before its siblings.
    const next = [];
    outs.forEach((o, i) => o.length && children(name, i).forEach(c => next.push({ name: c.node, items: o, from: name, idx: c.index })));
    stack.unshift(...next);
  }
  return { sc, trace, error: null };
}

// ---- scenarios -------------------------------------------------------------------------------
const FAKE_ENV = { APIFY_TOKEN: 'apify_t', APIFY_CRAWLER_ACTOR_ID: 'apify~website-content-crawler', APIFY_UPWORK_ACTOR_ID: 'neatrat~upwork-job-scraper',
  OPENAI_API_KEY: 'sk-x', AIRTABLE_API_KEY: 'pat_x', AIRTABLE_BASE_ID: 'appX', DIGEST_FROM_EMAIL: 'a@x', DIGEST_TO_EMAIL: 'b@x' };
const mk = o => ({ trigger: 'Manual Run (Webhook)', env: FAKE_ENV, runStatus: 'SUCCEEDED', crawlRows: CRAWL_ROWS, existingUrls: ['cozyjobs.com/writing-jobs/4'],
  maxSteps: 400, runs: 0, polls: {}, requests: [], openaiBodies: [], created: [], emails: [], ...o });
const withNodes = (patch, fn) => { const saved = WF.nodes.map(n => ({ ...n })); WF.nodes.forEach(patch); try { return fn(); } finally { WF.nodes.forEach((n, i) => { for (const k in n) delete n[k]; Object.assign(n, saved[i]); }); } };

// The fix, applied to an in-memory copy only: IF output 0 = run finished -> Get Items, so a disabled IF
// passes through to Normalize instead of looping back to Wait; and '\n' inside the OpenAI expression's
// JS string literal becomes the escape sequence '\\n'.
const withFix = fn => {
  const saved = JSON.stringify(WF);
  for (const n of WF.nodes.filter(n => /^Apify: Run Done\?/.test(n.name) && n.parameters.conditions.combinator === 'or')) {
    n.parameters.conditions.conditions.forEach(c => (c.operator.operation = 'notEquals'));
    n.parameters.conditions.combinator = 'and';
    WF.connections[n.name].main.reverse();
  }
  const o = byName['OpenAI: Score Lead'];
  o.parameters.jsonBody = o.parameters.jsonBody.replace('\n\nListing text', '\\n\\nListing text')
    .replaceAll('$json.title', "$('Loop Leads').item.json.title").replaceAll('$json.description', "$('Loop Leads').item.json.description");
  try { return fn(); } finally { const s = JSON.parse(saved); WF.connections = s.connections; WF.nodes.forEach((n, i) => { for (const k in n) delete n[k]; Object.assign(n, s.nodes[i]); }); }
};
const SCENARIOS = {
  'A  as-is (Upwork disabled), crawler returns 4 rows': () => simulate(mk()),
  'B  Upwork disabled AND the 3 disabled IFs removed from the loop (what you intended)': () =>
    withNodes(() => {}, () => { const save = JSON.stringify(WF.connections);
      for (const k of [1, 2, 3]) WF.connections[`Manual Run (Webhook)`].main[0] = WF.connections[`Manual Run (Webhook)`].main[0]
        .map(c => c.node === `Apify: Start Upwork ${k}` ? { ...c, node: `Apify: Get Items Upwork ${k}` } : c);
      try { return simulate(mk()); } finally { WF.connections = JSON.parse(save); } }),
  'G  PROPOSED FIX applied in memory (IFs flipped, \\n escaped), Upwork disabled': () => withFix(() => simulate(mk())),
  'H  PROPOSED FIX + README-style actor id "apify/website-content-crawler"': () => withFix(() => simulate(mk({ env: { ...FAKE_ENV, APIFY_CRAWLER_ACTOR_ID: 'apify/website-content-crawler' } }))),
  'I  PROPOSED FIX + Upwork re-enabled': () => withFix(() => withNodes(n => { if (n.disabled) n.disabled = false; }, () => simulate(mk()))),
  'C  Upwork re-enabled, all mocks healthy': () => withNodes(n => { if (n.disabled) n.disabled = false; }, () => simulate(mk())),
  'D  as-is with README-style actor id "apify/website-content-crawler"': () => simulate(mk({ env: { ...FAKE_ENV, APIFY_CRAWLER_ACTOR_ID: 'apify/website-content-crawler' } })),
  'E  Upwork re-enabled, crawler run FAILED (empty datasets)': () => withNodes(n => { if (n.disabled) n.disabled = false; }, () => simulate(mk({ runStatus: 'FAILED' }))),
  'F  Upwork re-enabled, no env vars set': () => withNodes(n => { if (n.disabled) n.disabled = false; }, () => simulate(mk({ env: {} }))),
};

const short = v => { const s = JSON.stringify(v) ?? ''; return s.length > 400 ? s.slice(0, 400) + '...' : s; };
console.log('$env vars referenced by the workflow:', ENV_REFS.join(', '));
for (const [label, fn] of Object.entries(SCENARIOS)) {
  const sc = { };
  const r = fn();
  console.log('\n=== ' + label);
  const counts = {};
  for (const t of r.trace) counts[t.node] = (counts[t.node] || 0) + 1;
  console.log('node executions:', Object.entries(counts).map(([n, c]) => `${n}${c > 1 ? ' x' + c : ''}`).join(' | '));
  const tail = r.trace.filter(t => /Normalize|Merge|Pre-Filter|Score|Create|Digest|Top/.test(t.node));
  for (const t of tail.slice(0, 30)) console.log(`  ${t.node}: in=${t.in} out=${t.out ?? 'ERR'} ${t.output ? short(t.output.flat().map(i => i.json)) : ''}`);
  const s = r.sc;
  if (s) console.log(`  OpenAI calls=${s.openaiBodies.length} (user msgs: ${short(s.openaiBodies.map(b => b.messages[1].content.slice(0, 60)))})\n  Airtable created=${s.created.length} ${short(s.created.map(f => f['Source URL']))}\n  emails=${short(s.emails)}`);
  if (r.error) console.log(`  FAIL at "${r.error.node}": ${r.error.message}\n  input: ${short(r.error.input)}`);
  else console.log('  OK -- completed');
}
