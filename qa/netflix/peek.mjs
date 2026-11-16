import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = b.contexts()[0];
for (const p of ctx.pages()) {
  const st = await p.evaluate(() => ({
    url: location.href.slice(0,90),
    title: document.title.slice(0,60),
    video: !!document.querySelector('video'),
    hosts: ['kivara-lingo-host','kivara-lingo-video-host'].map(id=>document.getElementById(id)?1:0),
    body: document.body.innerText.replace(/\s+/g,' ').slice(0,120),
  })).catch(e=>({err:String(e).slice(0,60)}));
  console.log(JSON.stringify(st));
}
await b.close().catch(()=>{});
