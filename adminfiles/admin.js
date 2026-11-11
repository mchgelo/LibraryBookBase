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

const processing = new Set();

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
    "Add books and check available inventory."
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

function message(text, error = false) {
  $("status").textContent = text;
  $("status").style.color = error ? "#b42318" : "#166534";
}

function dateText(value) {
  if (!value?.toDate) return "Not set";

  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeZone: "Asia/Manila"
  }).format(value.toDate());
}

function titleFor(id) {
  return books.get(id)?.title || id;
}

function closeMenus() {
  document.querySelectorAll("[data-dropdown]").forEach((button) => {
    $(button.dataset.dropdown).hidden = true;
    button.setAttribute("aria-expanded", "false");
  });
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("shade").hidden = true;
  $("menu-button").setAttribute("aria-expanded", "false");
}

// Profile

function fillAvatar(target, user) {
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

    image.addEventListener("error", () => {
      image.remove();
    });

    target.append(image);
  } catch {
    // Keep initials if no valid profile photo is available.
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
  dialog.setAttribute("aria-labelledby", "profile-dialog-title");

  const heading = node("h2", "", "Profile details");
  heading.id = "profile-dialog-title";

  const details = node("dl", "profile-fields");

  const fields = [
    ["Full name", currentUser.displayName || "Not provided"],
    ["Email address", currentUser.email || "Not provided"],
    ["Role", "Admin / Librarian"],
    [
      "Email status",
      currentUser.emailVerified ? "Verified" : "Not verified"
    ],
    ["User ID", currentUser.uid]
  ];

  fields.forEach(([label, value]) => {
    details.append(
      node("dt", "", label),
      node("dd", "", value)
    );
  });

  const form = node("form");
  form.method = "dialog";

  const actions = node("div", "dialog-actions");
  const closeButton = node("button", "ui-neutral", "Close");
  closeButton.autofocus = true;

  actions.append(closeButton);
  form.append(actions);
  dialog.append(heading, details, form);

  dialog.addEventListener("close", () => {
    dialog.remove();
  }, { once: true });

  document.body.append(dialog);
  dialog.showModal();
}

// Reusable Yes / No confirmation

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
        >
          No, cancel
        </button>

        <button
          value="confirm"
          id="confirmation-yes"
        ></button>
      </div>
    </form>
  `;

  dialog.setAttribute("aria-labelledby", "confirmation-title");
  dialog.setAttribute(
    "aria-describedby",
    "confirmation-description"
  );

  document.body.append(dialog);

  $("confirmation-title").textContent = title;
  $("confirmation-description").textContent = description;
  $("reason-label").hidden = !needsReason;
  $("confirmation-reason").required = needsReason;
  $("confirmation-yes").textContent = yesLabel;

  $("confirmation-yes").className = danger
    ? "ui-danger"
    : "ui-success";

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      const result = dialog.returnValue === "confirm"
        ? {
            reason: $("confirmation-reason").value.trim()
          }
        : null;

      dialog.remove();
      resolve(result);
    }, { once: true });

    dialog.showModal();
  });
}

// Dashboard and navigation

function refresh() {
  const pending = requests.filter(
    (item) => item.status === "pending"
  ).length;

  $("pending-count").textContent =
    requestsLoaded && !requestsError ? pending : "—";

  $("borrowed-count").textContent =
    requestsLoaded && !requestsError
      ? requests.filter((item) => item.status === "approved").length
      : "—";

  $("copies-count").textContent =
    booksLoaded && !booksError
      ? [...books.values()].reduce((sum, book) => {
          const copies = book.availableCopies;

          return sum + (
            Number.isInteger(copies) && copies >= 0
              ? copies
              : 0
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

// Borrowing records

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
      node("p", "", `Requested: ${dateText(request.requestedAt)}`),
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
      details.append(node(
        "p",
        "",
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
          "",
          `Returned: ${dateText(request.returnedAt)}`
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

    message("Processing request...");

    await runTransaction(db, async (transaction) => {
      const requestRef = doc(db, "borrowRequests", request.id);
      const snapshot = await transaction.get(requestRef);

      if (!snapshot.exists()) {
        throw new Error("This request no longer exists.");
      }

      const data = snapshot.data();
      const expected = action === "return" ? "approved" : "pending";

      if (data.status !== expected) {
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
          ? "Approved. One copy issued for 7 days."
          : action === "reject"
            ? "Request rejected. Inventory unchanged."
            : "Return recorded. One copy restored."
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

// Book catalogue

function renderBooks() {
  const container = $("book-list");
  container.replaceChildren();

  if (booksError || !booksLoaded) {
    container.append(node(
      "p",
      "empty",
      booksError || "Loading books..."
    ));

    return;
  }

  if (!books.size) {
    container.append(node(
      "p",
      "empty",
      "No books yet. Add your first book above."
    ));

    return;
  }

  [...books.entries()]
    .sort((a, b) =>
      String(a[1].title || a[0]).localeCompare(
        String(b[1].title || b[0])
      )
    )
    .forEach(([id, book]) => {
      const card = node("article", "record");
      const details = node("div", "record-details");

      details.append(
        node("h3", "", book.title || id),
        node(
          "p",
          "",
          `${book.author || "Unknown author"} · ${
            book.category || "General"
          }`
        ),
        node("p", "", `Book ID: ${id}`)
      );

      card.append(
        details,
        node(
          "span",
          "badge",
          Number.isInteger(book.availableCopies)
            ? `${book.availableCopies} available`
            : "Inventory needs updating"
        )
      );

      container.append(card);
    });
}

$("book-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || $("save-book").disabled) return;

  const id = $("book-id").value.trim();
  const title = $("book-title").value.trim();
  const author = $("book-author").value.trim();
  const category = $("book-category").value.trim();
  const copies = Number($("book-copies").value);

  if (
    !/^[a-zA-Z0-9-]+$/.test(id) ||
    !title ||
    !author ||
    !category ||
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
      message("Book added to the library catalogue.");
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

// Menu events

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    setView(button.dataset.view);
  });
});

document.querySelectorAll("[data-dropdown]").forEach((button) => {
  button.addEventListener("click", () => {
    const panel = $(button.dataset.dropdown);
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

// Logout confirmation

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

// Mobile sidebar

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

// Authentication and live records

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

  $("app").hidden = true;
  $("loading").hidden = false;
  $("loading").textContent = "Checking admin account...";

  if (!user || !user.emailVerified) {
    window.location.replace("./login.html");
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

    const value = role.exists()
      ? role.data().role
      : "student";

    if (value === "student") {
      window.location.replace("./student.html");
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

    $("loading").textContent = error.code
      ? `Unable to verify admin (${error.code}). Check your connection and Firestore Rules.`
      : error.message;
  }
});