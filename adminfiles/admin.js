import { initializeApp } from
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
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

// Firebase
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
const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentView = "pending";
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

const processing = new Set();

// Display books from the student catalogue.
// Actual inventory comes from Firestore.
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
    "Review returned books and declined requests."
  ],
  books: [
    "Manage books",
    "View the student catalogue and manage book inventory."
  ]
};

// General helpers
function node(tag, className = "", text) {
  const item = document.createElement(tag);
  item.className = className;

  if (text !== undefined) {
    item.textContent = text;
  }

  return item;
}

// Firestore timestamp → Philippine date AND time
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
    studentCatalogueDefaults.find((book) => book.id === id)?.title ||
    id;
}

function closeMenus() {
  document.querySelectorAll("[data-dropdown]").forEach((button) => {
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

// Green success / red error / blue information
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

  toast.addEventListener("pointerenter", () => {
    clearTimeout(toastTimer);
  });

  toast.addEventListener("focusin", () => {
    clearTimeout(toastTimer);
  });

  toast.addEventListener("pointerleave", scheduleDismiss);
  toast.addEventListener("focusout", scheduleDismiss);

  scheduleDismiss();
}

// Profile
function fillAvatar(target, user) {
  if (!target) return;

  const name = user.displayName || user.email || "Admin";

  target.textContent = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
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
    // Keep initials if no valid photo is available.
  }
}

function fillProfile(user) {
  $("admin-name").textContent =
    user.displayName || user.email || "Admin";

  $("profile-name").textContent = user.displayName || "Admin";
  $("profile-email").textContent = user.email || "No email provided";

  $("profile-role").textContent =
    "Admin / Librarian · Email verified";

  fillAvatar($("avatar"), user);
  fillAvatar($("profile-avatar"), user);
}

function showProfile() {
  if (!currentUser) return;

  closeMenus();

  const dialog = node("dialog", "ui-dialog");
  const heading = node("h2", "", "Profile details");

  heading.id = "profile-dialog-title";
  dialog.setAttribute("aria-labelledby", heading.id);

  const details = node("dl", "profile-fields");

  const fields = [
    ["Full name", currentUser.displayName || "Not provided"],
    ["Email address", currentUser.email || "Not provided"],
    ["Role", "Admin / Librarian"],
    ["Email status", currentUser.emailVerified ? "Verified" : "Not verified"],
    ["User ID", currentUser.uid]
  ];

  fields.forEach(([label, value]) => {
    details.append(node("dt", "", label), node("dd", "", value));
  });

  const form = node("form");
  form.method = "dialog";

  const actions = node("div", "dialog-actions");
  const close = node("button", "ui-neutral", "Close");
  close.autofocus = true;

  actions.append(close);
  form.append(actions);
  dialog.append(heading, details, form);

  dialog.addEventListener(
    "close",
    () => dialog.remove(),
    { once: true }
  );

  document.body.append(dialog);
  dialog.showModal();
}

// Confirmation
function ask(
  title,
  description,
  yesLabel,
  danger = false,
  needsReason = false
) {
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

  $("confirmation-yes").className =
    danger ? "ui-danger" : "ui-success";

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      const answer = dialog.returnValue === "confirm"
        ? { reason: $("confirmation-reason").value.trim() }
        : null;

      dialog.remove();
      resolve(answer);
    }, { once: true });

    dialog.showModal();
  });
}

// Dashboard
function refresh() {
  const pending = requests.filter(
    (request) => request.status === "pending"
  ).length;

  $("pending-count").textContent =
    requestsLoaded && !requestsError ? pending : "—";

  $("borrowed-count").textContent =
    requestsLoaded && !requestsError
      ? requests.filter((request) => request.status === "approved").length
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

  $("admin-notification-text").textContent =
    requestsError || (
      !requestsLoaded
        ? "Loading requests..."
        : `${pending} pending borrow requests. Open Borrow Requests to review.`
    );

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

  document.querySelectorAll("[data-view]").forEach((button) => {
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

function actionButton(text, className, request, action) {
  const button = node("button", className, text);
  button.type = "button";
  button.disabled = processing.has(request.id);

  button.addEventListener("click", () => {
    processRequest(request, action);
  });

  return button;
}

// Requests, loans, and history
function renderRequests() {
  const container = $("request-list");
  container.replaceChildren();

  if (requestsError || !requestsLoaded) {
    container.append(node(
      "p",
      "empty",
      requestsError || "Loading requests..."
    ));
    return;
  }

  const rows = requests.filter((request) =>
    currentView === "history"
      ? ["returned", "rejected"].includes(request.status)
      : request.status === currentView
  );

  if (!rows.length) {
    container.append(node(
      "p",
      "empty",
      "No records in this section yet."
    ));
    return;
  }

  rows.forEach((request) => {
    const card = node("article", "record");
    const details = node("div", "record-details");
    const actions = node("div", "record-actions");

    details.append(
      node("h3", "", titleFor(request.bookId)),
      node("p", "", `Borrower UID: ${request.studentUid}`),
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
        "Approve · 7 days",
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

      actions.append(actionButton(
        "Mark Returned",
        "secondary",
        request,
        "return"
      ));
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

      if (request.reason) {
        details.append(node("p", "", request.reason));
      }

      actions.append(node("span", "badge", request.status));
    }

    card.append(details, actions);
    container.append(card);
  });
}

async function processRequest(request, action) {
  if (!currentUser || processing.has(request.id)) return;

  const session = version;
  const user = currentUser;

  processing.add(request.id);
  renderRequests();

  const prompts = {
    approve: [
      "Approve this request?",
      "Issue one copy with a 7-day due date?",
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
      action === "reject"
    );

    if (!answer || session !== version) return;

    if (action === "reject" && !answer.reason) {
      throw new Error("Please enter a rejection reason.");
    }

    message("Processing request...", false, "info");

    await runTransaction(db, async (transaction) => {
      const requestRef = doc(db, "borrowRequests", request.id);
      const snapshot = await transaction.get(requestRef);

      if (!snapshot.exists()) {
        throw new Error("This request no longer exists.");
      }

      const data = snapshot.data();
      const expectedStatus =
        action === "return" ? "approved" : "pending";

      if (data.status !== expectedStatus) {
        throw new Error("This request has already been processed.");
      }

      const bookRef = doc(db, "books", data.bookId);
      const lockRef = doc(
        db,
        "borrowLocks",
        `${data.studentUid}_${data.bookId}`
      );

      const bookSnapshot = await transaction.get(bookRef);
      const lock = await transaction.get(lockRef);

      if (
        !lock.exists() ||
        lock.data().requestId !== request.id
      ) {
        throw new Error(
          "The active borrowing record is inconsistent. Review it first."
        );
      }

      if (action === "reject") {
        transaction.update(requestRef, {
          status: "rejected",
          reason: answer.reason,
          reviewedAt: serverTimestamp(),
          reviewedBy: user.uid
        });

        transaction.delete(lockRef);
        return;
      }

      const copies = bookSnapshot.data()?.availableCopies;

      if (
        !bookSnapshot.exists() ||
        !Number.isSafeInteger(copies) ||
        copies < 0
      ) {
        throw new Error("Book inventory needs correcting.");
      }

      if (action === "approve") {
        if (copies <= 0) {
          throw new Error(
            "No copies available. The request was not approved."
          );
        }

        transaction.update(bookRef, {
          availableCopies: copies - 1
        });

        transaction.update(requestRef, {
          status: "approved",
          approvedAt: serverTimestamp(),
          approvedBy: user.uid,
          dueAt: Timestamp.fromMillis(
            Date.now() + 7 * 86400000
          )
        });
      } else {
        transaction.update(bookRef, {
          availableCopies: copies + 1
        });

        transaction.update(requestRef, {
          status: "returned",
          returnedAt: serverTimestamp(),
          returnedBy: user.uid
        });

        transaction.delete(lockRef);
      }
    });

    if (session === version) {
      message(
        action === "approve"
          ? "Request approved successfully. One copy issued for 7 days."
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

// Full catalogue
function adminCatalogueBooks() {
  const merged = new Map(
    studentCatalogueDefaults.map((book) => [
      book.id,
      { ...book, registered: false }
    ])
  );

  books.forEach((data, id) => {
    const previous = merged.get(id);

    merged.set(id, {
      color: "#738baa",
      ink: "#ffffff",
      ...previous,
      ...data,
      id,
      registered: true,
      title: data.title || previous?.title || id,
      author: data.author || previous?.author || "Unknown author",
      category: data.category || previous?.category || "General"
    });
  });

  return [...merged.values()].sort((a, b) =>
    a.title.localeCompare(b.title)
  );
}

function renderBooks() {
  const container = $("book-list");
  container.replaceChildren();
  container.classList.add("admin-book-grid");

  if (booksError || !booksLoaded) {
    container.append(node(
      "p",
      "empty admin-catalogue-empty",
      booksError || "Loading books..."
    ));
    return;
  }

  for (const book of adminCatalogueBooks()) {
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
      node("h3", "", book.title),
      node("p", "", book.author),
      node("p", "", `Category: ${book.category}`),
      node("p", "", `Book ID: ${book.id}`),
      badge
    );

    if (book.registered) {
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

// Add Book
$("book-form").addEventListener("submit", async (event) => {
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
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, "books", id);
      const existing = await transaction.get(ref);

      if (existing.exists()) {
        throw new Error(
          "Book ID already exists. Use a different ID."
        );
      }

      transaction.set(ref, {
        title,
        author,
        category,
        availableCopies: copies,
        createdAt: serverTimestamp()
      });
    });

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

// Navigation
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    setView(button.dataset.view);
  });
});

document.querySelectorAll("[data-dropdown]").forEach((button) => {
  button.addEventListener("click", () => {
    const panel = $(button.dataset.dropdown);
    if (!panel) return;

    const open = panel.hidden;

    closeMenus();
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".action-wrap")) {
    closeMenus();
  }

  if (event.target.closest("[data-profile-details]")) {
    showProfile();
  }
});

// Logout
document.querySelectorAll("[data-logout]").forEach((button) => {
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

// Mobile navigation
$("menu-button").addEventListener("click", () => {
  const open = !$("sidebar").classList.contains("open");

  $("sidebar").classList.toggle("open", open);
  $("shade").hidden = !open;
  $("menu-button").setAttribute("aria-expanded", String(open));
});

$("shade").addEventListener("click", closeSidebar);

document.addEventListener("keydown", (event) => {
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

// Authentication and live data
onAuthStateChanged(auth, async (user) => {
  const session = ++version;

  stopBooks?.();
  stopRequests?.();

  currentUser = null;
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
    const role = await getDoc(doc(db, "roles", user.uid));

    if (
      session !== version ||
      auth.currentUser?.uid !== user.uid
    ) {
      return;
    }

    const value = role.exists() ? role.data().role : "student";

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
    fillProfile(user);

    $("loading").hidden = true;
    $("app").hidden = false;

    setView("pending");

    stopBooks = onSnapshot(
      collection(db, "books"),
      (snapshot) => {
        if (session !== version) return;

        booksLoaded = true;
        booksError = "";

        books = new Map(
          snapshot.docs.map((item) => [item.id, item.data()])
        );

        refresh();
      },
      (error) => {
        if (session !== version) return;

        booksError = `Unable to load inventory (${error.code}).`;
        refresh();
      }
    );

    stopRequests = onSnapshot(
      collection(db, "borrowRequests"),
      (snapshot) => {
        if (session !== version) return;

        requestsLoaded = true;
        requestsError = "";

        requests = snapshot.docs.map((item) => ({
          ...item.data(),
          id: item.id
        }));

        requests.sort(
          (a, b) =>
            (b.requestedAt?.toMillis?.() || 0) -
            (a.requestedAt?.toMillis?.() || 0)
        );

        refresh();
      },
      (error) => {
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

// Live Philippine clock
// Updates the display only; it does not reload Firestore data.

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