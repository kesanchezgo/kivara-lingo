const port = 9224;
const extensionId = 'fignfifoniblkonapihmkfakmlgkbkcf';
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((t) => t.type === 'page' && t.url.startsWith(`chrome-extension://${extensionId}/`));
if (!target) throw new Error('Extension page target not found');

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (!msg.id) return;
  const waiter = pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  pending.set(requestId, { resolve, reject });
  ws.send(JSON.stringify({ id: requestId, method, params }));
});

const expression = `(async () => {
  if (!globalThis.chrome?.runtime || !globalThis.chrome?.storage) {
    return { diagnostic: 'chrome APIs unavailable', href: location.href, chromeKeys: Object.keys(globalThis.chrome ?? {}) };
  }
  const key = 'kivara-lingo-state';
  const raw = await chrome.storage.sync.get(key);
  let persisted = {};
  try { persisted = typeof raw[key] === 'string' ? JSON.parse(raw[key]) : {}; } catch {}
  const defaults = ${JSON.stringify({enabled:true,freeDictionary:true,datamuse:true,wiktionary:true,wiktionaryHtml:true,wiktionaryApi:true,wiktApi:true,britannicaDictionary:true,mobyThesaurus:true,thesaurusCom:true,wordHippo:true,theIdioms:true,bundled:true,yomitanPacks:true,cambridge:true,oxfordLearners:true,longman:true,collins:true,merriamWebster:true,oxfordCollocations:true,ozdic:true,pons:true,babla:true,dictCc:true,reverso:true,linguee:true,wordReference:true,spanishDict:true,tatoeba:true,cambridgeAudio:true,oxfordAudio:true,forvo:true,linguaLibre:true,googleTtsFallback:true,unsplash:false,pixabay:false,bingImages:true,openverse:true,wikimediaCommons:true,duckduckgoImages:true,youglish:true,etymonline:true,perSourceTimeoutMs:8000,cacheTtlDays:14,unsplashAccessKey:'',pixabayApiKey:''})};
  const state = persisted.state ?? persisted;
  state.vip = { ...(state.vip ?? {}), ...defaults };
  state.translate = { ...(state.translate ?? {}), targetLanguage: 'es' };
  await chrome.storage.sync.set({ [key]: JSON.stringify(persisted.state ? { ...persisted, state } : state) });
  const out = [];
  await new Promise((resolve, reject) => {
    const p = chrome.runtime.connect({ name: 'kvl-resolve-word' });
    const timer = setTimeout(() => { p.disconnect(); reject(new Error('timeout')); }, 30000);
    p.onMessage.addListener((m) => { out.push(m); if (m.phase === 'done') { clearTimeout(timer); p.disconnect(); resolve(); } });
    p.postMessage({ kind: 'resolve-word', token: 'give', sentence: 'I want to give you a book.', sourceLang: 'en', includeAi: false });
  });
  return out;
})()`;
const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(result, null, 2));
ws.close();
