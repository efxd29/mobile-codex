const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const {voicesFrom, voiceName, voiceGroups} = require('../app/src/main/assets/web/live.js');

test('Live picker excludes Korean-only voices and uses English labels', () => {
  assert.deepEqual(voicesFrom({voices:{v1:['cove','sol'],v3:['cove','hanul','haetsal','miko'],defaultV1:'cove'}}), {
    ids:['cove','miko'],defaultVoice:'cove'
  });
  const groups = voiceGroups(['cove','miko','future_voice']);
  assert.deepEqual(groups, [
    {label:'English', ids:['cove']},
    {label:'German', ids:['miko']},
    {label:'Other', ids:['future_voice']},
  ]);
  assert.equal(voiceName('future_voice'),'Future Voice');
  const containsHangul = [...JSON.stringify(groups)].some(char => {
    const code = char.charCodeAt(0);
    return code >= 0xAC00 && code <= 0xD7AF;
  });
  assert.equal(containsHangul,false);
});

test('older runtimes without v3 retain supported non-Korean voices', () => {
  assert.deepEqual(voicesFrom({voices:{v1:['cove','sol','hanul'],defaultV1:'cove'}}), {
    ids:['cove','sol'],defaultVoice:'cove'
  });
});

test('an empty v3 selection falls back to the legacy catalog', () => {
  assert.deepEqual(voicesFrom({voices:{v1:['cove','sol'],v3:[],defaultV1:'cove'}}), {
    ids:['cove','sol'],defaultVoice:'cove'
  });
});

test('a v3 catalog containing only excluded voices falls back to v1', () => {
  assert.deepEqual(voicesFrom({voices:{v1:['cove','sol'],v3:['hanul','haetsal'],defaultV1:'cove'}}), {
    ids:['cove','sol'],defaultVoice:'cove'
  });
});

function liveHarness(overrides = {}) {
  const dom = new JSDOM(fs.readFileSync('app/src/main/assets/web/index.html','utf8'), {
    url:'https://appassets.androidplatform.net/index.html',
    runScripts:'outside-only',
  });
  const w=dom.window, calls=[];
  let id=0;
  Object.defineProperty(w.crypto,'randomUUID',{value:()=>`live-${++id}`});
  w.requestAnimationFrame=()=>0; w.cancelAnimationFrame=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  const state={ready:true,busy:false,proBusy:false,account:{type:'chatgpt'},accounts:[],threadId:'thread-1',live:{key:''},models:[],...overrides};
  const call=async(action,args={})=>{
    calls.push({action,args});
    if(action==='live.voices')return {voices:{v3:['cove'],defaultV1:'cove'}};
    if(action==='live.microphone')return {ok:true};
    if(action==='live.start')return {key:args.key,threadId:'thread-1',connected:true,phase:'connected'};
    return {ok:true};
  };
  w.eval(fs.readFileSync('app/src/main/assets/web/live.js','utf8'));
  const ui=w.MobileCodexLive.create({
    call,getState:()=>state,getOptions:()=>({model:'gpt-test',effort:'high',fastMode:false}),
    show:id=>w.document.getElementById(id).showModal(),
    close:id=>w.document.getElementById(id).close(),
    t:value=>value,errorText:(error,fallback)=>String(error?.message||error||fallback),changed:()=>{},
  });
  return {dom,w,ui,calls};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate) {
  for(let i=0;i<100;i++){if(predicate())return;await wait(10);}
  assert.fail('Timed out waiting for Live action');
}

test('Live can start from a saved account before the lazy account refresh completes',()=>{
  const saved=liveHarness({account:{},accounts:[{active:true,needsLogin:false}]});
  try { saved.ui.update(); assert.equal(saved.w.document.getElementById('live-start').disabled,false); }
  finally { saved.dom.window.close(); }
  const missing=liveHarness({account:{},accounts:[]});
  try { missing.ui.update(); assert.equal(missing.w.document.getElementById('live-start').disabled,true); }
  finally { missing.dom.window.close(); }
});

test('Live retries a recoverable network disconnect with a new session key and never replays text', async()=>{
  const {dom,w,ui,calls}=liveHarness();
  try {
    w.document.getElementById('live-start').click();
    await waitFor(()=>calls.filter(item=>item.action==='live.start').length===1);
    const first=calls.find(item=>item.action==='live.start');
    await ui.event('live.audio',{key:first.args.key,phase:'ended',retryable:true,error:'network disconnected'});
    await waitFor(()=>calls.filter(item=>item.action==='live.start').length===2);
    const starts=calls.filter(item=>item.action==='live.start');
    assert.notEqual(starts[1].args.key,starts[0].args.key);
    assert.equal(calls.some(item=>item.action==='live.text'||item.action==='chat.send'),false);
    assert.equal(ui.active(),true);
  } finally { await ui.end(); dom.window.close(); }
});

test('Live does not auto-retry protocol or entitlement errors', async()=>{
  const {dom,w,ui,calls}=liveHarness();
  try {
    w.document.getElementById('live-start').click();
    await waitFor(()=>calls.filter(item=>item.action==='live.start').length===1);
    const first=calls.find(item=>item.action==='live.start');
    await ui.event('live.event',{key:first.args.key,method:'thread/realtime/error',params:{message:'not entitled'}});
    await wait(1800);
    assert.equal(calls.filter(item=>item.action==='live.start').length,1);
    assert.equal(ui.active(),false);
  } finally { await ui.end(); dom.window.close(); }
});
