import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,getDoc,writeBatch,serverTimestamp,Timestamp,setLogLevel} from 'firebase/firestore';
setLogLevel('silent');
const env=await initializeTestEnvironment({projectId:'demo-bookbase',firestore:{host:'127.0.0.1',port:8787,rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
const auth=(uid,verified=true)=>env.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:verified}).firestore();
let passed=0;
async function scenario(label,fn){await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{
 const db=c.firestore();await setDoc(doc(db,'roles/admin-1'),{role:'admin'});
 await setDoc(doc(db,'books/money'),{title:'Money',author:'Author',category:'Finance',availableCopies:2});
 await setDoc(doc(db,'borrowRequests/loan'),{studentUid:'student-1',bookId:'money',status:'approved',requestedAt:Timestamp.fromMillis(1),approvedAt:Timestamp.fromMillis(2),dueAt:Timestamp.fromMillis(Date.now()+86400000)});
 await setDoc(doc(db,'borrowLocks/student-1_money'),{studentUid:'student-1',bookId:'money',requestId:'loan'});
 });await fn();passed++;console.log('PASS',label);}
const requestReturn=(db,extra={})=>updateDoc(doc(db,'borrowRequests/loan'),{returnRequestedAt:serverTimestamp(),returnRequestedBy:'student-1',...extra});
try{
await scenario('owner may request an approved return without changing stock or status',async()=>{
 const db=auth('student-1');await assertSucceeds(requestReturn(db));
 const request=(await getDoc(doc(db,'borrowRequests/loan'))).data();assert.equal(request.status,'approved');assert.equal(request.returnRequestedBy,'student-1');assert(request.returnRequestedAt instanceof Timestamp);
 assert.equal((await getDoc(doc(db,'books/money'))).data().availableCopies,2);
 assert((await getDoc(doc(db,'borrowLocks/student-1_money'))).exists());
});
await scenario('another student cannot request this return',async()=>{await assertFails(requestReturn(auth('student-2'),{returnRequestedBy:'student-2'}));});
await scenario('unauthenticated and unverified accounts are denied',async()=>{await assertFails(requestReturn(env.unauthenticatedContext().firestore()));await assertFails(requestReturn(auth('student-1',false)));});
await scenario('deleted account marker prevents a return request',async()=>{await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'deletedAccounts/student-1'),{deleted:true}));await assertFails(requestReturn(auth('student-1')));});
await scenario('pending, returned, rejected and cancelled states are not accepted',async()=>{
 for(const status of ['pending','returned','rejected','cancelled']){
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'borrowRequests/loan'),{status}));await assertFails(requestReturn(auth('student-1')));
 }
});
await scenario('duplicate return requests cannot overwrite the timestamp',async()=>{const db=auth('student-1');await assertSucceeds(requestReturn(db));await assertFails(requestReturn(db));});
await scenario('student cannot mark returned, change due date, owner or book identity',async()=>{
 const db=auth('student-1');for(const extra of [{status:'returned'},{dueAt:Timestamp.fromMillis(5)},{studentUid:'student-2'},{bookId:'other'},{returnedAt:serverTimestamp(),returnedBy:'student-1'}])await assertFails(requestReturn(db,extra));
});
await scenario('forged actor and client timestamp are denied',async()=>{const db=auth('student-1');await assertFails(requestReturn(db,{returnRequestedBy:'other'}));await assertFails(requestReturn(db,{returnRequestedAt:Timestamp.fromMillis(5)}));});
await scenario('missing or inconsistent active lock is denied',async()=>{
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'borrowLocks/student-1_money'),{studentUid:'student-1',bookId:'money',requestId:'other'}));await assertFails(requestReturn(auth('student-1')));
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore(),b=writeBatch(db);b.delete(doc(db,'borrowLocks/student-1_money'));await b.commit()});await assertFails(requestReturn(auth('student-1')));
});
await scenario('student cannot request a return while deleting the lock or adding inventory',async()=>{
 const db=auth('student-1');let batch=writeBatch(db);batch.update(doc(db,'borrowRequests/loan'),{returnRequestedAt:serverTimestamp(),returnRequestedBy:'student-1'});batch.delete(doc(db,'borrowLocks/student-1_money'));await assertFails(batch.commit());
 batch=writeBatch(db);batch.update(doc(db,'borrowRequests/loan'),{returnRequestedAt:serverTimestamp(),returnRequestedBy:'student-1'});batch.update(doc(db,'books/money'),{availableCopies:3});await assertFails(batch.commit());
});
await scenario('pending cancellation remains allowed under the existing rule',async()=>{
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'borrowRequests/loan'),{status:'pending'}));const db=auth('student-1'),b=writeBatch(db);b.update(doc(db,'borrowRequests/loan'),{status:'cancelled',cancelledAt:serverTimestamp()});b.delete(doc(db,'borrowLocks/student-1_money'));await assertSucceeds(b.commit());
});
await scenario('admin can confirm receipt and restore one copy',async()=>{
 await assertSucceeds(requestReturn(auth('student-1')));const db=auth('admin-1'),b=writeBatch(db);b.update(doc(db,'borrowRequests/loan'),{status:'returned',returnedAt:serverTimestamp(),returnedBy:'admin-1'});b.update(doc(db,'books/money'),{availableCopies:3});b.delete(doc(db,'borrowLocks/student-1_money'));await assertSucceeds(b.commit());
 assert.equal((await getDoc(doc(db,'borrowRequests/loan'))).data().status,'returned');assert.equal((await getDoc(doc(db,'books/money'))).data().availableCopies,3);
});
console.log(`${passed} Firestore emulator security scenarios passed.`);
}finally{await env.cleanup();}
