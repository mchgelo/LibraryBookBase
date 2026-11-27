"""Browser smoke tests with mocked Firebase. No live account or database changes."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('BOOKBASE_TEST_URL', 'http://127.0.0.1:8780')
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
from playwright.sync_api import expect
INIT += """
const s=window.__test;
s.data.delete('borrowRequests/seed-request');
s.data.set('borrowRequests/loan-1', {studentUid:'student-1',bookId:'money',status:'approved',requestedAt:ts(Date.now()-10000),approvedAt:ts(Date.now()-5000),dueAt:ts(Date.now()+7*86400000)});
s.data.set('borrowLocks/student-1_money',{studentUid:'student-1',bookId:'money',requestId:'loan-1'});
"""
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('BOOKBASE_CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox'])
 context,errors=prepare(browser);page=context.new_page();page.goto(BASE+'/student.html');page.locator('#app').wait_for(state='visible');page.locator('[data-view="library"]').click()
 button=page.get_by_role('button',name='Return book',exact=True);expect(button).to_be_visible();button.click()
 expect(page.get_by_role('dialog')).to_contain_text('librarian confirms receipt')
 page.get_by_role('button',name='No, go back',exact=True).click();page.locator('.student-toast.info').wait_for()
 assert page.evaluate('window.__test.data.get("borrowRequests/loan-1").returnRequestedBy') is None
 assert page.evaluate('window.__test.data.get("books/money").availableCopies')==2
 print('PASS cancellation: confirmation identifies book, no loan/stock changes, blue feedback.')
 page.evaluate('window.__test.failWrites=true');button.click();page.get_by_role('button',name='Yes, request return',exact=True).click();page.locator('.student-toast.error').wait_for()
 expect(button).to_be_enabled();assert page.evaluate('window.__test.data.get("borrowRequests/loan-1").returnRequestedBy') is None
 print('PASS permission failure: red permission feedback, loan unchanged, retry enabled.')
 page.evaluate('window.__test.failWrites=false;window.__test.writeDelay=500');button.click();page.get_by_role('button',name='Yes, request return',exact=True).click()
 expect(page.get_by_role('button',name='Please wait...',exact=True)).to_be_disabled()
 page.locator('.student-toast.success').wait_for()
 expect(page.get_by_role('button',name='Return requested',exact=True)).to_be_disabled()
 expect(page.locator('.loan-card')).to_contain_text('waiting for the librarian')
 assert page.evaluate('window.__test.data.get("borrowRequests/loan-1").status')=='approved'
 assert page.evaluate('window.__test.data.get("borrowRequests/loan-1").returnRequestedBy')=='student-1'
 assert page.evaluate('window.__test.data.get("borrowRequests/loan-1").returnRequestedAt.toMillis()>0')
 assert page.evaluate('window.__test.data.get("books/money").availableCopies')==2
 assert page.evaluate('window.__test.data.has("borrowLocks/student-1_money")')
 result=page.evaluate("""async()=>{const {BorrowingService}=await import('/oop/abstraction.js?v=student-return-1');const s=window.__test;try{await new BorrowingService({},s.auth).requestReturn(s.auth.currentUser,'loan-1');return false}catch{return true}}""")
 assert result is True
 print('PASS request: success after save, timestamp/owner recorded, duplicate blocked, stock/lock/status preserved.')
 # Validate service guards without changing live Firebase data.
 checks=page.evaluate("""async()=>{const {BorrowingService}=await import('/oop/abstraction.js?v=student-return-1');const s=window.__test,svc=new BorrowingService({},s.auth),base={...s.data.get('borrowRequests/loan-1')};delete base.returnRequestedBy;delete base.returnRequestedAt;const results=[];for(const data of [{...base,studentUid:'other'},{...base,status:'pending'},{...base,status:'returned'}]){s.data.set('borrowRequests/check',data);try{await svc.requestReturn(s.auth.currentUser,'check');results.push(false)}catch{results.push(true)}}s.data.delete('borrowRequests/check');return results;}""")
 assert checks==[True,True,True]
 payload=page.evaluate("""(()=>{const d=window.__test.data.get('borrowRequests/loan-1');return {...d,requestedAt:d.requestedAt.toMillis(),approvedAt:d.approvedAt.toMillis(),dueAt:d.dueAt.toMillis(),returnRequestedAt:d.returnRequestedAt.toMillis()}})()""")
 adminContext,adminErrors=prepare(browser)
 import json
 adminContext.add_init_script("const loan="+json.dumps(payload)+";['requestedAt','approvedAt','dueAt','returnRequestedAt'].forEach(k=>loan[k]=window.__test.ts(loan[k]));window.__test.data.set('borrowRequests/loan-1',loan);")
 admin=adminContext.new_page();admin.goto(BASE+'/adminfiles/admin.html');admin.locator('#app').wait_for(state='visible')
 admin.locator('[data-dropdown="notifications"]').click();expect(admin.locator('#notifications')).to_contain_text('Return requested: The Psychology of Money')
 admin.locator('#notifications .notification-entry').filter(has_text='Return requested: The Psychology of Money').click()
 expect(admin.locator('#request-list')).to_contain_text('Student requested a return')
 admin.get_by_role('button',name='Confirm return?',exact=True).click();admin.get_by_role('button',name='No, cancel',exact=True).click()
 assert admin.evaluate('window.__test.data.get("books/money").availableCopies')==2
 admin.get_by_role('button',name='Confirm return?',exact=True).click();admin.get_by_role('button',name='Yes, returned',exact=True).click();admin.locator('#dashboard-toast.success').wait_for()
 assert admin.evaluate('window.__test.data.get("borrowRequests/loan-1").status')=='returned'
 assert admin.evaluate('window.__test.data.get("books/money").availableCopies')==3
 assert not admin.evaluate('window.__test.data.has("borrowLocks/student-1_money")')
 print('PASS admin: unread return alert, confirm/cancel dialog, one copy restored only after receipt confirmation.')
 result=admin.evaluate("""async()=>{const {AdminBorrowingService}=await import('/oop/abstraction.js?v=student-return-1');const {AdminProfile}=await import('/oop/inheritance.js');const s=window.__test;try{await new AdminBorrowingService({},s.auth).returnBook(new AdminProfile(s.auth.currentUser),'loan-1');return false}catch{return s.data.get('books/money').availableCopies===3}}""")
 assert result is True
 page.evaluate("""const s=window.__test,d=s.data.get('borrowRequests/loan-1');d.status='returned';d.returnedAt=s.ts(Date.now());s.data.get('books/money').availableCopies=3;s.data.delete('borrowLocks/student-1_money');s.listeners.forEach(fn=>fn());""")
 expect(page.locator('.return-book-button')).to_have_count(0)
 page.locator('[data-view="history"]').click();expect(page.locator('.loan-status.returned')).to_have_count(1)
 page.locator('[data-dropdown="notifications"]').click();expect(page.locator('#notifications')).to_contain_text('Returned: The Psychology of Money')
 expect(page.locator('#notifications')).not_to_contain_text('Return request sent:')
 page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors;assert not adminErrors,adminErrors
 print('PASS student: returned history and notification sync, stale request alert clears, mobile layout and no JavaScript errors.')
 context.close();adminContext.close();browser.close()
