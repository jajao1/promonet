# Continuous General Offers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect and publish up to ten new Mercado Livre offers from ten non-food categories every twenty minutes without a daily cap.

**Architecture:** Keep the existing OAuth source, affiliate converter, Evolution sender, and PostgreSQL stores. Expand niche validation, select a bounded batch per category, atomically claim every due category, and process each offer serially so a failed category or item does not block the remaining work. Seven-day publication history remains the only volume deduplication rule.

**Tech Stack:** Node.js 24 ESM, PostgreSQL 17, Evolution API 2.3.7, Docker Compose, Node test runner.

---

## File map

- Modify `bot/niches.mjs`: permit five-minute schedules, shared group destinations, and batch sizes from 1 through 10.
- Modify `bot/test/niches.test.mjs`: specify the new configuration contract.
- Modify `bot/offer-policy.mjs`: expose deterministic multi-offer selection.
- Modify `bot/test/offer-policy.test.mjs`: verify ordering, limits, and deduplication.
- Modify `bot/collector-store.mjs`: claim all due niches in one scheduler pass.
- Modify `bot/test/collector-store.test.mjs`: verify multi-niche claims.
- Modify `bot/collector.mjs`: process multiple niches and offers serially with partial-failure isolation.
- Modify `bot/test/collector.test.mjs`: cover batches, multiple niches, session alerts, and ambiguous delivery.
- Modify `bot/server.mjs`: invoke the batch collector.
- Modify `config/niches.json`: enable ten verified non-food Mercado Livre categories against the current WhatsApp group.
- Modify `README.md`: document continuous collection and the meaning of `limit`.

### Task 1: Expand the niche configuration contract

**Files:**
- Modify: `bot/niches.mjs`
- Test: `bot/test/niches.test.mjs`

- [ ] **Step 1: Write a failing validation test**

Add a test that passes two categories sharing one destination, each with a five-minute interval and a limit greater than one:

```js
test("accepts shared destinations and bounded five-minute batches",()=>{
  const niches=validateNiches({niches:[
    {id:"technology",categoryId:"MLB1000",destinationGroup:"120363411422374407@g.us",tag:"vijo3432338",intervalMinutes:5,limit:3,enabled:true},
    {id:"home",categoryId:"MLB1574",destinationGroup:"120363411422374407@g.us",tag:"vijo3432338",intervalMinutes:5,limit:5,enabled:true},
  ]});
  assert.equal(niches.length,2);
  assert.equal(niches[1].limit,5);
});
```

Also add invalid cases for `intervalMinutes: 4`, `limit: 0`, and `limit: 11`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test bot/test/niches.test.mjs`

Expected: the shared destination or five-minute interval is rejected with `invalid_niche`.

- [ ] **Step 3: Implement the new contract**

In `validateNiches`, retain unique IDs and category IDs, remove destination uniqueness, and replace the old interval/limit condition with:

```js
!Number.isInteger(n.intervalMinutes) || n.intervalMinutes < 5 ||
!Number.isInteger(n.limit) || n.limit < 1 || n.limit > 10 ||
typeof n.enabled !== "boolean"
```

- [ ] **Step 4: Run the niche tests and verify GREEN**

Run: `node --test bot/test/niches.test.mjs`

Expected: all niche tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/niches.mjs bot/test/niches.test.mjs
git commit -m "feat: support frequent batched niches"
```

### Task 2: Select multiple offers deterministically

**Files:**
- Modify: `bot/offer-policy.mjs`
- Test: `bot/test/offer-policy.test.mjs`

- [ ] **Step 1: Write a failing selector test**

Import `selectOffers` and specify the public behavior:

```js
test("selects a bounded discounted batch without recent items",()=>{
  const candidates=[
    {...item,itemId:"MLB1",rank:2,price:80,originalPrice:100},
    {...item,itemId:"MLB2",rank:1,price:50,originalPrice:100},
    {...item,itemId:"MLB3",rank:0,price:70,originalPrice:100},
  ];
  assert.deepEqual(
    selectOffers(candidates,{categoryId:item.categoryId,recentIds:new Set(["MLB2"]),limit:2}).map(x=>x.itemId),
    ["MLB3","MLB1"],
  );
});
```

Add a second assertion that repeated candidate IDs appear only once.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test bot/test/offer-policy.test.mjs`

Expected: import failure because `selectOffers` does not exist.

- [ ] **Step 3: Implement selection as one policy boundary**

Add:

```js
export function selectOffers(candidates,{categoryId,recentIds,limit}){
  const seen=new Set();
  return candidates
    .filter(c=>valid(c,categoryId,recentIds)&&!seen.has(c.itemId)&&seen.add(c.itemId))
    .sort((a,b)=>discount(b)-discount(a)||a.rank-b.rank||a.itemId.localeCompare(b.itemId))
    .slice(0,limit);
}

export function selectOffer(candidates,options){
  return selectOffers(candidates,{...options,limit:1})[0]??null;
}
```

- [ ] **Step 4: Run policy tests and verify GREEN**

Run: `node --test bot/test/offer-policy.test.mjs`

Expected: all offer-policy tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/offer-policy.mjs bot/test/offer-policy.test.mjs
git commit -m "feat: select multiple eligible offers"
```

### Task 3: Claim every due niche in one pass

**Files:**
- Modify: `bot/collector-store.mjs`
- Test: `bot/test/collector-store.test.mjs`

- [ ] **Step 1: Write a failing store test**

Use a database fake that returns a row for enabled due niches and verify all claims are attempted:

```js
test("claims every enabled due niche in configuration order",async()=>{
  const calls=[];
  const db={query:async(sql,args)=>{calls.push(args);return{rows:[{niche_id:args[0]}]};}};
  const store=new CollectorStore(db);
  const niches=[
    {id:"technology",enabled:true,intervalMinutes:5},
    {id:"home",enabled:false,intervalMinutes:5},
    {id:"games",enabled:true,intervalMinutes:5},
  ];
  assert.deepEqual((await store.claimDueNiches(niches)).map(x=>x.id),["technology","games"]);
  assert.deepEqual(calls.map(x=>x[0]),["technology","games"]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test bot/test/collector-store.test.mjs`

Expected: `store.claimDueNiches is not a function`.

- [ ] **Step 3: Implement multi-niche claims**

Replace `claimDueNiche` with:

```js
async claimDueNiches(niches){
  const claimed=[];
  for(const niche of niches.filter(x=>x.enabled)){
    const result=await this.db.query(`INSERT INTO promonet.collector_runs(niche_id,last_started_at,last_result)
      VALUES($1,now(),'running')
      ON CONFLICT(niche_id) DO UPDATE SET last_started_at=now(),last_result='running',updated_at=now()
      WHERE promonet.collector_runs.last_started_at IS NULL
         OR promonet.collector_runs.last_started_at + ($2 * interval '1 minute') <= now()
      RETURNING niche_id`,[niche.id,niche.intervalMinutes]);
    if(result.rows.length) claimed.push(niche);
  }
  return claimed;
}
```

- [ ] **Step 4: Run store tests and verify GREEN**

Run: `node --test bot/test/collector-store.test.mjs`

Expected: all collector-store tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/collector-store.mjs bot/test/collector-store.test.mjs
git commit -m "feat: claim all due offer niches"
```

### Task 4: Publish batches with partial-failure isolation

**Files:**
- Modify: `bot/collector.mjs`
- Modify: `bot/server.mjs`
- Test: `bot/test/collector.test.mjs`

- [ ] **Step 1: Write the failing batch tests**

Replace single-offer-only assumptions with tests around `collectDue`. The main success case must use two niches and two items per niche:

```js
test("publishes bounded batches across all due niches",async()=>{
  const events=[],sends=[];
  const niches=[
    {...niche,id:"technology",categoryId:"MLB1000",limit:2},
    {...niche,id:"games",categoryId:"MLB1144",limit:2},
  ];
  const store={
    claimDueNiches:async()=>niches,
    recentItemIds:async()=>new Set(),
    savePreview:async(...x)=>events.push(["preview",...x]),
    markPublished:async(...x)=>events.push(["published",...x]),
    markReview:async(...x)=>events.push(["review",...x]),
    completeRun:async(...x)=>events.push(["complete",...x]),
  };
  const source={list:async category=>[0,1].map(rank=>({...candidate,itemId:`${category}-${rank}`,categoryId:category,scopeCategoryId:category,rank}))};
  const result=await collectDue({store,niches,source,authorizedToken:async()=>"token",meli:{convert:async url=>`https://meli.la/${url.at(-1)}`},evolution:{send:async job=>sends.push(job)},dryRun:false,delay:async()=>{}});
  assert.deepEqual(result,{niches:2,published:4,review:0,empty:0});
  assert.equal(sends.length,4);
});
```

Add focused tests named `conversion failure does not block later batch items`, `ambiguous delivery is reviewed without publication`, `expired affiliate session alerts once per pass`, and `successful batch sends are spaced`. Each test uses the same public `collectDue` seam, supplies two candidates, and asserts exact `published`, `review`, `send`, alert, and delay call counts.

- [ ] **Step 2: Run the collector tests and verify RED**

Run: `node --test bot/test/collector.test.mjs`

Expected: import failure because `collectDue` does not exist.

- [ ] **Step 3: Implement serial batch processing**

Export `collectDue` from `bot/collector.mjs`. It must:

```js
const due=await store.claimDueNiches(niches);
const summary={niches:due.length,published:0,review:0,empty:0};
const token=due.length?await authorizedToken():null;
let sessionAlerted=false;
for(const niche of due){
  let nicheReview=0;
  const recentIds=await store.recentItemIds(niche.id);
  const candidates=await source.list(niche.categoryId,token);
  const selected=selectOffers(candidates,{categoryId:niche.categoryId,recentIds,limit:niche.limit});
  if(!selected.length){summary.empty++;await store.completeRun(niche.id,"empty");continue;}
  for(const offer of selected){
    await store.savePreview(niche.id,offer,dryRun?"simulated":"selected");
    if(dryRun) continue;
    try{
      const affiliateUrl=await meli.convert(offer.permalink,niche.tag,false);
      sessionAlert?.restored();
      await evolution.send({destination:niche.destinationGroup,text:formatOffer(offer,affiliateUrl),kind:"image",mimetype:"image/jpeg"},offer.imageUrl);
      await store.markPublished(niche.id,offer.itemId,affiliateUrl);
      summary.published++;
      await delay(sendDelayMs);
    }catch(error){
      await store.markReview(niche.id,offer.itemId);
      summary.review++;
      nicheReview++;
      if(["session_expired","meli_session_missing"].includes(error?.message)&&!sessionAlerted){
        sessionAlerted=true;
        try{await sessionAlert?.required();}catch{}
      }
    }
  }
  await store.completeRun(niche.id,dryRun?"simulated":nicheReview?"partial":"published");
}
return summary;
```

Import `selectOffers`, inject `delay` from `node:timers/promises`, and default `sendDelayMs` to `15000`. In `bot/server.mjs`, replace the `collectOnce` import/call with `collectDue` and pass:

```js
sendDelayMs: Number(env.COLLECTOR_SEND_DELAY_MS ?? 15000)
```

Validate the environment value is an integer from 1000 through 60000 before starting.

- [ ] **Step 4: Run collector and server-related tests**

Run: `node --test bot/test/collector.test.mjs bot/test/collector-runtime.test.mjs`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/collector.mjs bot/server.mjs bot/test/collector.test.mjs
git commit -m "feat: publish continuous offer batches"
```

### Task 5: Configure ten non-food categories

**Files:**
- Modify: `config/niches.json`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `README.md`

- [ ] **Step 1: Replace niche configuration with verified category IDs**

Use the current group `120363411422374407@g.us`, tag `vijo3432338`, interval `20`, and limit `1` for each entry. Omit the `MLB1403` food category so one pass can publish at most ten offers:

```json
{
  "niches": [
    {"id":"technology","categoryId":"MLB1000","destinationGroup":"120363411422374407@g.us","tag":"vijo3432338","intervalMinutes":20,"limit":1,"enabled":true},
    {"id":"games","categoryId":"MLB1144","destinationGroup":"120363411422374407@g.us","tag":"vijo3432338","intervalMinutes":20,"limit":1,"enabled":true},
    {"id":"home","categoryId":"MLB1574","destinationGroup":"120363411422374407@g.us","tag":"vijo3432338","intervalMinutes":20,"limit":1,"enabled":true},
    {"id":"fashion","categoryId":"MLB1430","destinationGroup":"120363411422374407@g.us","tag":"vijo3432338","intervalMinutes":20,"limit":1,"enabled":true},
    {"id":"beauty","categoryId":"MLB1246","destinationGroup":"120363411422374407@g.us","tag":"vijo3432338","intervalMinutes":20,"limit":1,"enabled":true},
    {"id":"health","categoryId":"MLB264586","destinationGroup":"120363411422374407@g.us","tag":"vijo3432338","intervalMinutes":20,"limit":1,"enabled":true},
    {"id":"sports","categoryId":"MLB1276","destinationGroup":"120363411422374407@g.us","tag":"vijo3432338","intervalMinutes":20,"limit":1,"enabled":true},
    {"id":"tools","categoryId":"MLB263532","destinationGroup":"120363411422374407@g.us","tag":"vijo3432338","intervalMinutes":20,"limit":1,"enabled":true},
    {"id":"automotive","categoryId":"MLB5672","destinationGroup":"120363411422374407@g.us","tag":"vijo3432338","intervalMinutes":20,"limit":1,"enabled":true},
    {"id":"baby","categoryId":"MLB1384","destinationGroup":"120363411422374407@g.us","tag":"vijo3432338","intervalMinutes":20,"limit":1,"enabled":true}
  ]
}
```

- [ ] **Step 2: Expose the send spacing variable**

Add to `.env.example`:

```dotenv
COLLECTOR_SEND_DELAY_MS=15000
```

Add to the bot environment in `compose.yaml`:

```yaml
COLLECTOR_SEND_DELAY_MS: ${COLLECTOR_SEND_DELAY_MS:-15000}
```

- [ ] **Step 3: Document operational behavior**

Update the collector section in `README.md` to state:

```markdown
Cada nicho pode publicar de 1 a 10 ofertas por ciclo por meio de `limit`. A produção usa dez nichos sem alimentos, intervalo de 20 minutos e uma oferta por nicho, totalizando no máximo dez ofertas por ciclo. Itens publicados são ignorados por sete dias. `COLLECTOR_SEND_DELAY_MS` serializa as mensagens e usa 15000 ms por padrão.
```

- [ ] **Step 4: Validate configuration and run the full suite**

Run:

```bash
node -e "import('./bot/niches.mjs').then(async({validateNiches})=>console.log(validateNiches(JSON.parse(await (await import('node:fs/promises')).readFile('config/niches.json','utf8'))).length))"
npm test
```

Expected: first command prints `10`; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add config/niches.json .env.example compose.yaml README.md
git commit -m "config: enable general continuous offers"
```

### Task 6: Deploy and verify real behavior

**Files:**
- No source changes expected.

- [ ] **Step 1: Push reviewed commits**

Run: `git push origin main`

Expected: the remote `main` branch advances to the local commit.

- [ ] **Step 2: Deploy without replacing secrets or databases**

On the VPS run:

```bash
cd /opt/promonet
git pull --ff-only
docker compose -f compose.yaml -f compose.prod.yaml up -d --build bot caddy
```

Expected: `bot` becomes healthy; PostgreSQL, Redis, Evolution, and Caddy remain running.

- [ ] **Step 3: Verify integrations before releasing the first batch**

Run:

```bash
docker compose -f compose.yaml -f compose.prod.yaml exec -T bot node scripts/check-meli-oauth.mjs
docker compose -f compose.yaml -f compose.prod.yaml ps
```

Expected: OAuth reports `authorized:true`; bot and its dependencies are healthy; Evolution instance reports `open` through its connection-state endpoint.

- [ ] **Step 4: Observe one complete scheduler pass**

Inspect fixed event logs and query only non-secret publication metadata:

```bash
docker compose -f compose.yaml -f compose.prod.yaml logs --since=10m bot
docker compose -f compose.yaml -f compose.prod.yaml exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select niche_id,count(*) from promonet.offer_publications group by niche_id order by niche_id;"'
```

Expected: more than one category has publications and no raw credential appears in logs.

- [ ] **Step 5: Verify the public site**

Run:

```bash
curl -fsS 'https://promomega.com.br/api/offers?limit=48'
curl -fsS 'https://promomega.com.br/api/categories'
```

Expected: the offers response contains multiple items and category counts; every click destination remains behind `/oferta/{niche}/{item}`.

- [ ] **Step 6: Final repository check**

Run: `git status --short`

Expected: no tracked changes.
