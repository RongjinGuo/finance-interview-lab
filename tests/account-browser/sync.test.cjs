const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const modulePath = require('node:path').join(__dirname, '../../src/accounts.js');
const { createSync } = fs.existsSync(modulePath) ? require(modulePath) : {};
const fresh = (text = '') => ({ settings: { role: 'accounting', mode: 'practice', count: 6 }, active: null, history: [], favorites: text ? [text] : [] });
function memory() { const values = new Map(); return { getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,value), key:index=>[...values.keys()][index]||null, get length(){return values.size;}, values }; }
function fixture(request, storage = memory(), options = {}) {
  const states = [], statuses = [];
  const sync = createSync({ request, storage, onState: state=>states.push(state), onStatus: status=>statuses.push(status), defaultState:fresh, delay:10000, maxWait:10000, ...options });
  return {sync,storage,states,statuses};
}
test('does not upload anonymous data or overwrite cloud with an empty browser', async () => {
  const storage=memory(); storage.setItem('finance-interview-v1',JSON.stringify(fresh('anonymous')));
  let calls=0;
  const {sync,states}=fixture(async()=>{calls++;},storage);
  sync.connect({username:'alice'}, {revision:3,updatedAt:'today',state:fresh('cloud')});
  assert.deepEqual(states.at(-1),fresh('cloud'));
  await sync.flush(); assert.equal(calls,0); sync.disconnect();
});
test('preserves edits while a save is in flight and acknowledges only after response', async () => {
  let resolve; const requests=[];
  const {sync,statuses}=fixture(async(path,options)=>{requests.push(options.body); if(requests.length===1) return new Promise(r=>{resolve=r;}); return {revision:2,updatedAt:'second',state:options.body.state};});
  sync.connect({username:'alice'},{revision:0,state:null,updatedAt:null});
  sync.save(fresh('first')); const saving=sync.flush();
  assert.equal(statuses.at(-1).kind,'saving');
  sync.save(fresh('newer')); resolve({revision:1,updatedAt:'first',state:fresh('first')});
  await saving;
  assert.equal(requests.length,2); assert.equal(requests[1].revision,1); assert.deepEqual(requests[1].state,fresh('newer'));
  assert.equal(sync.status().kind,'saved');sync.disconnect();
});
test('retries the exact pending mutation after connection loss and a new login', async () => {
  const storage=memory();const requests=[];
  let part=fixture(async(path,options)=>{requests.push(options.body);throw new Error('offline');},storage);
  part.sync.connect({username:'alice'},{revision:0,state:null});part.sync.save(fresh('draft'));await part.sync.flush();part.sync.disconnect();
  part=fixture(async(path,options)=>{requests.push(options.body);return {revision:1,state:options.body.state,updatedAt:'saved'};},storage);
  part.sync.connect({username:'alice'},{revision:1,state:fresh('draft')});await part.sync.flush();
  assert.equal(requests[0].mutationId,requests[1].mutationId);assert.deepEqual(requests[0],requests[1]);
  assert.equal(part.sync.status().kind,'saved');part.sync.disconnect();
});
test('keeps unsaved drafts separate across accounts',async()=>{
  const {sync,states}=fixture(async()=>{throw new Error('offline');});
  sync.connect({username:'alice'},{revision:0,state:null});sync.save(fresh('alice'));await sync.flush();sync.disconnect();
  sync.connect({username:'bob'},{revision:0,state:null});assert.deepEqual(states.at(-1),fresh());sync.disconnect();
  sync.connect({username:'alice'},{revision:0,state:null});assert.deepEqual(states.at(-1),fresh('alice'));sync.disconnect();
});
test('409 keeps draft and requires explicit keep-local or use-server resolution',async()=>{
  const current={revision:4,state:fresh('other-device'),updatedAt:'later'};let attempts=0;
  const {sync,states}=fixture(async(path,options)=>{attempts++;if(attempts===1)throw Object.assign(new Error('conflict'),{status:409,current});return {revision:5,state:options.body.state,updatedAt:'resolved'};});
  sync.connect({username:'alice'},{revision:3,state:fresh('original')});sync.save(fresh('mine'));await sync.flush();
  assert.equal(sync.status().kind,'conflict');assert.deepEqual(sync.snapshot().state,fresh('mine'));assert.equal(attempts,1);
  await sync.keepLocal();assert.equal(sync.status().kind,'saved');assert.deepEqual(sync.snapshot().state,fresh('mine'));assert.equal(attempts,2);sync.disconnect();
  sync.connect({username:'alice'}, {revision:6,state:fresh('latest')});assert.deepEqual(states.at(-1),fresh('latest'));sync.disconnect();
});
test('changing account ignores a previous request response',async()=>{
  let resolve; const {sync,states}=fixture(async()=>new Promise(r=>{resolve=r;}));
  sync.connect({username:'alice'},{revision:0,state:null});sync.save(fresh('alice'));const save=sync.flush();sync.disconnect();
  sync.connect({username:'bob'},{revision:8,state:fresh('bob')});resolve({revision:1,state:fresh('alice')});await save;
  assert.equal(sync.snapshot().username,'bob');assert.deepEqual(states.at(-1),fresh('bob'));assert.equal(sync.snapshot().revision,8);sync.disconnect();
});
test('continuous typing still saves within the configured maximum interval',async()=>{
  let calls=0;const {sync}=fixture(async(path,options)=>({revision:++calls,state:options.body.state}),memory(),{delay:40,maxWait:70});
  sync.connect({username:'alice'},{revision:0,state:null});
  const typing=setInterval(()=>sync.save(fresh(String(Date.now()))),10);
  await new Promise(r=>setTimeout(r,105));clearInterval(typing);
  assert.ok(calls>=1,'continuous edits must not postpone every save');sync.disconnect();
});
test('storage failure cannot hide authentication expiry or a resolvable conflict',async()=>{
  const broken={getItem:()=>null,setItem:()=>{throw new Error('full');}};
  const {sync}=fixture(async()=>{throw Object.assign(new Error('expired'),{status:401});},broken);
  sync.connect({username:'alice'},{revision:0,state:null});sync.save(fresh('draft'));await sync.flush();
  assert.equal(sync.status().kind,'expired');assert.equal(sync.status().localError,true);sync.disconnect();
});
test('a successful replay returning a newer device state preserves local edits as conflict',async()=>{
  const {sync}=fixture(async()=>({revision:3,updatedAt:'newer',state:fresh('other-device')}));
  sync.connect({username:'alice'},{revision:1,state:fresh('old')});sync.save(fresh('mine'));await sync.flush();
  assert.equal(sync.status().kind,'conflict');assert.deepEqual(sync.snapshot().state,fresh('mine'));
  sync.useServer();assert.deepEqual(sync.snapshot().state,fresh('other-device'));assert.equal(sync.status().dirty,false);sync.disconnect();
});
test('state writes bind the immutable draft account in a request header',async()=>{
  let header;const {sync}=fixture(async(path,options)=>{header=options.headers['X-Finance-Account'];return {revision:1,state:options.body.state};});
  sync.connect({username:'alice'},{revision:0,state:null});sync.save(fresh('alice'));await sync.flush();
  assert.equal(header,'alice');sync.disconnect();
});
test('separate tabs retain both offline drafts and expose explicit recovery',async()=>{
  const storage=memory();const offline=async()=>{throw new Error('offline');};
  const first=fixture(offline,storage,{tabId:'tab-a'}),second=fixture(offline,storage,{tabId:'tab-b'});
  first.sync.connect({username:'alice'},{revision:0,state:null});second.sync.connect({username:'alice'},{revision:0,state:null});
  first.sync.save(fresh('first-tab'));second.sync.save(fresh('second-tab'));await first.sync.flush();await second.sync.flush();first.sync.disconnect();second.sync.disconnect();
  const reopened=fixture(offline,storage,{tabId:'tab-a'});reopened.sync.connect({username:'alice'},{revision:0,state:null});assert.deepEqual(reopened.states.at(-1),fresh('first-tab'));reopened.sync.disconnect();
  const recovery=fixture(offline,storage,{tabId:'tab-c'});recovery.sync.connect({username:'alice'},{revision:0,state:null});
  const drafts=recovery.sync.availableDrafts();assert.equal(drafts.length,2);assert.deepEqual(new Set(drafts.map(draft=>draft.state.favorites[0])),new Set(['first-tab','second-tab']));
  recovery.sync.restoreDraft(drafts.find(draft=>draft.state.favorites[0]==='first-tab').key);assert.deepEqual(recovery.states.at(-1),fresh('first-tab'));
  assert.equal(recovery.sync.availableDrafts().length,2,'original backups remain after explicit recovery');recovery.sync.disconnect();
});
test('cloned tab recovery pointers copy drafts into unique writable slots',async()=>{
  const storage=memory();const offline=async()=>{throw new Error('offline');};
  const source=fixture(offline,storage,{tabId:'source'});source.sync.connect({username:'alice'},{revision:0,state:null});source.sync.save(fresh('original'));source.sync.disconnect();
  const originalPage=fixture(offline,storage,{tabId:'new-first',recoveryTabId:'source'}),duplicatePage=fixture(offline,storage,{tabId:'new-second',recoveryTabId:'source'});
  originalPage.sync.connect({username:'alice'},{revision:0,state:null});duplicatePage.sync.connect({username:'alice'},{revision:0,state:null});
  assert.deepEqual(originalPage.states.at(-1),fresh('original'));assert.deepEqual(duplicatePage.states.at(-1),fresh('original'));
  originalPage.sync.save(fresh('first-new-edit'));duplicatePage.sync.save(fresh('second-new-edit'));originalPage.sync.disconnect();duplicatePage.sync.disconnect();
  const drafts=[...storage.values.values()].map(raw=>JSON.parse(raw)).filter(saved=>saved.dirty);
  assert.deepEqual(new Set(drafts.map(draft=>draft.state.favorites[0])),new Set(['original','first-new-edit','second-new-edit']));
});
