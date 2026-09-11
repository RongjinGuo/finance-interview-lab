const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

test('invite-code login preserves leading zeros, saves drafts and supports mobile administration', async () => {
  const root=path.resolve(__dirname,'../..');let authenticated=false;
  const users=[{username:'admin',displayName:'管理员',role:'admin'},{username:'alice',displayName:'小林',role:'user'}];
  let envelope={revision:0,updatedAt:null,state:null};const requests=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/src/account-config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.FinanceAccountConfig={enabled:true};');return;}
    if(url.pathname.startsWith('/api/')){
      let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):{};requests.push({path:url.pathname,method:req.method,body});
      if(url.pathname==='/api/session')await new Promise(resolve=>setTimeout(resolve,600));
      res.setHeader('Content-Type','application/json');let data={};
      if(url.pathname==='/api/login'){
        if(body.inviteCode==='08301'){authenticated=true;data={user:users[0]};}
        else {res.statusCode=401;data={error:'邀请码不正确。'};}
      }
      else if(!authenticated)res.statusCode=401;
      else if(url.pathname==='/api/session')data={user:users[0]};
      else if(url.pathname==='/api/logout')authenticated=false;
      else if(url.pathname==='/api/state'&&req.method==='PUT'){envelope={revision:envelope.revision+1,updatedAt:new Date().toISOString(),state:body.state};data=envelope;}
      else if(url.pathname==='/api/state'||url.pathname.includes('/api/admin/users/alice/state'))data=envelope;
      else if(url.pathname==='/api/admin/users'&&req.method==='POST'){users.push({username:body.username,displayName:body.displayName,role:'user'});data={user:users.at(-1)};}
      else if(url.pathname==='/api/admin/users')data={users};
      res.end(JSON.stringify(data));return;
    }
    try{const file=path.join(root,url.pathname==='/'?'index.html':url.pathname);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}
    catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{AbortSignal.any=undefined;});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.locator('#account-username, #account-password').count(),0,'legacy login fields are absent');
    assert.equal(await page.locator('#account-login-form input').count(),1,'login requires only one field');
    assert.equal(await page.locator('#account-invite-code').isEnabled(),false,'invite code stays disabled until the session probe finishes');
    assert.equal(await page.locator('#account-invite-code').getAttribute('type'),'text');
    assert.equal(await page.locator('#account-invite-code').getAttribute('inputmode'),'numeric');
    await page.locator('#account-invite-code').fill('9876');await page.locator('#account-login-submit').click();
    await page.locator('#account-login-error').waitFor({state:'visible'});
    assert.match(await page.locator('#account-login-error').textContent(),/邀请码/);
    await page.locator('#account-invite-code').fill('08301');await page.locator('#account-login-submit').click();
    await page.locator('[data-action="start"]').click();
    const answer='<img src=x onerror=alert(1)> 先分析现金流，再解释利润。';
    await page.locator('#answer-input').fill(answer);await page.locator('#account-save').click();
    await page.waitForFunction(()=>document.querySelector('#account-sync-status').dataset.status==='saved');
    assert.equal(Object.values(envelope.state.active.answers)[0].text,answer);
    assert.deepEqual(Object.keys(envelope.state).sort(),['active','favorites','history','settings']);
    assert.equal(await page.evaluate(()=>localStorage.getItem('finance-interview-v1')),null);
    await page.locator('[data-action="save-exit"]').click();await page.locator('#account-admin').click();
    await page.locator('[data-account-user="alice"]').click();
    await page.locator('.account-answer-text').first().waitFor();
    assert.match(await page.locator('.account-answer-text').first().textContent(),/先分析现金流/);
    assert.equal(await page.locator('.account-answer-text img').count(),0);
    await page.locator('.account-create summary').click();assert.equal(await page.locator('#new-password').count(),0);
    await page.locator('#new-username').fill('charlie');await page.locator('#new-display-name').fill('新同学');await page.locator('#new-invite-code').fill('04782');await page.locator('#account-create-user button').click();
    await page.locator('[data-account-user="charlie"]').waitFor();
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'/tmp/finance-account-admin-mobile.png',fullPage:true});
    await page.locator('#account-manager-close').click();
    await page.locator('#account-logout').click();await page.locator('#account-login-form').waitFor({state:'visible'});
    await page.screenshot({path:'/tmp/finance-account-login-mobile.png',fullPage:true});
    assert.equal(authenticated,false);assert.equal(await page.locator('#app').textContent(),'');assert.deepEqual(errors,[]);
    assert.equal(await page.locator('#account-invite-code').inputValue(),'');
    assert.deepEqual(requests.filter(r=>r.path==='/api/login').at(-1).body,{inviteCode:'08301'});
    assert.deepEqual(requests.find(r=>r.path==='/api/admin/users'&&r.method==='POST').body,{username:'charlie',displayName:'新同学',inviteCode:'04782'});
    assert.ok(requests.filter(r=>r.method==='PUT').every(r=>r.body.mutationId&&Number.isInteger(r.body.revision)));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
