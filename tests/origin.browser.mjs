// Runs on the GitHub Ubuntu runner using its installed Chrome, with test pages only.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('real browser reproduces no-referrer null Origin and strict-origin fixes it',async()=>{
  const seen=new Map();
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const policy=url.searchParams.get('policy');
    res.setHeader('Content-Type','text/html');
    if(req.method==='POST') {
      seen.set(policy,{origin:req.headers.origin,site:req.headers['sec-fetch-site']});
      res.end('Captured');return;
    }
    res.setHeader('Referrer-Policy',policy);
    res.end(`<form method="post" action="/capture?policy=${policy}"><input name="test" value="only"></form><script>document.forms[0].submit()</script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const policy of ['no-referrer','strict-origin']) {
      const profile=await mkdtemp(join(tmpdir(),'walk-origin-browser-'));
      await new Promise((resolve,reject)=>{
        const child=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--disable-background-networking',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=2000',`${origin}/?policy=${policy}`],{stdio:'ignore'});
        const timeout=setTimeout(()=>{child.kill();reject(Error('Browser test timed out'));},20000);
        child.on('error',error=>{clearTimeout(timeout);reject(error);});
        child.on('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(Error('Browser exit '+code));});
      });
    }
    assert.equal(seen.get('no-referrer')?.origin,'null');
    assert.equal(seen.get('no-referrer')?.site,'same-origin');
    assert.equal(seen.get('strict-origin')?.origin,origin);
    assert.equal(seen.get('strict-origin')?.site,'same-origin');
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
