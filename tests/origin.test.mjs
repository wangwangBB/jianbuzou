import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,answerAuthorization} from './helpers.mjs';

test('normal and legacy same-origin browser form submissions can delete one participant',async()=>{
  for(const origin of ['https://walk.example.test','null']) {
    const f=fixture(),p=f.participant(),other=f.participant();
    await f.call('/answer',{cookie:p.cookie,form:{answer_token:await answerAuthorization(f,p),selected_option:'A'}});
    const r=await f.call('/admin/participants/delete',{cookie:f.adminCookie,form:{id:p.id},headers:{Origin:origin,'Sec-Fetch-Site':'same-origin'}});
    assert.equal(r.status,302);
    assert.equal(f.sqlite.prepare('SELECT id FROM participants WHERE id=?').get(p.id),undefined);
    assert.ok(f.sqlite.prepare('SELECT id FROM participants WHERE id=?').get(other.id));
    assert.equal(f.records(),0);
  }
});

test('legacy same-origin clear removes test participants and preserves questions',async()=>{
  const f=fixture();f.participant();
  const before=f.sqlite.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
  const r=await f.call('/admin/participants/clear',{cookie:f.adminCookie,form:{},headers:{Origin:'null','Sec-Fetch-Site':'same-origin'}});
  assert.equal(r.status,302);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM participants').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM questions').get().n,before);
});

test('opaque, cross-site and contradictory origins cannot delete participants',async()=>{
  const f=fixture(),p=f.participant();
  for(const headers of [
    {Origin:'null'},
    {Origin:'null','Sec-Fetch-Site':'cross-site'},
    {Origin:'null','Sec-Fetch-Site':'same-site'},
    {Origin:'https://evil.example','Sec-Fetch-Site':'same-origin'},
    {Origin:'https://walk.example.test','Sec-Fetch-Site':'cross-site'}
  ]) {
    const r=await f.call('/admin/participants/delete',{cookie:f.adminCookie,form:{id:p.id},headers});
    assert.equal(r.status,403);
    assert.ok(f.sqlite.prepare('SELECT id FROM participants WHERE id=?').get(p.id));
  }
});

test('form pages retain Origin while stripping sensitive paths and query strings from referrers',async()=>{
  const f=fixture();
  for(const path of ['/admin/login','/scan?token='+f.qr('start'),'/scan?token=invalid']) {
    assert.equal((await f.call(path)).headers.get('Referrer-Policy'),'strict-origin');
  }
  const r=await f.call('/admin/qrs',{cookie:f.adminCookie});
  assert.equal(r.headers.get('Referrer-Policy'),'strict-origin');
});
