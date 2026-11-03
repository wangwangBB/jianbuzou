import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, now, sign } from './helpers.mjs';

async function grant(f, point='cp1', days=7) {
  const r=await f.call('/admin/qrs/share',{cookie:f.adminCookie,form:{point,action:'create',days}});
  assert.equal(r.status,302);
  const html=await (await f.call('/admin/qrs',{cookie:f.adminCookie})).text();
  const url=html.match(new RegExp(`id="share-url-${point}" readonly value="([^"]+)"`))?.[1];
  assert.ok(url);
  return new URL(url.replaceAll('&amp;','&'));
}
test('each point gets a cookie-free display link without administrator access',async()=>{
  const f=fixture();
  for(const point of ['start','cp1','cp2','cp3']) {
    const url=await grant(f,point);
    assert.equal((await f.call(url.pathname+url.search)).status,200);
    assert.equal((await f.call('/admin'+url.search)).status,302);
    assert.equal((await f.call('/admin/export.csv'+url.search)).status,302);
    const wrong=point==='cp1'?'cp2':'cp1';
    assert.equal((await f.call('/display/'+wrong+url.search)).status,403);
    assert.equal((await f.call('/api/qrcode.svg?point='+wrong+'&share='+url.searchParams.get('share'))).status,401);
    assert.equal((await f.call('/scan?token='+url.searchParams.get('share'))).status,400);
  }
  assert.equal(f.records(),0);
});
test('revocation and regeneration invalidate old links, without affecting other points',async()=>{
  const f=fixture();
  const a=await grant(f),b=await grant(f,'cp2');
  const fresh=await grant(f);
  assert.equal((await f.call(a.pathname+a.search)).status,403);
  assert.equal((await f.call(fresh.pathname+fresh.search)).status,200);
  await f.call('/admin/qrs/share',{cookie:f.adminCookie,form:{point:'cp1',action:'revoke'}});
  assert.equal((await f.call(fresh.pathname+fresh.search)).status,403);
  assert.equal((await f.call(b.pathname+b.search)).status,200);
});
test('expiry, forged point, unissued grants and anonymous sharing changes rejected',async()=>{
  const f=fixture(),url=await grant(f);
  const token=url.searchParams.get('share');
  const [body,sig]=token.split('.');
  const p=JSON.parse(Buffer.from(body,'base64url'));
  for(const invalid of [token+'.extra',sign({...p,exp:now()},f.env.QR_SECRET),sign({...p,sid:'not-issued'},f.env.QR_SECRET),Buffer.from(JSON.stringify({...p,point:'cp2'})).toString('base64url')+'.'+sig]) {
    assert.equal((await f.call('/display/cp1?share='+invalid)).status,403);
  }
  assert.equal((await f.call('/admin/qrs/share',{form:{point:'cp1',action:'revoke'}})).status,302);
  assert.equal((await f.call(url.pathname+url.search)).status,200);
  for(const days of [0,2,365]) assert.equal((await f.call('/admin/qrs/share',{cookie:f.adminCookie,form:{point:'cp1',action:'create',days}})).status,400);
});
test('existing databases upgrade additively and existing links remain stable on refresh',async()=>{
  const f=fixture(),p=f.participant();
  f.sqlite.exec('DROP TABLE qr_staff_shares');
  const url=await grant(f);
  const html=await (await f.call('/admin/qrs',{cookie:f.adminCookie})).text();
  assert.ok(html.includes(url.searchParams.get('share')));
  assert.ok(f.sqlite.prepare('SELECT id FROM participants WHERE id=?').get(p.id));
  assert.ok(f.sqlite.prepare('SELECT COUNT(*) AS n FROM questions').get().n>0);
});
