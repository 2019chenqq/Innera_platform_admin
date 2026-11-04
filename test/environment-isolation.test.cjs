"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function setup(demo,script,opts={}) {
 const expected=demo?'innera-demo':'moodsogood-9e45b',calls=[],logs=[],nodes={},listeners=[];
 let app=opts.fresh?null:{options:{projectId:opts.wrong?'other-project':expected}};
 const auth={onAuthStateChanged(fn){queueMicrotask(()=>fn(opts.noUser?null:{uid:'test'}));return ()=>{};},async signOut(){calls.push('signOut');},async signInWithEmailAndPassword(){calls.push('signIn');if(opts.error)throw {message:'SECRET',code:'unknown'};return {user:{uid:'test'}};}};
 const db={collection(){calls.push('read');return {doc(){return {async get(){return {exists:!opts.missing,data:()=>({role:opts.role||'platform_admin',status:opts.inactive?'inactive':'active'})};}};}};}};
 const node=id=>nodes[id]??=( {value:'test',textContent:'',innerHTML:'',disabled:false,events:{},addEventListener(n,f){this.events[n]=f;}} );
 const firebase={get apps(){return app?[app]:[];},app(){return app;},initializeApp(config){calls.push('initialize');app={options:{projectId:opts.badInit?'other-project':config.projectId}};return app;},auth(){calls.push('auth');return auth;},firestore(){calls.push('firestore');return db;}};
 const window={firebase,location:{href:''}};
 const c={window,document:{getElementById:node,addEventListener(n,f){if(n==='DOMContentLoaded')listeners.push(f);},dispatchEvent(){calls.push('ready');}},CustomEvent:function(){},console:Object.fromEntries(['log','info','warn','error'].map(k=>[k,(...a)=>logs.push(a)]))};vm.createContext(c);
 const load=file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c);
 load(`js/firebase-config-${demo?'demo':'prod'}.js`);load(`js/${script}.js`);
 return {window,calls,logs,node,async boot(){for(const fn of listeners)await fn();},swap(){app.options.projectId='other-project';}};
}
for(const demo of [true,false]) {
 const label=demo?'Demo':'Production',login=demo?'index.demo.html':'index.html';
 test(`${label}: logout uses configured login`,async()=>{const a=setup(demo,'admin-core');await a.window.InneraAdminCore.logout();assert.equal(a.window.location.href,login);assert.ok(a.calls.includes('signOut'));});
 for(const options of [{noUser:true},{inactive:true},{missing:true},{role:'doctor'}])test(`${label}: denied ${JSON.stringify(options)} routes correctly`,async()=>{const a=setup(demo,'admin-core',options);await a.boot();assert.equal(a.window.location.href,login);assert.ok(!a.calls.includes('ready'));});
 for(const script of ['admin-core','admin-auth']){
  test(`${label}/${script}: correct app works`,async()=>{const a=setup(demo,script);await a.boot();assert.ok(a.calls.includes('read'));assert.equal(a.calls.includes('initialize'),false);});
  test(`${label}/${script}: wrong default blocks services and login`,async()=>{const a=setup(demo,script,{wrong:true});await a.boot();assert.deepEqual(a.calls,[]);assert.equal(a.node('adminLoginForm').events.submit,undefined);assert.ok(!JSON.stringify(a.logs).includes('other-project'));});
  test(`${label}/${script}: newly initialized app is verified`,async()=>{const a=setup(demo,script,{fresh:true,badInit:true});await a.boot();assert.deepEqual(a.calls,['initialize']);});
  test(`${label}/${script}: correct fresh app works`,async()=>{const a=setup(demo,script,{fresh:true});await a.boot();assert.ok(a.calls.includes('initialize'));assert.ok(a.calls.includes('read'));});
 }
 test(`${label}: cached services cannot bypass mismatch`,()=>{const a=setup(demo,'admin-core');a.window.InneraAdminCore.init();a.swap();a.calls.length=0;assert.throws(()=>a.window.InneraAdminCore.getDb());assert.throws(()=>a.window.InneraAdminCore.getAuth());assert.deepEqual(a.calls,[]);});
 test(`${label}: login errors never expose raw details`,async()=>{const a=setup(demo,'admin-auth',{noUser:true,error:true});await a.boot();await a.node('adminLoginForm').events.submit({preventDefault(){}});assert.ok(!JSON.stringify([a.logs,a.node('loginMessage').textContent]).includes('SECRET'));});
 test(`${label}: login rechecks project before sign-in`,async()=>{const a=setup(demo,'admin-auth',{noUser:true});await a.boot();a.swap();a.calls.length=0;await a.node('adminLoginForm').events.submit({preventDefault(){}});assert.deepEqual(a.calls,[]);});
}
