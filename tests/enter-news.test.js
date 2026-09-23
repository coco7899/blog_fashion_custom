const test = require('node:test');
const assert = require('node:assert/strict');
const { collectEnter, kstDay } = require('../src/enter-news');
const row = {title:'제목',url:'https://m.entertain.naver.com/article/108/0001',rank:1};
const response = data => ({ok:true,json:async()=>data});
test('Korean calendar day at UTC midnight boundary',()=>assert.equal(kstDay(new Date('2026-09-22T15:01:00Z')),'2026-09-23'));
test('merges rank and latest, preserves original publication date and excludes stale latest',async()=>{
 const result = await collectEnter({now:new Date('2026-09-23T03:00:00Z'),fetchImpl:async url=>response({result:url.includes('templates')?{templates:[{templateId:'enter_ranking',json:{newsRankingList:[row]}}]}:{newsList:[{...row,url:'https://m.entertain.naver.com/now/article/108/0001',articleDateTime:'2026-09-23T12:00:00'},{...row,url:'https://m.entertain.naver.com/article/108/0002',articleDateTime:'2026-09-22T12:00:00'}]}})});
 assert.equal(result.sources.length,1); assert.deepEqual(result.sources[0].sections,['ranking','latest']); assert.equal(result.sources[0].rank,1); assert.equal(result.sources[0].date,'2026.09.23'); assert.equal(result.counts.latest,1);
});
test('partial failure is explicit and ranking never invents publication date',async()=>{
 const result = await collectEnter({fetchImpl:async url=>{if(!url.includes('templates'))throw Error('offline');return response({result:{templates:[{templateId:'enter_ranking',json:{newsRankingList:[row]}}]}})}});
 assert.equal(result.warnings.length,1); assert.equal(result.sources[0].date,'');
});
test('both failures and cancellation do not return stale results',async()=>{
 await assert.rejects(collectEnter({fetchImpl:async()=>{throw Error('offline')}}),/불러오지 못했습니다/);
 const c = new AbortController(); c.abort(); await assert.rejects(collectEnter({signal:c.signal}),{name:'AbortError'});
});
