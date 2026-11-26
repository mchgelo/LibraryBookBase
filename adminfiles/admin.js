// PAGE ENTRY: Firebase setup, UI events and live data.
// Open oop/ for the four presentation modules.
import { AdminRecord, BookCoverPalette } from "../oop/encapsulation.js";
import { AdminProfile, AdminBook } from "../oop/inheritance.js";
import { AdminProfileService, AdminBorrowingService, AdminCatalogueService, AdminFilterService } from "../oop/abstraction.js";
import { recordSummary } from "../oop/polymorphism.js";
export { AdminRecord, AdminProfile, AdminBook, BookCoverPalette, AdminProfileService, AdminBorrowingService, AdminCatalogueService, AdminFilterService };

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  updateProfile,
  signOut
} from
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp
} from
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";


// =====================================================
// FIREBASE
// =====================================================

const app = initializeApp({
  apiKey: "AIzaSyAI-ZTiaClMvISqvG5KIJW8rA_YQ0rukbw",
  authDomain: "library-db9da.firebaseapp.com",
  projectId: "library-db9da",
  storageBucket: "library-db9da.firebasestorage.app",
  messagingSenderId: "938072556708",
  appId: "1:938072556708:web:39370090740ce6125a9231"
});

const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);


// Record classes and services are imported from ../oop/.

// =====================================================
// OBJECTS AND STATE
// =====================================================

const adminBorrowingService =
  new AdminBorrowingService(db, auth);

const adminCatalogueService =
  new AdminCatalogueService(db, auth);

const adminProfileService =
  new AdminProfileService(auth);

const adminFilterService =
  new AdminFilterService();

let currentAdminProfile = null;
let currentUser = null;
let currentView = "pending";

let booksQuery = "";
let transactionsQuery = "";

let books = new Map();
let requests = [];

let booksLoaded = false;
let requestsLoaded = false;
let booksError = "";
let requestsError = "";

let stopBooks = null;
let stopRequests = null;
let version = 0;
let loggingOut = false;
let toastTimer = null;
let overdueSignature = "";

const borrowerProfiles = new Map();
const profileSubscriptions = new Map();
const processing = new Set();


// =====================================================
// CATALOGUE EXAMPLES
// =====================================================

const studentCatalogueDefaults = [
  ["money", "The Psychology of Money", "Morgan Housel", "Finance", "#789483", "#ffffff"],
  ["innovation", "How Innovation Works", "Matt Ridley", "Science", "#f5d52c", "#263b42"],
  ["company", "Company of One", "Paul Jarvis", "Business", "#e9eae3", "#303a42"],
  ["habits", "Atomic Habits", "James Clear", "Self-development", "#e6d8c0", "#554334"],
  ["alchemist", "The Alchemist", "Paulo Coelho", "Fiction", "#b76342", "#fff3d8"],
  ["brief", "A Brief History of Time", "Stephen Hawking", "Science", "#263c60", "#e7efff"],
  ["deep", "Deep Work", "Cal Newport", "Self-development", "#cc6c53", "#fff7ed"],
  ["little", "The Little Prince", "Antoine de Saint-Exupéry", "Fiction", "#9fbfc9", "#203c50"]
].map(([id, title, author, category, color, ink]) => ({
  id, title, author, category, color, ink
}));

const pages = {
  pending: [
    "Borrow requests",
    "Review requests before issuing a book."
  ],
  approved: [
    "Borrowed books",
    "Track issued books, due dates, and returns."
  ],
  history: [
    "Borrowing history",
    "Review returned books, declined requests, and student cancellations."
  ],
  books: [
    "Manage books",
    "View the student catalogue and manage book inventory."
  ]
};


// =====================================================
// HELPERS
// =====================================================

function node(tag, className = "", text) {
  const item = document.createElement(tag);
  item.className = className;

  if (text !== undefined) {
    item.textContent = text;
  }

  return item;
}

function createIcon(name) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const use = document.createElementNS(ns, "use");

  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);

  return svg;
}

// Polymorphic presentation for AdminBook and AdminProfile.
function recordHeading(record, tag = "h3") {
  return node(tag, "", recordSummary(record).title);
}

function dateText(value) {
  if (!value?.toDate) return "Timestamp not recorded";

  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: true,
    timeZone: "Asia/Manila"
  }).format(value.toDate()) + " PHT";
}

function titleFor(id) {
  return books.get(id)?.title ||
    studentCatalogueDefaults.find(book => book.id === id)?.title ||
    id;
}

function isOverdue(request, now = Date.now()) {
  const due = request.dueAt?.toMillis?.();

  return request.status === "approved" &&
    Number.isFinite(due) &&
    due <= now;
}

function eventMillis(request) {
  const value =
    request.cancelledAt ||
    request.returnedAt ||
    request.reviewedAt ||
    request.approvedAt ||
    request.requestedAt;

  return value?.toMillis?.() || 0;
}

// Interpret date/time picker values as Philippine time.
function toManilaInput(millis) {
  return new Date(
    millis + 8 * 60 * 60 * 1000
  ).toISOString().slice(0, 16);
}

function parseManilaInput(value) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);

  if (!match) return NaN;

  const [, year, month, day, hour, minute] =
    match.map(Number);

  const millis = Date.UTC(
    year,
    month - 1,
    day,
    hour - 8,
    minute
  );

  return Number.isFinite(millis) &&
    toManilaInput(millis) === value
      ? millis
      : NaN;
}

function borrowerFor(uid) {
  const entry = borrowerProfiles.get(uid);

  return entry?.state === "ready"
    ? {
        ...entry.data,
        fullName: entry.data.fullName || uid
      }
    : {
        fullName: uid || "Unknown borrower",
        studentId: "",
        course: "",
        email: ""
      };
}

function closeMenus() {
  document.querySelectorAll("[data-dropdown]").forEach(button => {
    const panel = $(button.dataset.dropdown);

    if (panel) panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  });
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("shade").hidden = true;
  $("menu-button").setAttribute("aria-expanded", "false");
}


// =====================================================
// TOAST NOTIFICATIONS
// =====================================================

function message(text, error = false, kind = "success") {
  clearTimeout(toastTimer);
  $("dashboard-toast")?.remove();
  $("status").textContent = "";

  if (!text) return;

  const type = error
    ? "error"
    : kind === "info"
      ? "info"
      : "success";

  const labels = {
    success: "Successful",
    error: "Action failed",
    info: "Notice"
  };

  const symbols = {
    success: "✓",
    error: "!",
    info: "i"
  };

  const toast = node("div", `dashboard-toast ${type}`);
  toast.id = "dashboard-toast";

  const icon = node("span", "toast-icon", symbols[type]);
  icon.setAttribute("aria-hidden", "true");

  const content = node("div", "toast-content");
  content.setAttribute("role", error ? "alert" : "status");
  content.setAttribute("aria-atomic", "true");

  content.append(
    node("strong", "", labels[type]),
    node("p", "", text)
  );

  const close = node("button", "toast-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss notification");

  close.addEventListener("click", () => {
    clearTimeout(toastTimer);
    toast.remove();
  });

  toast.append(icon, content, close);
  document.body.append(toast);

  function scheduleDismiss() {
    clearTimeout(toastTimer);
    if (type !== "success") return;

    toastTimer = setTimeout(() => {
      if (
        toast.isConnected &&
        !toast.matches(":hover, :focus-within")
      ) {
        toast.remove();
      }
    }, 6000);
  }

  toast.addEventListener("pointerenter", () => clearTimeout(toastTimer));
  toast.addEventListener("focusin", () => clearTimeout(toastTimer));
  toast.addEventListener("pointerleave", scheduleDismiss);
  toast.addEventListener("focusout", scheduleDismiss);

  scheduleDismiss();
}


// =====================================================
// PROFILE
// =====================================================

function fillAvatar(target, user) {
  if (!target) return;

  const name =
    currentAdminProfile?.name ||
    user.displayName ||
    user.email ||
    "Admin";

  target.textContent = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => Array.from(part)[0])
    .join("")
    .toUpperCase();

  if (!user.photoURL) return;

  try {
    const url = new URL(user.photoURL);
    if (url.protocol !== "https:") return;

    const image = node("img");
    image.src = url.href;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove());
    target.append(image);
  } catch {
    // Keep initials.
  }
}

function fillProfile(user) {
  const profile =
    currentAdminProfile || new AdminProfile(user);

  $("admin-name").textContent = profile.name;
  $("profile-name").textContent = profile.name;
  $("profile-email").textContent = profile.email || "No email provided";

  $("profile-role").textContent =
    `Admin / Librarian · ${
      profile.verified ? "Email verified" : "Email not verified"
    }`;

  fillAvatar($("avatar"), user);
  fillAvatar($("profile-avatar"), user);
}

function showProfile(editing = false) {
  if (
    !currentUser ||
    !currentAdminProfile ||
    document.querySelector("dialog[open]")
  ) {
    return;
  }

  closeMenus();

  const profile = currentAdminProfile;
  const dialog = node("dialog", "ui-dialog admin-profile-dialog");

  const heading = node(
    "h2",
    "",
    editing ? "Edit profile" : "Profile details"
  );

  heading.id = "profile-dialog-title";
  dialog.setAttribute("aria-labelledby", heading.id);

  const identity = node("div", "profile-identity");
  const avatar = node("span", "avatar");
  fillAvatar(avatar, currentUser);

  identity.append(avatar, recordHeading(profile));
  dialog.append(heading, identity);

  const details = node("dl", "profile-detail-list");

  const fields = [
    ["user", "Full name", profile.name],
    ["mail", "Email address", profile.email || "Not provided"],
    ["shield", "Role", "Admin / Librarian"],
    ["check", "Email status", profile.verified ? "Verified" : "Not verified"],
    ["key", "User ID", profile.id]
  ];

  fields.forEach(([icon, label, value]) => {
    if (editing && label === "Full name") return;

    const row = node("div", "profile-detail-row");
    const text = node("div");

    text.append(
      node("dt", "", label),
      node("dd", "", value)
    );

    row.append(createIcon(icon), text);
    details.append(row);
  });

  if (!editing) {
    const actions = node("div", "dialog-actions");
    const close = node("button", "ui-neutral", "Close");
    close.type = "button";
    close.autofocus = true;
    close.addEventListener("click", () => dialog.close());

    const edit = node("button", "ui-success");
    edit.type = "button";

    edit.append(
      createIcon("edit"),
      node("span", "", "Edit profile")
    );

    edit.addEventListener("click", () => {
      dialog.close();
      showProfile(true);
    });

    actions.append(close, edit);
    dialog.append(details, actions);
  } else {
    const form = node("form", "admin-profile-form");
    const label = node("label");
    const caption = node("span", "profile-input-label");

    caption.append(
      createIcon("user"),
      node("span", "", "Full name")
    );

    const input = node("input");
    input.id = "admin-profile-full-name";
    input.value = profile.name;
    input.autocomplete = "name";
    input.maxLength = 100;
    input.required = true;

    label.append(caption, input);

    const actions = node("div", "dialog-actions");
    const cancel = node("button", "ui-neutral", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => dialog.close());

    const save = node("button", "ui-success");
    save.type = "submit";

    save.append(
      createIcon("save"),
      node("span", "", "Save profile")
    );

    actions.append(cancel, save);

    form.append(
      label,
      node(
        "p",
        "hint",
        "Email and role are shown for reference and cannot be changed here."
      ),
      details,
      actions
    );

    let saving = false;

    form.addEventListener("submit", async event => {
      event.preventDefault();

      if (saving || !form.reportValidity()) return;

      const session = version;
      saving = true;
      save.disabled = true;
      input.readOnly = true;
      save.textContent = "Saving...";

      try {
        const updated = await adminProfileService.updateName(
          profile,
          input.value
        );

        if (session !== version) return;

        currentAdminProfile = updated;
        fillProfile(currentUser);
        dialog.close();
        message("Admin profile updated successfully.");
      } catch (error) {
        if (session === version) {
          message(
            error.code
              ? `Unable to update profile (${error.code}). Try again.`
              : error.message,
            true
          );
        }
      } finally {
        saving = false;
        save.disabled = false;
        input.readOnly = false;

        save.replaceChildren(
          createIcon("save"),
          node("span", "", "Save profile")
        );
      }
    });

    dialog.append(form);
  }

  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();

  if (editing) $("admin-profile-full-name").focus();
}


// =====================================================
// CONFIRMATION WITH OPTIONAL DUE DATE/TIME
// =====================================================

function ask(
  title,
  description,
  yesLabel,
  danger = false,
  needsReason = false,
  needsDue = false
) {
  if (document.querySelector("dialog[open]")) {
    return Promise.resolve(null);
  }

  closeMenus();

  const dialog = node("dialog", "ui-dialog");

  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="confirmation-title"></h2>
      <p id="confirmation-description"></p>

      <label id="reason-label">
        Reason
        <textarea
          id="confirmation-reason"
          maxlength="500"
          rows="3"
        ></textarea>
      </label>

      <div id="due-fields">
        <label for="approval-due">
          Due date and time (Philippine time)
        </label>
        <input
          type="datetime-local"
          id="approval-due"
          step="60"
        >
        <p class="hint">
          PHT / UTC+08:00. Select when the book must be returned.
        </p>
      </div>

      <div class="dialog-actions">
        <button
          value="cancel"
          class="ui-neutral"
          formnovalidate
          autofocus
        >No, cancel</button>

        <button
          value="confirm"
          id="confirmation-yes"
        ></button>
      </div>
    </form>
  `;

  dialog.setAttribute("aria-labelledby", "confirmation-title");
  dialog.setAttribute("aria-describedby", "confirmation-description");

  document.body.append(dialog);

  $("confirmation-title").textContent = title;
  $("confirmation-description").textContent = description;
  $("reason-label").hidden = !needsReason;
  $("confirmation-reason").required = needsReason;
  $("confirmation-yes").textContent = yesLabel;
  $("confirmation-yes").className = danger ? "ui-danger" : "ui-success";

  const due = dialog.querySelector("#approval-due");

  dialog.querySelector("#due-fields").hidden = !needsDue;
  due.required = needsDue;

  if (needsDue) {
    due.min = toManilaInput(
      Math.ceil((Date.now() + 1) / 60000) * 60000
    );

    // Default suggestion only; the librarian can choose another date.
    due.value = toManilaInput(
      Date.now() + 7 * 86400000
    );

    due.addEventListener("input", () => {
      due.setCustomValidity("");
    });

    dialog.querySelector("form").addEventListener("submit", event => {
      if (event.submitter?.value !== "confirm") return;

      const millis = parseManilaInput(due.value);

      if (!Number.isFinite(millis) || millis <= Date.now()) {
        event.preventDefault();

        due.setCustomValidity(
          "Choose a future due date and time in Philippine time."
        );

        due.reportValidity();
      }
    });
  }

  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      const answer = dialog.returnValue === "confirm"
        ? {
            reason: dialog.querySelector(
              "#confirmation-reason"
            ).value.trim(),

            dueAt: needsDue
              ? Timestamp.fromMillis(
                  parseManilaInput(due.value)
                )
              : null
          }
        : null;

      dialog.remove();
      resolve(answer);
    }, { once: true });

    dialog.showModal();
  });
}


// =====================================================
// BORROWER PROFILES
// =====================================================

function stopBorrowerProfiles() {
  profileSubscriptions.forEach(stop => stop());
  profileSubscriptions.clear();
  borrowerProfiles.clear();
}

function syncBorrowerProfiles(session) {
  const uids = new Set(
    requests.map(request => request.studentUid).filter(
      uid => typeof uid === "string" && uid && !uid.includes("/")
    )
  );

  for (const [uid, stop] of profileSubscriptions) {
    if (!uids.has(uid)) {
      stop();
      profileSubscriptions.delete(uid);
      borrowerProfiles.delete(uid);
    }
  }

  for (const uid of uids) {
    if (profileSubscriptions.has(uid)) continue;

    borrowerProfiles.set(uid, { state: "loading" });

    const stop = onSnapshot(
      doc(db, "users", uid),
      snapshot => {
        if (session !== version) return;

        borrowerProfiles.set(
          uid,
          snapshot.exists()
            ? { state: "ready", data: snapshot.data() }
            : { state: "missing" }
        );

        renderRequests();
        renderNotifications();
      },
      error => {
        if (session !== version) return;

        borrowerProfiles.set(uid, {
          state: "error",
          code: error.code
        });

        renderRequests();
        renderNotifications();
      }
    );

    profileSubscriptions.set(uid, stop);
  }
}

function borrowerName(uid) {
  const profile = borrowerProfiles.get(uid);

  return profile?.state === "ready" && profile.data.fullName
    ? profile.data.fullName
    : uid || "Unknown borrower";
}

function appendBorrowerDetails(details, uid) {
  const profile = borrowerProfiles.get(uid);

  if (profile?.state === "ready") {
    const data = profile.data;

    details.append(
      node(
        "p",
        "borrower-name",
        `Borrower: ${data.fullName || "Not provided"}`
      ),
      node("p", "", `Student ID: ${data.studentId || "Not provided"}`),
      node("p", "", `Course: ${data.course || "Not provided"}`),
      node("p", "", `Email: ${data.email || "Not provided"}`)
    );
  } else {
    const text = profile?.state === "error"
      ? `Unable to read borrower profile (${profile.code}). Check Firestore Rules.`
      : profile?.state === "missing"
        ? "Student profile not provided. Ask the borrower to complete Settings."
        : "Loading borrower profile...";

    details.append(node("p", "profile-note", text));
  }

  details.append(
    node(
      "p",
      "borrower-uid",
      `Borrower UID: ${uid || "Not recorded"}`
    )
  );
}


// =====================================================
// NOTIFICATION DROPDOWN AND DASHBOARD COUNTS
// =====================================================

function renderNotifications() {
  const pending = requests.filter(
    request => request.status === "pending"
  ).length;

  const overdue = requests.filter(
    request => isOverdue(request)
  ).length;

  $("admin-notification-text").textContent =
    requestsError || (
      !requestsLoaded
        ? "Loading requests..."
        : `${pending} pending requests · ${overdue} overdue books`
    );

  const container = $("admin-notification-list");
  container.replaceChildren();

  if (requestsError || !requestsLoaded) return;

  const recent = [...requests].sort(
    (a, b) =>
      Number(isOverdue(b)) - Number(isOverdue(a)) ||
      eventMillis(b) - eventMillis(a)
  ).slice(0, 5);

  if (!recent.length) {
    container.append(node("p", "", "No borrowing updates yet."));
  }

  const labels = {
    pending: "Pending request",
    approved: "Borrowed",
    returned: "Returned",
    rejected: "Rejected",
    cancelled: "Cancelled by student"
  };

  for (const request of recent) {
    const overdue = isOverdue(request);

    const button = node(
      "button",
      `notification-item${overdue ? " notification-overdue" : ""}`
    );

    button.type = "button";

    const label = overdue
      ? "Overdue"
      : labels[request.status] || request.status;

    button.append(
      node("strong", "", `${label}: ${titleFor(request.bookId)}`),
      node("span", "", borrowerName(request.studentUid)),
      node(
        "span",
        "",
        overdue
          ? `Due: ${dateText(request.dueAt)}`
          : dateText(
              request.cancelledAt ||
              request.returnedAt ||
              request.reviewedAt ||
              request.approvedAt ||
              request.requestedAt
            )
      )
    );

    button.addEventListener("click", () => {
      setView(
        request.status === "pending"
          ? "pending"
          : request.status === "approved"
            ? "approved"
            : "history"
      );
    });

    container.append(button);
  }
}

function refresh() {
  $("pending-count").textContent =
    requestsLoaded && !requestsError
      ? requests.filter(request => request.status === "pending").length
      : "—";

  $("borrowed-count").textContent =
    requestsLoaded && !requestsError
      ? requests.filter(request => request.status === "approved").length
      : "—";

  $("copies-count").textContent =
    booksLoaded && !booksError
      ? [...books.values()].reduce((sum, book) => {
          const copies = book.availableCopies;

          return sum + (
            Number.isInteger(copies) && copies >= 0 ? copies : 0
          );
        }, 0)
      : "—";

  $("overdue-count").textContent =
    requestsLoaded && !requestsError
      ? requests.filter(request => isOverdue(request)).length
      : "—";

  renderNotifications();
  renderRequests();
  renderBooks();
}

function setView(view) {
  if (!pages[view]) return;

  currentView = view;

  $("page-title").textContent = pages[view][0];
  $("page-description").textContent = pages[view][1];
  $("requests-panel").hidden = view === "books";
  $("books-panel").hidden = view !== "books";

  $("book-tools").hidden = view !== "books";
  $("transaction-tools").hidden = view === "books";

  $("admin-search").value = view === "books"
    ? booksQuery
    : transactionsQuery;

  $("admin-search").placeholder = view === "books"
    ? "Search title, author, category or Book ID..."
    : "Search borrower, Student ID, email or book...";

  document.querySelectorAll("[data-view]").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);

    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  closeMenus();
  closeSidebar();
  message("");
  refresh();
}


// =====================================================
// TRANSACTION LIST
// =====================================================

function actionButton(text, className, request, action) {
  const button = node("button", className, text);
  button.type = "button";
  button.disabled = processing.has(request.id);

  button.addEventListener("click", () => {
    processRequest(request, action);
  });

  return button;
}

function renderRequests() {
  if (currentView === "books") return;

  const container = $("request-list");
  container.replaceChildren();

  if (requestsError || !requestsLoaded) {
    $("results-summary").textContent = "";

    container.append(
      node("p", "empty", requestsError || "Loading requests...")
    );

    return;
  }

  const section = requests.filter(request =>
    currentView === "history"
      ? ["returned", "rejected", "cancelled"].includes(request.status)
      : request.status === currentView
  );

  const rows = adminFilterService.transactions(
    section,
    transactionsQuery,
    $("transaction-sort").value,
    borrowerFor,
    titleFor
  );

  $("results-summary").textContent =
    `${rows.length} of ${section.length} transactions`;

  if (!rows.length) {
    const loadingNames = transactionsQuery &&
      [...borrowerProfiles.values()].some(
        item => item.state === "loading"
      );

    container.append(node(
      "p",
      "empty",
      loadingNames
        ? "Loading borrower details..."
        : section.length
          ? "No matching transactions. Try another name, Student ID, or book title."
          : "No records in this section yet."
    ));

    return;
  }

  rows.forEach(request => {
    const overdue = isOverdue(request);

    const card = node(
      "article",
      `record${overdue ? " record-overdue" : ""}`
    );

    const details = node("div", "record-details");
    const actions = node("div", "record-actions");

    details.append(node("h3", "", titleFor(request.bookId)));
    appendBorrowerDetails(details, request.studentUid);

    details.append(
      node(
        "p",
        "request-timestamp",
        `Requested: ${dateText(request.requestedAt)}`
      ),
      node("p", "", `Reference: ${request.id}`)
    );

    if (request.status === "pending") {
      const copies = books.get(request.bookId)?.availableCopies;

      details.append(node(
        "p",
        "",
        `Available copies: ${
          Number.isInteger(copies) ? copies : "Not available"
        }`
      ));

      const approve = actionButton(
        "Approve request",
        "primary",
        request,
        "approve"
      );

      approve.disabled =
        processing.has(request.id) ||
        Boolean(booksError) ||
        !Number.isInteger(copies) ||
        copies <= 0;

      actions.append(
        approve,
        actionButton("Reject", "danger", request, "reject")
      );
    } else if (request.status === "approved") {
      actions.append(node(
        "span",
        overdue ? "badge badge-overdue" : "badge badge-approved",
        overdue ? "Overdue" : "Borrowed"
      ));

      if (overdue) {
        details.append(node(
          "p",
          "overdue-reminder",
          "Past the due date. Follow up with the borrower for return."
        ));
      }

      if (request.approvedAt) {
        details.append(node(
          "p",
          "request-timestamp",
          `Approved: ${dateText(request.approvedAt)}`
        ));
      }

      details.append(node(
        "p",
        "request-timestamp",
        `Due: ${dateText(request.dueAt)}`
      ));

      actions.append(
        actionButton("Mark Returned?", "secondary", request, "return")
      );
    } else {
      if (request.status === "returned") {
        details.append(node(
          "p",
          "request-timestamp",
          `Returned: ${dateText(request.returnedAt)}`
        ));
      }

      if (request.status === "rejected" && request.reviewedAt) {
        details.append(node(
          "p",
          "request-timestamp",
          `Reviewed: ${dateText(request.reviewedAt)}`
        ));
      }

      if (request.status === "cancelled") {
        details.append(
          node(
            "p",
            "request-timestamp",
            `Cancelled: ${dateText(request.cancelledAt)}`
          ),
          node(
            "p",
            "",
            "Cancelled by the student before approval. No copy was issued."
          )
        );
      }

      if (request.reason) {
        details.append(node("p", "", request.reason));
      }

      const statusLabels = {
        returned: "Returned",
        rejected: "Rejected",
        cancelled: "Cancelled"
      };

      actions.append(node(
        "span",
        `badge badge-${request.status}`,
        statusLabels[request.status] || request.status
      ));
    }

    card.append(details, actions);
    container.append(card);
  });
}

async function processRequest(request, action) {
  if (
    !currentUser ||
    processing.has(request.id) ||
    document.querySelector("dialog[open]") ||
    !["approve", "reject", "return"].includes(action)
  ) {
    return;
  }

  const session = version;
  const user = currentUser;

  processing.add(request.id);
  renderRequests();

  const prompts = {
    approve: [
      "Approve this request?",
      "Select the due date and time before issuing one copy.",
      "Yes, approve"
    ],
    reject: [
      "Reject this request?",
      "Enter a reason that the student can read.",
      "Yes, reject"
    ],
    return: [
      "Confirm book return?",
      "Only continue if the book has physically been returned.",
      "Yes, returned"
    ]
  };

  try {
    const answer = await ask(
      ...prompts[action],
      action === "reject",
      action === "reject",
      action === "approve"
    );

    if (
      !answer ||
      session !== version ||
      auth.currentUser?.uid !== user.uid
    ) {
      return;
    }

    if (action === "reject" && !answer.reason) {
      throw new Error("Please enter a rejection reason.");
    }

    message("Processing request...", false, "info");

    if (action === "approve") {
      await adminBorrowingService.approve(
        currentAdminProfile,
        request.id,
        answer.dueAt
      );
    } else if (action === "reject") {
      await adminBorrowingService.reject(
        currentAdminProfile,
        request.id,
        answer.reason
      );
    } else {
      await adminBorrowingService.returnBook(
        currentAdminProfile,
        request.id
      );
    }

    if (session === version) {
      message(
        action === "approve"
          ? `Request approved successfully. Due: ${dateText(answer.dueAt)}.`
          : action === "reject"
            ? "Request rejected successfully. Inventory unchanged."
            : "Book returned successfully. One copy restored."
      );
    }
  } catch (error) {
    if (session === version) {
      message(
        error.code
          ? `Unable to process request (${error.code}). Check your connection and Firestore Rules.`
          : error.message,
        true
      );
    }
  } finally {
    processing.delete(request.id);

    if (session === version) {
      renderRequests();
    }
  }
}


// =====================================================
// MANAGE BOOKS
// =====================================================

function adminCatalogueBooks() {
  return adminCatalogueService.getBooks(
    studentCatalogueDefaults,
    books
  );
}

function renderBooks() {
  if (currentView !== "books") return;

  const container = $("book-list");
  container.replaceChildren();
  container.classList.add("admin-book-grid");

  if (booksError || !booksLoaded) {
    $("results-summary").textContent = "";

    container.append(node(
      "p",
      "empty admin-catalogue-empty",
      booksError || "Loading books..."
    ));

    return;
  }

  const allBooks = adminCatalogueBooks();
  const selected = $("book-category-filter").value;
  const options = new Map();

  allBooks.forEach(book => {
    const key = AdminFilterService.normalize(book.category);

    if (!options.has(key)) {
      options.set(key, book.category);
    }
  });

  const select = $("book-category-filter");
  select.replaceChildren();

  const allOption = node("option", "", "All categories");
  allOption.value = "all";
  select.append(allOption);

  [...options]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([value, label]) => {
      const option = node("option", "", label);
      option.value = value;
      select.append(option);
    });

  select.value =
    selected === "all" || options.has(selected)
      ? selected
      : "all";

  $("category-suggestions").replaceChildren();

  options.forEach(label => {
    const option = node("option");
    option.value = label;
    $("category-suggestions").append(option);
  });

  const visibleBooks = adminFilterService.books(
    allBooks,
    booksQuery,
    select.value,
    $("book-sort").value
  );

  $("results-summary").textContent =
    `${visibleBooks.length} of ${allBooks.length} catalogue books`;

  if (!visibleBooks.length) {
    container.append(node(
      "p",
      "empty admin-catalogue-empty",
      "No books match your search or category."
    ));
  }

  for (const book of visibleBooks) {
    const card = node("article", "admin-book-card");
    const cover = node("div", "admin-book-cover");

    cover.style.backgroundColor = book.color;
    cover.style.color = book.ink;

    cover.append(
      node("span", "admin-cover-author", book.author),
      node("span", "admin-cover-title", book.title),
      node("span", "admin-cover-category", book.category)
    );

    const copies = book.availableCopies;
    const validCopies = Number.isInteger(copies) && copies >= 0;

    const state = !book.registered
      ? "Not registered"
      : !validCopies
        ? "Check inventory"
        : copies > 0
          ? "Available"
          : "Unavailable";

    const badge = node("span", "admin-book-badge", state);

    badge.classList.add(
      !book.registered || !validCopies
        ? "needs-setup"
        : copies > 0
          ? "available"
          : "unavailable"
    );

    const details = node("div", "admin-book-details");

    details.append(
      recordHeading(book),
      node("p", "", book.author),
      node("p", "", `Category: ${book.category}`),
      node("p", "", `Book ID: ${book.id}`),
      badge
    );

    if (book.registered) {
      const edit = node("button", "admin-edit-book");
      edit.type = "button";

      edit.append(
        createIcon("edit"),
        node("span", "", "Edit book / Add copies")
      );

      edit.addEventListener("click", () => showBookEditor(book));

      details.append(edit);

      details.append(node(
        "p",
        "admin-book-stock",
        validCopies
          ? `${copies} available ${copies === 1 ? "copy" : "copies"}`
          : "Available copies need correcting in the inventory."
      ));
    } else {
      details.append(node(
        "p",
        "admin-book-stock",
        "Shown in the student catalogue. Add inventory before borrowing."
      ));

      const button = node(
        "button",
        "primary admin-register-book",
        "Register book"
      );

      button.type = "button";

      button.addEventListener("click", () => {
        if ($("save-book").disabled) return;

        $("book-id").value = book.id;
        $("book-title").value = book.title;
        $("book-author").value = book.author;
        $("book-category").value = book.category;
        $("book-copies").value = "";

        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;

        $("book-form").scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "center"
        });

        $("book-copies").focus({ preventScroll: true });

        message(
          "Enter the actual available copies, then click Add Book.",
          false,
          "info"
        );
      });

      details.append(button);
    }

    card.append(cover, details);
    container.append(card);
  }
}


// =====================================================
// EDIT BOOK AND ADDITIONAL COPIES
// =====================================================

function showBookEditor(book) {
  if (
    !currentAdminProfile ||
    document.querySelector("dialog[open]")
  ) {
    return;
  }

  const profile = currentAdminProfile;
  const dialog = node("dialog", "ui-dialog book-editor-dialog");
  const title = node("h2", "", "Edit book / Add copies");

  title.id = "book-editor-title";
  dialog.setAttribute("aria-labelledby", title.id);

  const form = node("form", "book-editor-form");

  const definitions = [
    ["edit-book-id", "Book ID", book.id, 100, true],
    ["edit-book-title", "Title", book.title, 200, false],
    ["edit-book-author", "Author", book.author, 150, false],
    ["edit-book-category", "Category", book.category, 100, false]
  ];

  definitions.forEach(
    ([id, labelText, value, max, readOnly]) => {
      const label = node("label", "", labelText);
      const input = node("input");

      input.id = id;
      input.value = value;
      input.maxLength = max;
      input.required = true;
      input.readOnly = readOnly;

      if (id === "edit-book-category") {
        input.setAttribute("list", "category-suggestions");
      }

      label.append(input);
      form.append(label);
    }
  );

  form.append(node(
    "p",
    "hint",
    `Available copies when opened: ${book.availableCopies}. Add copies below; existing loans stay unchanged.`
  ));

  const copiesLabel = node(
    "label",
    "",
    "Additional copies (0 if unchanged)"
  );

  const copies = node("input");
  copies.id = "edit-book-add-copies";
  copies.type = "number";
  copies.min = "0";
  copies.max = "100000";
  copies.step = "1";
  copies.value = "0";
  copies.required = true;

  copiesLabel.append(copies);
  form.append(copiesLabel);

  const actions = node("div", "dialog-actions");
  const cancel = node("button", "ui-neutral", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());

  const save = node("button", "ui-success", "Save changes");
  save.type = "submit";

  actions.append(cancel, save);
  form.append(actions);

  let saving = false;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (saving || !form.reportValidity()) return;

    const session = version;

    const values = {
      title: $("edit-book-title").value.trim(),
      author: $("edit-book-author").value.trim(),
      category: $("edit-book-category").value.trim(),
      addCopies: Number(copies.value)
    };

    if (copies.value.trim() === "") return;

    saving = true;
    save.disabled = true;
    save.textContent = "Saving...";

    form.querySelectorAll("input").forEach(input => {
      input.readOnly = true;
    });

    try {
      await adminCatalogueService.updateBook(
        profile,
        book.id,
        values
      );

      if (session !== version) return;

      dialog.close();

      message(
        values.addCopies
          ? `Book updated successfully. ${values.addCopies} copies added.`
          : "Book updated successfully."
      );
    } catch (error) {
      if (session === version) {
        message(
          error.code
            ? `Unable to update book (${error.code}). Check your connection and Rules.`
            : error.message,
          true
        );
      }
    } finally {
      saving = false;
      save.disabled = false;
      save.textContent = "Save changes";

      form.querySelectorAll("input").forEach(input => {
        input.readOnly = input.id === "edit-book-id";
      });
    }
  });

  dialog.append(title, form);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });

  document.body.append(dialog);
  dialog.showModal();
  $("edit-book-title").focus();
}


// =====================================================
// ADD BOOK
// =====================================================

$("book-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser || $("save-book").disabled) return;
  if (!$("book-form").reportValidity()) return;

  const id = $("book-id").value.trim();
  const title = $("book-title").value.trim();
  const author = $("book-author").value.trim();
  const category = $("book-category").value.trim();
  const copiesText = $("book-copies").value.trim();
  const copies = Number(copiesText);

  if (
    !/^[a-zA-Z0-9-]+$/.test(id) ||
    !title ||
    !author ||
    !category ||
    copiesText === "" ||
    !Number.isSafeInteger(copies) ||
    copies < 0 ||
    copies > 100000
  ) {
    message("Complete all fields with valid values.", true);
    return;
  }

  const session = version;

  $("save-book").disabled = true;
  $("save-book").textContent = "Saving...";
  message("Saving book...", false, "info");

  try {
    await adminCatalogueService.addBook(
      currentAdminProfile,
      {
        id,
        title,
        author,
        category,
        availableCopies: copies
      },
      [...books.values()].map(book => book.color).filter(Boolean)
    );

    if (session === version) {
      $("book-form").reset();
      message("Book added successfully.");
    }
  } catch (error) {
    if (session === version) {
      message(
        error.code
          ? `Unable to add book (${error.code}).`
          : error.message,
        true
      );
    }
  } finally {
    $("save-book").disabled = false;
    $("save-book").textContent = "Add Book";
  }
});


// =====================================================
// SEARCH, SORT, AND NAVIGATION EVENTS
// =====================================================

$("admin-search").addEventListener("input", () => {
  if (currentView === "books") {
    booksQuery = $("admin-search").value;
    renderBooks();
  } else {
    transactionsQuery = $("admin-search").value;
    renderRequests();
  }
});

$("book-category-filter").addEventListener("change", renderBooks);
$("book-sort").addEventListener("change", renderBooks);
$("transaction-sort").addEventListener("change", renderRequests);

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    setView(button.dataset.view);
  });
});

document.querySelectorAll("[data-dropdown]").forEach(button => {
  button.addEventListener("click", () => {
    const panel = $(button.dataset.dropdown);
    if (!panel) return;

    const open = panel.hidden;
    closeMenus();
    panel.hidden = !open;

    button.setAttribute("aria-expanded", String(open));
  });
});

document.addEventListener("click", event => {
  if (!event.target.closest(".action-wrap")) {
    closeMenus();
  }

  if (event.target.closest("[data-profile-details]")) {
    showProfile();
  }

  if (event.target.closest("[data-profile-edit]")) {
    showProfile(true);
  }
});

document.querySelectorAll("[data-logout]").forEach(button => {
  button.addEventListener("click", async () => {
    if (!currentUser || loggingOut) return;

    loggingOut = true;
    const session = version;

    try {
      const answer = await ask(
        "Log out of BookBase?",
        "You can sign in again whenever you need your library.",
        "Yes, log out",
        true
      );

      if (!answer || session !== version) return;

      await signOut(auth);
      window.location.replace("../login.html");
    } catch {
      message(
        "Unable to log out. Check your connection and try again.",
        true
      );
    } finally {
      loggingOut = false;
    }
  });
});

$("menu-button").addEventListener("click", () => {
  const open = !$("sidebar").classList.contains("open");
  $("sidebar").classList.toggle("open", open);
  $("shade").hidden = !open;
  $("menu-button").setAttribute("aria-expanded", String(open));
});

$("shade").addEventListener("click", closeSidebar);

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;

  const trigger = document.querySelector(
    '[data-dropdown][aria-expanded="true"]'
  );

  closeMenus();
  trigger?.focus();

  if ($("sidebar").classList.contains("open")) {
    closeSidebar();
    $("menu-button").focus();
  }
});


// =====================================================
// AUTHENTICATION AND LIVE FIRESTORE DATA
// =====================================================

onAuthStateChanged(auth, async user => {
  const session = ++version;

  stopBooks?.();
  stopRequests?.();
  stopBorrowerProfiles();

  overdueSignature = "";

  document.querySelectorAll("dialog[open]").forEach(
    dialog => dialog.close()
  );

  currentUser = null;
  currentAdminProfile = null;
  booksQuery = "";
  transactionsQuery = "";
  $("admin-search").value = "";

  books = new Map();
  requests = [];
  processing.clear();

  booksLoaded = false;
  requestsLoaded = false;
  booksError = "";
  requestsError = "";

  message("");

  $("app").hidden = true;
  $("loading").hidden = true;
  $("loading").textContent = "";

  if (!user || !user.emailVerified) {
    window.location.replace("../login.html");
    return;
  }

  try {
    const role = await getDoc(
      doc(db, "roles", user.uid)
    );

    if (
      session !== version ||
      auth.currentUser?.uid !== user.uid
    ) {
      return;
    }

    const value = role.exists()
      ? role.data().role
      : "student";

    if (value === "student") {
      window.location.replace("../student.html");
      return;
    }

    if (value !== "admin") {
      throw new Error(
        "Invalid account role. Contact the librarian."
      );
    }

    currentUser = user;
    currentAdminProfile = new AdminProfile(user);

    fillProfile(user);

    $("loading").hidden = true;
    $("app").hidden = false;

    setView("pending");

    stopBooks = onSnapshot(
      collection(db, "books"),
      snapshot => {
        if (session !== version) return;

        booksLoaded = true;
        booksError = "";

        books = new Map(
          snapshot.docs.map(item => [item.id, item.data()])
        );

        refresh();
      },
      error => {
        if (session !== version) return;

        booksError =
          `Unable to load inventory (${error.code}).`;

        refresh();
      }
    );

    stopRequests = onSnapshot(
      collection(db, "borrowRequests"),
      snapshot => {
        if (session !== version) return;

        requestsLoaded = true;
        requestsError = "";

        requests = snapshot.docs.map(item => ({
          ...item.data(),
          id: item.id
        }));

        requests.sort(
          (a, b) =>
            (b.requestedAt?.toMillis?.() || 0) -
            (a.requestedAt?.toMillis?.() || 0)
        );

        syncBorrowerProfiles(session);
        refresh();
      },
      error => {
        if (session !== version) return;

        requestsError =
          `Unable to load requests (${error.code}). Check Firestore Rules.`;

        refresh();
      }
    );
  } catch (error) {
    if (session !== version) return;

    $("loading").hidden = false;

    $("loading").textContent = error.code
      ? `Unable to verify admin (${error.code}). Check your connection and Firestore Rules.`
      : error.message;
  }
});


// =====================================================
// PHILIPPINE CLOCK AND OVERDUE REFRESH
// =====================================================

const clockDateFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Manila"
});

const clockTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "Asia/Manila"
});

let clockTimer = null;

function updateDashboardClock() {
  const target = $("dashboard-clock");
  const date = $("clock-date");
  const time = $("clock-time");

  if (!target || !date || !time) return;

  const now = new Date();

  target.dateTime = now.toISOString();
  date.textContent = clockDateFormatter.format(now);
  time.textContent = `${clockTimeFormatter.format(now)} PHT`;

  const signature = requests
    .filter(request => request.status === "approved")
    .map(request =>
      `${request.id}:${isOverdue(request, now.getTime())}`
    )
    .sort()
    .join("|");

  if (signature !== overdueSignature) {
    overdueSignature = signature;

    if (currentUser) {
      $("overdue-count").textContent =
        requestsLoaded && !requestsError
          ? requests.filter(
              request => isOverdue(request, now.getTime())
            ).length
          : "—";

      if (currentView === "approved") {
        renderRequests();
      }

      renderNotifications();
    }
  }
}

function startDashboardClock() {
  clearInterval(clockTimer);
  updateDashboardClock();
  clockTimer = setInterval(updateDashboardClock, 1000);
}

startDashboardClock();

window.addEventListener("pagehide", () => {
  clearInterval(clockTimer);
});

window.addEventListener("pageshow", startDashboardClock);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    updateDashboardClock();
  }
});