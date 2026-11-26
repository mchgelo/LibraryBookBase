"""Browser smoke tests with mocked Firebase. No live account or database changes."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('BOOKBASE_TEST_URL', 'http://127.0.0.1:8773')
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
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.environ.get('BOOKBASE_CHROMIUM', '/usr/bin/chromium'),args=['--no-sandbox'])
 context,errors=prepare(b);page=context.new_page();page.goto(BASE+'/adminfiles/admin.html')
 page.locator('#app').wait_for(state='visible');page.locator('[data-view="books"]').click()
 money=page.locator('.admin-book-card').filter(has=page.get_by_role('heading',name='The Psychology of Money',exact=True))
 money.get_by_role('button',name='Remove book: The Psychology of Money',exact=True).click()
 page.get_by_role('dialog').get_by_role('heading',name='Remove book?',exact=True).wait_for()
 page.get_by_role('button',name='No, cancel',exact=True).click()
 assert page.evaluate('window.__test.data.get("books/money").removed') is None
 page.locator('#dashboard-toast.info').wait_for(state='visible')
 assert money.is_visible()
 print('PASS cancel: confirmation shown, no data changed, blue cancellation feedback.')
 page.evaluate('window.__test.writeDelay=500')
 money.get_by_role('button',name='Remove book: The Psychology of Money',exact=True).click()
 page.get_by_role('button',name='Yes, remove book',exact=True).click()
 page.get_by_role('button',name='Remove book: The Psychology of Money',exact=True).wait_for(state='visible')
 assert page.get_by_role('button',name='Remove book: The Psychology of Money',exact=True).is_disabled()
 assert page.locator('#dashboard-toast.success').count()==0
 page.locator('#dashboard-toast.success').wait_for()
 assert 'removed successfully' in page.locator('#dashboard-toast.success').inner_text()
 assert page.locator('#dashboard-toast.success').evaluate('(e)=>getComputedStyle(e).color')=='rgb(22, 101, 52)'
 assert money.count()==0
 assert page.evaluate('window.__test.data.get("books/money").availableCopies')==2
 assert page.evaluate('window.__test.data.get("books/money").removed') is True
 assert page.evaluate('window.__test.data.get("books/money").removedBy')=='admin-1'
 assert page.evaluate('window.__test.data.get("borrowRequests/seed-request").status')=='pending'
 assert page.locator('#copies-count').inner_text()=='0'
 print('PASS confirmed removal: disabled while saving, green only after success, catalogue hides row, copies/history preserved and count updated.')
 page.evaluate('window.__test.writeDelay=0')
 page.locator('[data-view="pending"]').click()
 assert page.get_by_role('button',name='Approve request',exact=True).is_disabled()
 assert 'Book removed from catalogue' in page.locator('#request-list').inner_text()
 page.locator('[data-view="books"]').click()
 sample=page.locator('.admin-book-card').filter(has=page.get_by_role('heading',name='Company of One',exact=True))
 sample.get_by_role('button',name='Remove book: Company of One',exact=True).click();page.get_by_role('button',name='Yes, remove book',exact=True).click()
 page.locator('#dashboard-toast.success').wait_for()
 assert sample.count()==0
 assert page.evaluate('window.__test.data.get("books/company").removed') is True
 page.locator('[data-view="pending"]').click();page.locator('[data-view="books"]').click()
 assert sample.count()==0
 print('PASS sample removal: persisted marker prevents fallback/sample book reappearance; pending approval disabled for removed books.')
 page.evaluate('window.__test.failWrites=true')
 card=page.locator('.admin-book-card').filter(has=page.get_by_role('heading',name='Atomic Habits',exact=True))
 card.get_by_role('button',name='Remove book: Atomic Habits',exact=True).click();page.get_by_role('button',name='Yes, remove book',exact=True).click()
 page.locator('#dashboard-toast.error').wait_for()
 assert page.locator('#dashboard-toast.error').evaluate('(e)=>getComputedStyle(e).color')=='rgb(153, 27, 27)'
 assert card.count()==1
 assert not card.get_by_role('button',name='Remove book: Atomic Habits',exact=True).is_disabled()
 assert page.evaluate('window.__test.data.has("books/habits")') is False
 print('PASS permission failure: red feedback, no false success or removal, retry enabled.')
 page.evaluate('window.__test.failWrites=false')
 result=page.evaluate('''async()=>{
 const {AdminCatalogueService,AdminBorrowingService}=await import('/oop/abstraction.js?v=remove-books-1');
 const {AdminProfile,AdminBook}=await import('/oop/inheritance.js');
 const s=window.__test, profile=new AdminProfile(s.auth.currentUser), service=new AdminCatalogueService({},s.auth);
 let repeat=false,approve=false;
 try{await service.removeBook(profile,new AdminBook('money',s.data.get('books/money')))}catch{repeat=true}
 try{await new AdminBorrowingService({},s.auth).approve(profile,'seed-request',s.ts(Date.now()+86400000))}catch{approve=true}
 s.data.set('borrowRequests/seed-request',{...s.data.get('borrowRequests/seed-request'),status:'approved'});
 await new AdminBorrowingService({},s.auth).returnBook(profile,'seed-request');
 return {repeat,approve,returned:s.data.get('borrowRequests/seed-request').status,copies:s.data.get('books/money').availableCopies,removed:s.data.get('books/money').removed};
 }''')
 assert result=={'repeat':True,'approve':True,'returned':'returned','copies':3,'removed':True},result
 print('PASS services: duplicate removal and removed-book approval rejected; outstanding return still works and keeps removal marker.')
 page.set_viewport_size({'width':390,'height':844})
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
 page.screenshot(path=str(Path(os.environ.get('BOOKBASE_TEST_SCREENSHOT', '/tmp/bookbase-remove-preview.png'))),full_page=True)
 assert not errors,errors
 context.close()
 context,errors=prepare(b);page=context.new_page();page.goto(BASE+'/student.html');page.locator('#app').wait_for(state='visible')
 page.locator('#search').fill('money');assert page.locator('.book-card').count()==1
 page.evaluate('''window.__test.data.set('books/money',{...window.__test.data.get('books/money'),removed:true});window.__test.listeners.forEach(fn=>fn());''')
 assert page.locator('.book-card').count()==0
 result=page.evaluate('''async()=>{
 const {BorrowingService,CatalogueService}=await import('/oop/abstraction.js?v=remove-books-1');
 const {StudentProfile}=await import('/oop/inheritance.js');const s=window.__test,user=s.auth.currentUser;
 try{await new BorrowingService({},s.auth).requestBook(user,new StudentProfile(user,s.data.get('users/student-1')),'money');return false}catch{return true}
 }''')
 assert result is True
 assert page.evaluate('[...window.__test.data.keys()].filter(x=>x.startsWith("borrowRequests/")).length')==0
 assert not errors,errors
 print('PASS student sync: realtime removal hides a default book and request service rejects a stale removed book without creating requests.')
 context.close();b.close()
