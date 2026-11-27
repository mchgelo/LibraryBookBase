"""Browser smoke tests with mocked Firebase. No live account or database changes."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('BOOKBASE_TEST_URL', 'http://127.0.0.1:8776')
SDK_APP='export const initializeApp=(config)=>({name:"[DEFAULT]"}); export const getApps=()=>[];'
SDK_AUTH='''
export const validatePassword=async()=>({isValid:true});
const state=window.__test;
export const getAuth=()=>state.auth;
export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb(auth.currentUser),0);return ()=>{};};
export const signOut=async(auth)=>{auth.currentUser=null;};
export const setPersistence=async()=>{};
export const browserLocalPersistence={}; export const browserSessionPersistence={};
export const signInWithEmailAndPassword=async(auth,email,password)=>({user:auth.currentUser});
export const createUserWithEmailAndPassword=async(auth,email,password)=>({user:auth.currentUser});
export const sendEmailVerification=async()=>{};
export const updateProfile=async(user,values)=>Object.assign(user,values);
export const sendPasswordResetEmail=async()=>{};
'''
SDK_DB='''
const s=window.__test;
export const getFirestore=()=>({});
export const collection=(_,name)=>({path:name});
export const doc=(a,b,c)=>c===undefined ? {path:a.path+"/request-"+(++s.seq),id:"request-"+s.seq} : {path:b+"/"+c,id:c};
export const where=(field,operator,value)=>({field,value});
export const query=(ref,...conditions)=>({...ref,conditions});
export const serverTimestamp=()=>s.ts(Date.now());
export const Timestamp={fromMillis:ms=>s.ts(ms)};
const snap=(ref)=>({id:ref.id,exists:()=>s.data.has(ref.path),data:()=>s.data.get(ref.path)});
export const getDoc=async(ref)=>snap(ref);
function emit(ref,cb){
 if(ref.path.includes('/')){cb(snap(ref));return;}
 const docs=[...s.data].filter(([path,data])=>path.startsWith(ref.path+'/')&&(!ref.conditions||ref.conditions.every(c=>data[c.field]===c.value))).map(([path,data])=>({id:path.split('/').pop(),data:()=>data}));
 cb({docs});
}
export const onSnapshot=(ref,cb)=>{const listener=()=>emit(ref,cb);s.listeners.push(listener);setTimeout(listener,0);return ()=>{s.listeners=s.listeners.filter(x=>x!==listener);};};
const notify=()=>s.listeners.forEach(fn=>fn());
export const setDoc=async(ref,data)=>{s.data.set(ref.path,data);notify();};
export const runTransaction=async(_,callback)=>{
 const writes=[];
 await callback({get:async(ref)=>snap(ref),set:(r,d)=>writes.push(()=>s.data.set(r.path,d)),update:(r,d)=>writes.push(()=>s.data.set(r.path,{...s.data.get(r.path),...d})),delete:r=>writes.push(()=>s.data.delete(r.path))});
 writes.forEach(fn=>fn());notify();
};
'''
INIT='''
const admin=location.pathname.includes('adminfiles');
const user={uid:admin?'admin-1':'student-1',displayName:admin?'Librarian One':'Student One',email:admin?'admin@example.com':'student@example.com',emailVerified:true};
const ts=ms=>({toDate:()=>new Date(ms),toMillis:()=>ms});
window.__test={auth:{currentUser:user},listeners:[],seq:0,ts,data:new Map([
 ['roles/admin-1',{role:'admin'}],['roles/student-1',{role:'student'}],
 ['users/student-1',{fullName:'Student One',studentId:'2026-001',course:'BSIT',email:'student@example.com'}],
 ['books/money',{title:'The Psychology of Money',author:'Morgan Housel',category:'Finance',availableCopies:2}],
 ...(admin?[
 ['borrowRequests/seed-request',{studentUid:'student-1',bookId:'money',status:'pending',requestedAt:ts(Date.now())}],
 ['borrowLocks/student-1_money',{studentUid:'student-1',bookId:'money',requestId:'seed-request'}]
 ]:[])
])};
'''

def prepare(browser):
 context=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='America/New_York')
 context.add_init_script(INIT)
 errors=[]
 context.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
 def route(request):
  url=request.request.url
  if 'gstatic.com/firebasejs/' in url:
   body=SDK_APP if 'firebase-app.js' in url else SDK_AUTH if 'firebase-auth.js' in url else SDK_DB
   request.fulfill(status=200,content_type='text/javascript',body=body)
  elif url.startswith(BASE+'/adminfiles/admin.'):
   from pathlib import Path
   from urllib.parse import urlparse
   name=urlparse(url).path.split('/')[-1]
   request.fulfill(status=200,content_type='text/html' if name.endswith('.html') else 'text/css' if name.endswith('.css') else 'text/javascript',body=(ROOT / 'adminfiles' / name).read_text())
  elif url.startswith(BASE+'/student.'):
   from pathlib import Path
   from urllib.parse import urlparse
   name=urlparse(url).path.split('/')[-1]
   request.fulfill(status=200,content_type='text/html' if name.endswith('.html') else 'text/css' if name.endswith('.css') else 'text/javascript',body=(ROOT / name).read_text())
  elif url.startswith(BASE):request.continue_()
  else:request.abort()
 context.route('**/*',route)
 return context,errors

SDK_DB=SDK_DB.replace('const writes=[];', '''if(s.failWrites) throw Object.assign(new Error('denied'),{code:'permission-denied'});
 if(s.writeDelay) await new Promise(resolve=>setTimeout(resolve,s.writeDelay));
 const writes=[];''')
from datetime import datetime, timezone
from playwright.sync_api import expect
INIT += """
const seedNow=Date.parse('2026-11-27T03:00:00Z');
window.__test.data.delete('borrowRequests/seed-request');
window.__test.data.delete('borrowLocks/student-1_money');
window.__test.data.set('borrowRequests/reminder-loan',{
 studentUid:'student-1',bookId:'money',status:'approved',
 requestedAt:ts(seedNow-10000),approvedAt:ts(seedNow-5000),dueAt:ts(seedNow+61000)
});
"""
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('BOOKBASE_CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox'])
 for admin in [False,True]:
  context,errors=prepare(browser);page=context.new_page()
  page.clock.install(time=datetime(2026,11,27,3,0,0,tzinfo=timezone.utc))
  path='/adminfiles/admin.html' if admin else '/student.html'
  page.goto(BASE+path);page.locator('#app').wait_for(state='visible')
  bell=page.locator('[data-dropdown="notifications"]');badge=page.locator('#notification-count')
  expect(badge).to_have_text('1');expect(badge).to_be_visible()
  expect(bell).to_have_class(__import__('re').compile('has-due-soon'))
  bell.click();expect(page.locator('#notifications .notice-soon')).to_have_count(1)
  expect(page.locator('#notifications')).to_contain_text('PHT')
  expect(badge).to_be_hidden();bell.click()
  page.reload();page.locator('#app').wait_for(state='visible');expect(badge).to_be_hidden()
  view='approved' if admin else 'library';page.locator(f'.nav-button[data-view="{view}"]').click()
  expect(page.locator('.record-due-soon' if admin else '.due-soon-card')).to_have_count(1)
  page.clock.fast_forward(62000)
  expect(badge).to_have_text('1');expect(badge).to_be_visible()
  expect(bell).to_have_class(__import__('re').compile('has-overdue'))
  expect(page.locator('.record-overdue' if admin else '.overdue-card')).to_have_count(1)
  bell.click();expect(page.locator('#notifications .notice-overdue')).to_have_count(1);expect(badge).to_be_hidden();bell.click()
  print('PASS', 'admin' if admin else 'student', 'due-soon indicator, read persistence across refresh, timed overdue transition without database writes, warning cards, PHT labels.')
  page.evaluate("""window.__test.data.set('books/new-test',{title:'Notification Test',author:'Author',category:'Science',availableCopies:2});window.__test.listeners.forEach(fn=>fn());""")
  expect(badge).to_have_text('1');expect(badge).to_be_visible()
  bell.click();expect(page.locator('#notifications')).to_contain_text('New book added: Notification Test');expect(badge).to_be_hidden();bell.click()
  page.evaluate("""window.__test.data.get('books/new-test').availableCopies=0;window.__test.listeners.forEach(fn=>fn());""")
  expect(badge).to_have_text('1');bell.click();expect(page.locator('#notifications')).to_contain_text('0 available copies.');bell.click()
  page.evaluate("""window.__test.data.get('books/new-test').removed=true;window.__test.listeners.forEach(fn=>fn());""")
  expect(badge).to_have_text('1');bell.click();expect(page.locator('#notifications')).to_contain_text('Book removed: Notification Test');bell.click()
  page.evaluate("""window.__test.data.get('borrowRequests/reminder-loan').status='returned';window.__test.data.get('borrowRequests/reminder-loan').returnedAt=window.__test.ts(Date.now());window.__test.listeners.forEach(fn=>fn());""")
  expect(badge).to_have_text('1');expect(bell).not_to_have_class(__import__('re').compile('has-overdue'))
  bell.click();expect(page.locator('#notifications .notice-overdue')).to_have_count(0);expect(page.locator('#notifications')).to_contain_text('Returned: The Psychology of Money')
  print('PASS', 'admin' if admin else 'student', 'live catalogue add/stock/removal alerts, unread resets, and returned loan clears reminder.')
  page.set_viewport_size({'width':390,'height':844})
  expect(page.locator('#notifications')).to_be_visible()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/bookbase-notifications-{ "admin" if admin else "student"}.png',full_page=True)
  assert not errors,errors
  print('PASS', 'admin' if admin else 'student', 'mobile dropdown/badge and no browser JavaScript errors.')
  context.close()
 browser.close()
