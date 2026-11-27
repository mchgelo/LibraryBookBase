import test from 'node:test';
import assert from 'node:assert/strict';
import {NotificationCenter,loanDueState,dueReminderText,DUE_SOON_MS} from '../oop/notifications.js';
const now=Date.UTC(2026,10,27,3,45),ts=n=>({toMillis:()=>n});
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)}};
const loan=(extra={})=>({id:'loan',bookId:'money',status:'approved',requestedAt:ts(now-1000),dueAt:ts(now+3600000),...extra});
const opts={titleFor:id=>id,now};
const book={title:'Money',author:'Author',category:'Finance',availableCopies:2};
test('due boundaries use approved status and exact timestamps',()=>{
 assert.equal(loanDueState(loan({dueAt:ts(now+DUE_SOON_MS+1)}),now),'none');
 assert.equal(loanDueState(loan({dueAt:ts(now+DUE_SOON_MS)}),now),'soon');
 assert.equal(loanDueState(loan({dueAt:ts(now)}),now),'overdue');
 for(const status of ['pending','returned','cancelled','rejected'])assert.equal(loanDueState(loan({status,dueAt:ts(now-1)}),now),'none');
 assert.equal(loanDueState(loan({dueAt:ts(NaN)}),now),'none');
 assert.match(dueReminderText(loan({dueAt:ts(now+61000)}),now),/2 minutes/);
});
test('first catalogue snapshot is a baseline; new books create one unread update',()=>{
 const c=new NotificationCenter('u','student',memory());c.updateBooks(new Map([['money',book]]),now);
 assert.equal(c.getUpdates([],opts).length,0);
 const books=new Map([['money',book],['new',{...book,title:'New'}]]);c.updateBooks(books,now);
 assert.equal(c.unreadCount(c.getUpdates([],opts)),1);
 c.updateBooks(books,now);assert.equal(c.getUpdates([],opts).length,1);
});
test('details, stock, removal and repeated edits each generate distinct real changes',()=>{
 const c=new NotificationCenter('u','student',memory());c.updateBooks(new Map([['money',book]]),now);
 for(const changes of [{title:'Changed'},{title:'Money'},{title:'Changed'},{availableCopies:0},{removed:true}]){
  c.updateBooks(new Map([['money',{...book,...changes}]]),now);
 }
 const updates=c.getUpdates([],opts);assert.equal(updates.length,5);
 assert.equal(new Set(updates.map(x=>x.id)).size,5);
 assert(updates.some(x=>x.title.startsWith('Book removed')));
});
test('read state persists through reload and is isolated by account and role',()=>{
 const storage=memory(),c=new NotificationCenter('one','student',storage);
 const updates=c.getUpdates([loan()],opts);c.markRead(updates);
 const next=new NotificationCenter('one','student',storage);
 assert.equal(next.unreadCount(next.getUpdates([loan()],opts)),0);
 for(const [uid,role] of [['two','student'],['one','admin']]){
  const other=new NotificationCenter(uid,role,storage);assert.equal(other.unreadCount(other.getUpdates([loan()],opts)),1);
 }
});
test('due-soon becomes a new overdue alert without a database event or duplicate minute reminders',()=>{
 const c=new NotificationCenter('u','student',memory());const req=loan({dueAt:ts(now+60000)});
 c.markRead(c.getUpdates([req],opts));
 assert.equal(c.unreadCount(c.getUpdates([req],{...opts,now:now+1000})),0);
 const late=c.getUpdates([req],{...opts,now:now+60000});
 assert.equal(late[0].severity,'overdue');assert.equal(c.unreadCount(late),1);
});
test('changed due date generates a new alert; returned loans have no active reminder',()=>{
 const c=new NotificationCenter('u','student',memory());c.markRead(c.getUpdates([loan()],opts));
 assert.equal(c.unreadCount(c.getUpdates([loan({dueAt:ts(now+7200000)})],opts)),1);
 const returned=c.getUpdates([loan({status:'returned',dueAt:ts(now-1),returnedAt:ts(now)})],opts);
 assert.equal(returned.length,1);assert.equal(returned[0].severity,'info');assert.match(returned[0].title,/Returned/);
});
test('overdue and nearest upcoming due dates precede general updates',()=>{
 const c=new NotificationCenter('u','admin',memory());
 const rows=c.getUpdates([loan({id:'far',dueAt:ts(now+7200000)}),loan({id:'late',dueAt:ts(now-1)}),loan({id:'near',dueAt:ts(now+1000)}),loan({id:'pending',status:'pending'})],{...opts,borrowerFor:()=> 'Student'});
 assert.deepEqual(rows.map(x=>x.requestId),['late','near','far','pending']);assert.match(rows[0].body,/Borrower: Student/);
});
test('blocked or corrupt storage falls back to in-memory notifications',()=>{
 for(const storage of [{getItem(){throw Error()},setItem(){throw Error()}},{getItem:()=>'{bad',setItem(){}}]){
  const c=new NotificationCenter('u','student',storage);c.updateBooks(new Map(),now);c.updateBooks(new Map([['money',book]]),now);
  assert.equal(c.getUpdates([],opts).length,1);c.markRead(c.getUpdates([],opts));assert.equal(c.unreadCount(c.getUpdates([],opts)),0);
 }
});
test('tabs sharing an account do not duplicate catalogue updates',()=>{
 const storage=memory(),a=new NotificationCenter('u','student',storage),b=new NotificationCenter('u','student',storage);
 a.updateBooks(new Map(),now);const records=new Map([['money',book]]);
 a.updateBooks(records,now);b.updateBooks(records,now);
 assert.equal(b.getUpdates([],opts).length,1);a.reload();a.markRead(a.getUpdates([],opts));b.reload();assert.equal(b.unreadCount(b.getUpdates([],opts)),0);
});
test('entering the 24-hour window creates a new unread reminder without changing the loan',()=>{
 const c=new NotificationCenter('u','student',memory());const req=loan({dueAt:ts(now+DUE_SOON_MS+60000)});
 const before=c.getUpdates([req],opts);assert.equal(before[0].severity,'info');c.markRead(before);
 const upcoming=c.getUpdates([req],{...opts,now:now+60000});assert.equal(upcoming[0].severity,'soon');assert.equal(c.unreadCount(upcoming),1);
});
