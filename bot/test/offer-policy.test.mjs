import test from "node:test";
import assert from "node:assert/strict";
import { diversifyOffers, formatOffer, isEligibleOffer, isFoodOrBeverage, selectOffer, selectOffers } from "../offer-policy.mjs";
const item={itemId:"MLB1",rank:1,title:"Console",status:"active",permalink:"https://produto.mercadolivre.com.br/MLB-1-console",imageUrl:"https://http2.mlstatic.com/a.jpg",price:100,originalPrice:150,categoryId:"MLB1144"};
test("selects a valid unseen candidate and prioritizes confirmed discount",()=>{const selected=selectOffer([{...item,itemId:"MLB2",rank:0,originalPrice:null},{...item,rank:5}],{categoryId:"MLB1144",recentIds:new Set()});assert.equal(selected.itemId,"MLB1");});
test("accepts a child-category offer returned by the requested official category scope",()=>{const selected=selectOffer([{...item,categoryId:"MLB186456",scopeCategoryId:"MLB1144"}],{categoryId:"MLB1144",recentIds:new Set()});assert.equal(selected?.itemId,"MLB1");});
test("selects a bounded discounted batch without recent or duplicate items",()=>{const candidates=[{...item,itemId:"MLB1",rank:2,price:80,originalPrice:100},{...item,itemId:"MLB2",rank:1,price:50,originalPrice:100},{...item,itemId:"MLB3",rank:0,price:70,originalPrice:100},{...item,itemId:"MLB3",rank:3,price:70,originalPrice:100}];assert.deepEqual(selectOffers(candidates,{categoryId:item.categoryId,recentIds:new Set(["MLB2"]),limit:2}).map(x=>x.itemId),["MLB3","MLB1"]);});
test("rejects invalid, mismatched and recently published candidates",()=>{for(const candidate of [{...item,status:"paused"},{...item,categoryId:"MLB1000"},{...item,permalink:"https://evil.example/MLB-1"},{...item,price:0}])assert.equal(selectOffer([candidate],{categoryId:"MLB1144",recentIds:new Set()}),null);assert.equal(selectOffer([item],{categoryId:"MLB1144",recentIds:new Set(["MLB1"])}),null);});
test("rejects products without a genuine previous price",()=>{assert.equal(selectOffer([{...item,originalPrice:null}],{categoryId:item.categoryId,recentIds:new Set()}),null);assert.equal(selectOffer([{...item,originalPrice:item.price}],{categoryId:item.categoryId,recentIds:new Set()}),null);});
test("best-seller rank precedes discount",()=>{const selected=selectOffer([{...item,itemId:"MLB1",rank:1,price:80,originalPrice:100},{...item,itemId:"MLB2",rank:8,price:30,originalPrice:100}],{categoryId:item.categoryId,recentIds:new Set()});assert.equal(selected.itemId,"MLB1");});
test("formats truthful offer disclosure",()=>{const text=formatOffer(item,"https://meli.la/ours");assert.match(text,/Publicidade/);assert.match(text,/R\$\s*150,00/);assert.match(text,/33%/);assert.match(text,/https:\/\/meli\.la\/ours/);assert.doesNotMatch(formatOffer({...item,originalPrice:null},"https://meli.la/ours"),/%/);});

test("identifies food and beverage categories and normalized Portuguese title signals",()=>{
  for(const title of [
    "Macarrão espaguete 500g",
    "Açúcar refinado 1kg",
    "Refrigerante cola 2 litros",
    "Café torrado e moído 500g",
    "Arroz branco tipo 1 5kg",
    "Bebida láctea sabor chocolate",
    "Alimento completo para gatos",
    "Feijão carioca 1kg",
    "Leite integral 1L",
    "Chocolate ao leite 90g",
    "Vinho tinto seco 750ml",
    "Queijo mussarela fatiado 500g",
    "Manteiga com sal 200g",
    "Iogurte natural integral 170g",
  ]) assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),true,title);
  assert.equal(isFoodOrBeverage({title:"Oferta especial",categoryId:"MLB1403"}),true);
  assert.equal(isFoodOrBeverage({title:"Oferta especial",scopeCategoryId:"MLB278123"}),true);
});

test("does not confuse bounded food words with appliance, tool, or model names",()=>{
  for(const title of [
    "Camiseta masculina de algodão",
    "Kit de ferramentas Tramontina 110 peças",
    "Cafeteira elétrica Oster",
    "Açucareiro de inox",
    "Bebedouro elétrico de mesa",
    "Alimentador automático para pets",
    "Panela elétrica para arroz",
    "Capacete Custom Café Racer",
    "Vestido feminino cor vinho",
    "Sapato feminino chocolate",
  ]) assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),false,title);
});

test("treats known official food leaf categories as authoritative",()=>{
  for(const categoryId of ["MLB269718","MLB455580","MLB194832"])
    assert.equal(isFoodOrBeverage({title:"Oferta especial",categoryId}),true,categoryId);
});

test("recognizes mineral water, hamburgers, and ordinary branded chocolate titles",()=>{
  for(const title of [
    "Água mineral sem gás 1,5L",
    "Água com gás 500ml",
    "Hambúrguer bovino congelado 12 unidades",
    "Hamburguer artesanal bovino",
    "Chocolate Lacta Diamante Negro 90g",
    "Chocolate Nestlé Classic",
  ]) assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),true,title);
});

test("allows ambiguous food words used only as fashion colors",()=>{
  for(const title of [
    "Camiseta feminina cor café",
    "Body bebê branco leite",
    "Vestido feminino cor vinho",
    "Sapato feminino chocolate",
  ]) assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),false,title);
});

test("distinguishes food products from appliances and accessories across niches",()=>{
  for(const offer of [
    {title:"Moedor de carne elétrico",categoryId:"MLB4337"},
    {title:"Espremedor de suco industrial",categoryId:"MLB4337"},
    {title:"Máquina de pão automática",categoryId:"MLB4337"},
    {title:"Porta ovos para geladeira",categoryId:"MLB1576"},
    {title:"Fatiador de queijo em inox",categoryId:"MLB189008"},
    {title:"Adega porta vinho 12 garrafas",categoryId:"MLB1576"},
  ]) assert.equal(isFoodOrBeverage(offer),false,offer.title);
  for(const offer of [
    {title:"Achocolatado Nescau 370g",categoryId:"MLB31447"},
    {title:"Água de coco integral 1L",categoryId:"MLB31447"},
    {title:"Bombons Ferrero Rocher 8 unidades",categoryId:"MLB31447"},
    {title:"Ração premium para cães 10kg",categoryId:"MLB31447"},
    {title:"Kit camiseta + chocolate Bis",categoryId:"MLB31447"},
  ]) assert.equal(isFoodOrBeverage(offer),true,offer.title);
});

const contextualNonFoodTitles=[
  "Espumador de leite",
  "Taça para vinho",
  "Caneca para cerveja",
  "Jarra para suco",
  "Forma de pão",
  "Pote para açúcar",
  "Galheteiro para azeite",
  "Cafeteira com moedor de café",
  "Chaleira com infusor de chá",
];
const contextualFoodTitles=[
  "Açaí tradicional 1kg",
  "Sorvete de creme 2L",
  "Linguiça toscana 1kg",
  "Bala Fini 500g",
  "Mel puro 500g",
  "Óleo de soja 900ml",
  "Sal refinado 1kg",
];

const prefixedContextualNonFoodTitles=[
  "Mondial Espremedor de suco turbo",
  "Kit 6 taças para vinho cristal",
  "Conjunto de canecas para cerveja",
  "Electrolux espumador de leite elétrico",
  "Óleo motor sintético 5W30 1L",
  "Óleo corporal hidratante 200ml",
  "Sal de banho relaxante 500g",
  "Bala de airsoft 6mm",
  "Shampoo de mel 400ml",
];

const componentNonFoodTitles=[
  "Cafeteira Oster para café moído 220V",
  "Moedor elétrico para café em grãos",
  "Kit óleo motor 5W30 + filtro de óleo",
  "Shampoo de mel + condicionador 2x400ml",
  "Kit 6 taças para vinho tinto 450ml",
  "Forma de silicone para chocolate ao leite",
  "Espumador elétrico para leite integral",
  "Bala airsoft 6mm",
  "Óleo essencial de lavanda 10ml",
  "Sal para piscina 10kg",
];

const componentFoodTitles=[
  "Cafeteira elétrica com café Pilão 500g",
  "Kit camiseta + chocolate Bis",
];

const applianceCapacityTitles=[
  "Cafeteira elétrica com moedor de café integrado 1,5L",
  "Cafeteira Oster com filtro permanente para café 1,2L",
  "Cafeteira Electrolux com timer para café 1,2L",
  "Cafeteira com jarra térmica para café 1L",
];

const capsuleCompatibilityTitles=[
  "Cafeteira para cápsulas Dolce Gusto",
  "Cafeteira compatível com cápsulas",
];

const bundledCapsuleTitles=[
  "Cafeteira Dolce Gusto Preta 110v + 48 Cápsulas Starbucks",
  "Cafeteira com 20 cápsulas de café inclusas",
  "Cafeteira acompanha cápsulas de café",
  "Cafeteira compatível com cápsulas Nespresso, inclui 10 cápsulas",
  "Cafeteira compatível com cápsulas Dolce Gusto com 20 cápsulas inclusas",
];

test("uses product heads and usage-target context for ambiguous food terms",()=>{
  for(const title of contextualNonFoodTitles)
    assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),false,title);
  for(const title of contextualFoodTitles)
    assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),true,title);
});

test("applies every contextual fixture through eligibility and diversification",()=>{
  const candidate=(title,itemId,nicheId)=>({...item,title,itemId,nicheId,categoryId:"MLB31447"});
  const allowed=contextualNonFoodTitles.map((title,index)=>candidate(title,`ALLOW${index}`,`allowed-${index}`));
  const rejected=contextualFoodTitles.map((title,index)=>candidate(title,`FOOD${index}`,`food-${index}`));
  for(const offer of allowed)
    assert.equal(isEligibleOffer(offer,{categoryId:"MLB31447",recentIds:new Set()}),true,offer.title);
  for(const offer of rejected)
    assert.equal(isEligibleOffer(offer,{categoryId:"MLB31447",recentIds:new Set()}),false,offer.title);
  assert.deepEqual(
    diversifyOffers([...rejected,...allowed],{limit:10}).map(offer=>offer.itemId),
    allowed.map(offer=>offer.itemId),
  );
});

test("finds prefixed and plural non-food heads without accepting adjacent food products",()=>{
  for(const title of prefixedContextualNonFoodTitles)
    assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),false,title);
  for(const title of [
    "Kit 6 chocolates Bis 90g",
    "Conjunto de vinhos tintos 750ml",
    "Óleo de girassol 900ml",
    "Sal de cozinha 1kg",
    "Bala Fini minhocas 500g",
    "Mel natural orgânico 500g",
  ]) assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),true,title);
});

test("applies prefixed contextual probes through eligibility and diversification",()=>{
  const allowed=prefixedContextualNonFoodTitles.map((title,index)=>({
    ...item,title,itemId:`PREFIX${index}`,nicheId:`prefix-${index}`,categoryId:"MLB31447",
  }));
  for(const offer of allowed)
    assert.equal(isEligibleOffer(offer,{categoryId:"MLB31447",recentIds:new Set()}),true,offer.title);
  assert.deepEqual(
    diversifyOffers(allowed,{limit:10}).map(offer=>offer.itemId),
    allowed.map(offer=>offer.itemId),
  );
});

test("classifies each bundle component by semantic head and sale evidence",()=>{
  for(const title of componentNonFoodTitles)
    assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),false,title);
  for(const title of componentFoodTitles)
    assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),true,title);
});

test("applies component classification through eligibility and diversification",()=>{
  const candidate=(title,itemId,nicheId)=>({...item,title,itemId,nicheId,categoryId:"MLB31447"});
  const allowed=componentNonFoodTitles.map((title,index)=>candidate(title,`COMPONENT${index}`,`component-${index}`));
  const rejected=componentFoodTitles.map((title,index)=>candidate(title,`COMPONENT-FOOD${index}`,`component-food-${index}`));
  for(const offer of allowed)
    assert.equal(isEligibleOffer(offer,{categoryId:"MLB31447",recentIds:new Set()}),true,offer.title);
  for(const offer of rejected)
    assert.equal(isEligibleOffer(offer,{categoryId:"MLB31447",recentIds:new Set()}),false,offer.title);
  assert.deepEqual(
    diversifyOffers([...rejected,...allowed],{limit:10}).map(offer=>offer.itemId),
    allowed.map(offer=>offer.itemId),
  );
});

test("keeps usage-target components separate from packaged food components",()=>{
  const cases=[
    ["Kit 2 moedores para café moído",false],
    ["Conjunto 4 formas para chocolate amargo",false],
    ["Óleo de motor diesel 1L",false],
    ["Sal para aquário 2kg",false],
    ["Cafeteira + Café Pilão 500g",true],
    ["Espumador + Leite integral 1L",true],
    ["Forma de silicone + Chocolate Lacta 90g",true],
    ["Kit shampoo + Mel puro 500g",true],
  ];
  for(const [title,expected] of cases)
    assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),expected,title);
});

test("does not treat appliance reservoir capacity as packaged coffee",()=>{
  for(const title of applianceCapacityTitles)
    assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),false,title);
  assert.equal(isFoodOrBeverage({title:"Cafeteira com filtro incluso para café 1,2L",categoryId:"MLB31447"}),false);
  for(const title of [
    "Cafeteira com café Pilão",
    "Cafeteira acompanha café Pilão",
    "Cafeteira com café incluso",
    "Cafeteira com café 500g",
    "Cafeteira com pacote de café 500g",
    "Cafeteira com moedor + Café Pilão 500g",
  ]) assert.equal(isFoodOrBeverage({title,categoryId:"MLB31447"}),true,title);
});

test("applies appliance capacity probes through eligibility and diversification",()=>{
  const allowed=applianceCapacityTitles.map((title,index)=>({
    ...item,title,itemId:`CAPACITY${index}`,nicheId:`capacity-${index}`,categoryId:"MLB31447",
  }));
  for(const offer of allowed)
    assert.equal(isEligibleOffer(offer,{categoryId:"MLB31447",recentIds:new Set()}),true,offer.title);
  assert.deepEqual(
    diversifyOffers(allowed,{limit:10}).map(offer=>offer.itemId),
    allowed.map(offer=>offer.itemId),
  );
});

test("distinguishes capsule compatibility from included consumables",()=>{
  for(const title of capsuleCompatibilityTitles)
    assert.equal(isFoodOrBeverage({title,categoryId:"MLB9188"}),false,title);
  for(const title of bundledCapsuleTitles)
    assert.equal(isFoodOrBeverage({title,categoryId:"MLB9188"}),true,title);
});

test("applies capsule bundle classification through eligibility and diversification",()=>{
  const candidate=(title,itemId,nicheId)=>({...item,title,itemId,nicheId,categoryId:"MLB9188"});
  const allowed=capsuleCompatibilityTitles.map((title,index)=>candidate(title,`CAPSULE-OK${index}`,`capsule-ok-${index}`));
  const rejected=bundledCapsuleTitles.map((title,index)=>candidate(title,`CAPSULE-FOOD${index}`,`capsule-food-${index}`));
  for(const offer of allowed)
    assert.equal(isEligibleOffer(offer,{categoryId:"MLB9188",recentIds:new Set()}),true,offer.title);
  for(const offer of rejected)
    assert.equal(isEligibleOffer(offer,{categoryId:"MLB9188",recentIds:new Set()}),false,offer.title);
  assert.deepEqual(
    diversifyOffers([...rejected,...allowed],{limit:10}).map(offer=>offer.itemId),
    allowed.map(offer=>offer.itemId),
  );
});

test("normalizes capsule and inclusion inflections contextually",()=>{
  for(const title of [
    "Cafeteira com cápsula Starbucks inclusa",
    "Cafeteira com cápsulas Starbucks inclusas",
    "Cafeteira com café incluso",
    "Cafeteira com cafés inclusos",
    "Cafeteira acompanha cápsula de café",
    "Cafeteira acompanhando cápsulas de café",
  ]) assert.equal(isFoodOrBeverage({title,categoryId:"MLB9188"}),true,title);
  for(const title of [
    "Cafeteira para cápsula Dolce Gusto",
    "Cafeteira compatível com 20 cápsulas",
    "Cafeteira com filtro incluso compatível com cápsulas",
  ]) assert.equal(isFoodOrBeverage({title,categoryId:"MLB9188"}),false,title);
});

test("rejects food before selecting an otherwise valid ranked offer while allowing clothing",()=>{
  const clothing={...item,itemId:"MLB2",title:"Camiseta masculina de algodão",categoryId:"MLB31447"};
  const food={...item,itemId:"MLB3",rank:0,title:"Macarrão espaguete 500g",categoryId:"MLB31447"};
  assert.equal(selectOffer([food,clothing],{categoryId:"MLB31447",recentIds:new Set()})?.itemId,"MLB2");
});

const ranked=(nicheId,itemId)=>({...item,nicheId,itemId});

test("rotates across at least five niches and caps every niche at two while filling ten",()=>{
  const candidates=[
    ranked("tools","T1"),ranked("tools","T2"),ranked("tools","T3"),ranked("tools","T4"),
    ranked("clothing","C1"),ranked("clothing","C2"),
    ranked("sneakers","S1"),ranked("sneakers","S2"),
    ranked("phones","P1"),ranked("phones","P2"),
    ranked("games","G1"),ranked("games","G2"),
    ranked("appliances","A1"),
  ];
  const selected=diversifyOffers(candidates,{limit:10,perNiche:2});
  const counts=selected.reduce((map,offer)=>map.set(offer.nicheId,(map.get(offer.nicheId)??0)+1),new Map());
  assert.equal(selected.length,10);
  assert.ok(counts.size>=5);
  assert.ok([...counts.values()].every(count=>count<=2));
  assert.deepEqual(selected.map(offer=>offer.itemId),["T1","C1","S1","P1","G1","A1","T2","C2","S2","P2"]);
});

test("handles sparse niches, invalid niche IDs, and duplicate item IDs deterministically",()=>{
  const candidates=[
    ranked("tools","DUP"),ranked("tools","T2"),
    ranked("","INVALID"),ranked("clothing","DUP"),ranked("clothing","C2"),
    ranked("games","G1"),ranked(null,"INVALID2"),ranked("games","G1"),
  ];
  const expected=["DUP","C2","G1","T2"];
  assert.deepEqual(diversifyOffers(candidates).map(offer=>offer.itemId),expected);
  assert.deepEqual(diversifyOffers(candidates).map(offer=>offer.itemId),expected);
});

test("filters ineligible candidates itself using candidate scope and recent ids",()=>{
  const safe=ranked("tools","SAFE");
  const candidates=[
    safe,
    {...ranked("tools","FOOD"),title:"Macarrão espaguete 500g"},
    {...ranked("tools","INACTIVE"),status:"paused"},
    {...ranked("tools","UNSAFE"),permalink:"https://evil.example/MLB-1"},
    {...ranked("tools","NO-DISCOUNT"),originalPrice:100},
    {...ranked("tools","NO-CATEGORY"),categoryId:undefined},
    ranked("tools","RECENT"),
  ];
  const recentIds=new Set(["RECENT"]);
  assert.equal(isEligibleOffer(candidates[1],{categoryId:"MLB1144",recentIds}),false);
  assert.deepEqual(diversifyOffers(candidates,{recentIds}).map(offer=>offer.itemId),["SAFE"]);
});

test("sorts each niche by rank, discount, and item id before round robin",()=>{
  const candidates=[
    {...ranked("tools","T9"),rank:9,price:40,originalPrice:100},
    {...ranked("tools","T1"),rank:1,price:90,originalPrice:100},
    {...ranked("clothing","C5"),rank:5},
  ];
  assert.deepEqual(diversifyOffers(candidates).map(offer=>offer.itemId),["T1","C5","T9"]);
});

test("honors a niche maxPerRound cap carried by its candidates",()=>{
  const candidates=[
    {...ranked("tools","T1"),maxPerRound:1},
    {...ranked("tools","T2"),maxPerRound:1},
    {...ranked("clothing","C1"),maxPerRound:2},
    {...ranked("clothing","C2"),maxPerRound:2},
  ];
  assert.deepEqual(diversifyOffers(candidates,{limit:10,perNiche:2}).map(offer=>offer.itemId),["T1","C1","C2"]);
});

test("enforces hard global and per-niche maxima even when callers request larger quotas",()=>{
  const candidates=["tools","clothing","sneakers","phones","games","appliances"]
    .flatMap(nicheId=>[1,2,3].map(index=>ranked(nicheId,`${nicheId}-${index}`)));
  const selected=diversifyOffers(candidates,{limit:99,perNiche:99});
  const counts=selected.reduce((map,offer)=>map.set(offer.nicheId,(map.get(offer.nicheId)??0)+1),new Map());
  assert.equal(selected.length,10);
  assert.ok([...counts.values()].every(count=>count<=2));
});

test("rejects non-positive and otherwise invalid quotas deterministically",()=>{
  const candidates=[ranked("tools","T1"),ranked("tools","T2"),ranked("clothing","C1")];
  for(const options of [
    {limit:0,perNiche:1},
    {limit:1,perNiche:0},
    {limit:-5,perNiche:1},
    {limit:1.5,perNiche:1},
    {limit:2,perNiche:1.5},
    {limit:NaN,perNiche:1},
    {limit:2,perNiche:"2"},
  ]) assert.deepEqual(diversifyOffers(candidates,options),[]);
});

test("skips selected identity equivalents and advances to the next offer in that niche",()=>{
  const sharedProduct=`product:${"a".repeat(64)}`;
  const first={...ranked("tools","MLB101"),identityKeys:["item:MLB101",`url:${"b".repeat(64)}`,sharedProduct]};
  const equivalent={...ranked("clothing","MLB102"),identityKeys:["item:MLB102",`url:${"c".repeat(64)}`,sharedProduct]};
  const alternative={...ranked("clothing","MLB103"),rank:2,identityKeys:["item:MLB103",`url:${"d".repeat(64)}`,`product:${"e".repeat(64)}`]};
  assert.deepEqual(
    diversifyOffers([first,equivalent,alternative],{limit:2,perNiche:1}).map(offer=>offer.itemId),
    ["MLB101","MLB103"],
  );
});
