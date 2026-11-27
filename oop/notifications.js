// Shared in-app notifications: private state, account-scoped read tracking,
// catalogue change detection, and due-time reminders. No background push/email.
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;
const MAX_UPDATES = 50;

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}
function millis(value) {
  const n = value?.toMillis?.();
  return Number.isFinite(n) ? n : 0;
}
export function loanDueState(request, now = Date.now()) {
  if (request.status !== "approved") return "none";
  const due = request.dueAt?.toMillis?.();
  if (!Number.isFinite(due)) return "none";
  if (due <= now) return "overdue";
  return due - now <= DUE_SOON_MS ? "soon" : "none";
}
export function dueReminderText(request, now = Date.now()) {
  const state = loanDueState(request, now);
  if (state === "none") return "";
  if (state === "overdue") return "Overdue. Please return this book to the library.";
  const minutes = Math.max(1, Math.ceil((request.dueAt.toMillis() - now) / 60000));
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  const remaining = hours
    ? `${hours} ${hours === 1 ? "hour" : "hours"}${rest ? ` ${rest} min` : ""}`
    : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return `Due soon — ${remaining} left. Please return this book on time.`;
}
export function notificationTime(value) {
  if (!Number.isFinite(value) || value <= 0) return "Awaiting timestamp";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila"
  }).format(new Date(value)) + " PHT";
}
function freshState() {
  return { version: 1, baseline: null, events: [], seen: [], sequence: 0 };
}
function bookState(data) {
  return {
    title: String(data.title || "Untitled book"),
    author: String(data.author || ""), category: String(data.category || ""),
    copies: Number.isSafeInteger(data.availableCopies) ? data.availableCopies : null,
    removed: data.removed === true,
    color: String(data.color || ""), ink: String(data.ink || "")
  };
}

export class NotificationCenter {
  #key;
  #storage;
  #state;
  #role;

  constructor(uid, role = "student", storage = browserStorage()) {
    this.#key = `bookbase:notifications:v1:${role}:${uid}`;
    this.#role = role;
    this.#storage = storage;
    this.#state = freshState();
    this.reload();
  }
  get storageKey() { return this.#key; }

  reload() {
    try {
      const saved = JSON.parse(this.#storage?.getItem(this.#key) || "null");
      if (saved?.version !== 1 || !Array.isArray(saved.events) || !Array.isArray(saved.seen)) return;
      if (saved.baseline !== null && !Array.isArray(saved.baseline)) return;
      this.#state = {
        version: 1,
        baseline: saved.baseline === null ? null : saved.baseline.filter(x =>
          Array.isArray(x) && typeof x[0] === "string" && x[1] && typeof x[1] === "object"),
        events: saved.events.filter(x => x && typeof x.id === "string" &&
          typeof x.title === "string" && typeof x.body === "string" &&
          typeof x.bookId === "string" && Number.isFinite(x.createdAt)).slice(0, MAX_UPDATES),
        seen: saved.seen.filter(x => typeof x === "string").slice(-500),
        sequence: Number.isSafeInteger(saved.sequence) && saved.sequence >= 0 ? saved.sequence : 0
      };
    } catch { /* Notifications still work in memory if storage is unavailable. */ }
  }
  #save() {
    try { this.#storage?.setItem(this.#key, JSON.stringify(this.#state)); } catch { /* Memory fallback. */ }
  }

  updateBooks(records, now = Date.now()) {
    this.reload(); // Another tab may already have recorded this exact snapshot.
    const next = new Map([...records].map(([id, data]) => [id, bookState(data)]));
    if (this.#state.baseline === null) {
      this.#state.baseline = [...next];
      this.#save();
      return; // The first visit is a baseline, not a flood of old book alerts.
    }
    const previous = new Map(this.#state.baseline);
    if (JSON.stringify([...next]) === JSON.stringify([...previous])) return;
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      const before = previous.get(id), after = next.get(id);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      let action, body;
      if ((!after && before && !before.removed) || (after?.removed && !before?.removed)) {
        action = "Book removed"; body = "This book is no longer in the catalogue.";
      } else if (after && !after.removed && (!before || before.removed)) {
        action = before ? "Book restored" : "New book added";
        body = "This book is now in the catalogue.";
      } else if (after && before && !after.removed) {
        action = "Book updated";
        const changes = [];
        if (["title", "author", "category", "color", "ink"].some(k => before[k] !== after[k])) changes.push("Book details changed.");
        if (before.copies !== after.copies) changes.push(
          after.copies === null ? "Availability changed." : `${after.copies} available ${after.copies === 1 ? "copy" : "copies"}.`);
        if (!changes.length) continue;
        body = changes.join(" ");
      } else continue;
      this.#state.sequence += 1;
      this.#state.events.unshift({
        id: `book:${id}:${this.#state.sequence}`, kind: "book", bookId: id,
        title: `${action}: ${after?.title || before.title}`,
        body, severity: "info", createdAt: now
      });
    }
    this.#state.events = this.#state.events.slice(0, MAX_UPDATES);
    this.#state.baseline = [...next];
    this.#save();
  }

  getUpdates(requests, { titleFor, borrowerFor = () => "", now = Date.now() }) {
    const updates = [...this.#state.events];
    const labels = { pending: "Pending request", approved: "Borrowed", returned: "Returned", rejected: "Rejected", cancelled: "Request cancelled" };
    for (const request of requests) {
      if (!labels[request.status]) continue;
      const state = loanDueState(request, now);
      const due = millis(request.dueAt);
      const title = titleFor(request.bookId);
      const borrower = this.#role === "admin" ? borrowerFor(request.studentUid) : "";
      const prefix = borrower ? `Borrower: ${borrower}. ` : "";
      if (state !== "none") {
        updates.push({
          id: `reminder:${request.id}:${due}:${state}`, kind: "request", requestId: request.id,
          status: request.status, bookId: request.bookId, severity: state,
          title: `${state === "overdue" ? "Overdue" : "Due soon"}: ${title}`,
          body: prefix + dueReminderText(request, now) + ` Due ${notificationTime(due)}.`,
          createdAt: due
        });
      } else {
        const createdAt = millis(request.cancelledAt) || millis(request.returnedAt) ||
          millis(request.reviewedAt) || millis(request.approvedAt) || millis(request.requestedAt);
        updates.push({
          id: JSON.stringify(["request", request.id, request.status, due, request.reason || ""]),
          kind: "request", requestId: request.id, status: request.status,
          bookId: request.bookId, severity: "info", createdAt,
          title: `${labels[request.status]}: ${title}`,
          body: prefix + (request.status === "approved" && due
            ? `Return by ${notificationTime(due)}.`
            : request.reason || "Borrowing record updated.")
        });
      }
    }
    const priority = { overdue: 2, soon: 1, info: 0 };
    return updates.sort((a, b) => (priority[b.severity] || 0) - (priority[a.severity] || 0) || (a.severity === "info" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt)).slice(0, MAX_UPDATES);
  }
  isUnread(update) { return !this.#state.seen.includes(update.id); }
  unreadCount(updates) { return updates.filter(x => this.isUnread(x)).length; }
  markRead(updates) {
    const seen = new Set(this.#state.seen);
    const previousSize = seen.size;
    for (const update of updates) seen.add(update.id);
    if (seen.size === previousSize) return;
    this.#state.seen = [...seen].slice(-500);
    this.#save();
  }
}

export function updateNotificationBell(center, updates, button, badge) {
  if (!button || !badge) return;
  const unread = center ? center.unreadCount(updates) : 0;
  const overdue = updates.filter(x => x.severity === "overdue").length;
  const soon = updates.filter(x => x.severity === "soon").length;
  badge.hidden = unread === 0;
  badge.textContent = unread > 99 ? "99+" : String(unread);
  button.classList.toggle("has-overdue", overdue > 0);
  button.classList.toggle("has-due-soon", !overdue && soon > 0);
  button.setAttribute("aria-label", `Notifications, ${unread} unread updates, ${soon} due soon, ${overdue} overdue`);
  button.title = `${unread} unread updates · ${soon} due soon · ${overdue} overdue`;
}
