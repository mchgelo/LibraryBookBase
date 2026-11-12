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
  query,
  where,
  onSnapshot,
  runTransaction,
  serverTimestamp
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

// Display books. Available copies come from Firestore.
const sampleBooks = [
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

const views = {
  discover: [
    "Book catalogue",
    "Check availability and request a book from your library.",
    "Browse books"
  ],
  category: [
    "Explore categories",
    "Find books that match your interests.",
    "Browse by category"
  ],
  library: [
    "My borrowed books",
    "Track pending requests and approved loans.",
    "Current borrowing"
  ],
  history: [
    "Borrowing history",
    "Review returned books and declined requests.",
    "Past transactions"
  ],
  favourite: [
    "Your favourites",
    "Books you saved for later.",
    "Saved books"
  ],
  settings: [
    "Account settings",
    "Your student account information.",
    "Profile details"
  ],
  support: [
    "Library support",
    "Get help with your account and borrowing.",
    "Contact the librarian"
  ]
};

// State
let currentUser = null;
let currentView = "discover";
let selectedCategory = "All";

let favourites = new Set();
let storageKey = "";
let liveBooks = new Map();
let requests = [];

let catalogueReady = false;
let requestsReady = false;
let catalogueError = "";
let requestsError = "";

let stopBooks = null;
let stopRequests = null;
let sessionVersion = 0;

let toastTimer = null;
let activeDialog = null;
let loggingOut = false;

const sending = new Set();

// Helpers
function element(tag, className = "", text) {
  const item = document.createElement(tag);
  item.className = className;

  if (text !== undefined) {
    item.textContent = text;
  }

  return item;
}

function createIcon(name) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  const use = document.createElementNS(namespace, "use");

  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");

  use.setAttribute("href", `#i-${name}`);
  svg.append(use);

  return svg;
}

function catalogueBooks() {
  const result = new Map(
    sampleBooks.map((book) => [book.id, { ...book }])
  );

  liveBooks.forEach((data, id) => {
    const previous = result.get(id);

    result.set(id, {
      color: "#738baa",
      ink: "#ffffff",
      ...previous,
      ...data,
      id,
      title: data.title || previous?.title || id,
      author: data.author || previous?.author || "Unknown author",
      category: data.category || previous?.category || "General"
    });
  });

  return [...result.values()];
}

function bookTitle(id) {
  return catalogueBooks().find((book) => book.id === id)?.title || id;
}

// Actual Firestore timestamp, displayed in Philippine time.
function formatDate(value, includeTime = true) {
  if (!value?.toDate) return "Awaiting server timestamp";

  const options = {
    dateStyle: "medium",
    timeZone: "Asia/Manila"
  };

  if (includeTime) {
    options.timeStyle = "medium";
    options.hour12 = true;
  }

  return new Intl.DateTimeFormat("en-PH", options)
    .format(value.toDate()) + (includeTime ? " PHT" : "");
}

function closeDropdowns() {
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

// Toast notifications
function studentMessage(text, error = false, kind = "success") {
  clearTimeout(toastTimer);
  $("student-toast")?.remove();
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

  const toast = element("div", `student-toast ${type}`);
  toast.id = "student-toast";

  const icon = element(
    "span",
    "student-toast-icon",
    symbols[type]
  );

  icon.setAttribute("aria-hidden", "true");

  const content = element("div", "student-toast-content");
  content.setAttribute("role", error ? "alert" : "status");
  content.setAttribute("aria-atomic", "true");

  content.append(
    element("strong", "", labels[type]),
    element("p", "", text)
  );

  const close = element(
    "button",
    "student-toast-close",
    "×"
  );

  close.type = "button";
  close.setAttribute("aria-label", "Dismiss notification");

  close.addEventListener("click", () => {
    clearTimeout(toastTimer);
    toast.remove();
  });

  toast.append(icon, content, close);
  document.body.append(toast);

  function dismissLater() {
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

  toast.addEventListener("pointerleave", dismissLater);
  toast.addEventListener("focusout", dismissLater);

  dismissLater();
}

// Confirmation dialog
function confirmAction(
  title,
  description,
  yesLabel,
  book = null,
  danger = false
) {
  if (activeDialog?.open) {
    return Promise.resolve(false);
  }

  closeDropdowns();

  const dialog = element("dialog", "student-dialog");
  activeDialog = dialog;

  dialog.setAttribute(
    "aria-labelledby",
    "student-confirm-title"
  );

  dialog.setAttribute(
    "aria-describedby",
    "student-confirm-description"
  );

  const form = element("form");
  form.method = "dialog";

  const heading = element("h2", "", title);
  heading.id = "student-confirm-title";
  form.append(heading);

  if (book) {
    const summary = element("div", "borrow-confirm-summary");

    summary.append(
      element("strong", "", book.title),
      element("p", "", book.author)
    );

    form.append(summary);
  }

  const explanation = element("p", "", description);
  explanation.id = "student-confirm-description";

  const actions = element(
    "div",
    "student-dialog-actions"
  );

  const cancel = element(
    "button",
    "student-stay",
    danger ? "No, stay" : "No, go back"
  );

  cancel.type = "submit";
  cancel.value = "cancel";
  cancel.autofocus = true;

  const yes = element(
    "button",
    danger ? "student-confirm-logout" : "student-confirm-borrow",
    yesLabel
  );

  yes.type = "submit";
  yes.value = "confirm";

  actions.append(cancel, yes);
  form.append(explanation, actions);
  dialog.append(form);

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      const confirmed = dialog.returnValue === "confirm";

      dialog.remove();

      if (activeDialog === dialog) {
        activeDialog = null;
      }

      resolve(confirmed);
    }, { once: true });

    document.body.append(dialog);
    dialog.showModal();
  });
}

// Profile
function paintAvatar(target, user) {
  if (!target) return;

  const name = user.displayName || user.email || "Student";

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

    const image = element("img");
    image.src = url.href;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove());

    target.append(image);
  } catch {
    // Keep initials if a profile photo is unavailable.
  }
}

function fillProfile(user) {
  const name = user.displayName || user.email || "Student";

  $("header-name").textContent = name;
  $("profile-name").textContent = name;
  $("profile-email").textContent = user.email || "";

  paintAvatar($("avatar"), user);

  let avatar = $("student-profile-avatar");

  if (!avatar) {
    avatar = element(
      "span",
      "avatar student-profile-avatar"
    );

    avatar.id = "student-profile-avatar";
    avatar.setAttribute("aria-hidden", "true");

    $("profile").prepend(avatar);
  }

  paintAvatar(avatar, user);
}

function profileLines() {
  return [
    `Name: ${currentUser.displayName || "Student"}`,
    `Email: ${currentUser.email || "Not provided"}`,
    "Account type: Student",
    "Email status: Verified",
    `User ID: ${currentUser.uid}`
  ];
}

function showProfile() {
  if (!currentUser || activeDialog?.open) return;

  closeDropdowns();

  const dialog = element("dialog", "student-dialog");
  activeDialog = dialog;

  const heading = element("h2", "", "Profile details");
  heading.id = "student-profile-title";

  dialog.setAttribute(
    "aria-labelledby",
    "student-profile-title"
  );

  dialog.append(heading);

  profileLines().forEach((line) => {
    dialog.append(element("p", "", line));
  });

  const form = element("form");
  form.method = "dialog";

  const actions = element(
    "div",
    "student-dialog-actions"
  );

  const close = element("button", "student-stay", "Close");
  close.autofocus = true;

  actions.append(close);
  form.append(actions);
  dialog.append(form);

  dialog.addEventListener("close", () => {
    dialog.remove();

    if (activeDialog === dialog) {
      activeDialog = null;
    }
  }, { once: true });

  document.body.append(dialog);
  dialog.showModal();
}

// Live Firestore data
function refreshDataViews() {
  if (!currentUser) return;

  if (["library", "history"].includes(currentView)) {
    renderBorrowing();
  } else if (
    ["discover", "category", "favourite"].includes(currentView)
  ) {
    renderCategories();
    renderBooks();
  }

  renderNotifications();
}

function startDataListeners(user, version) {
  stopBooks = onSnapshot(
    collection(db, "books"),
    (snapshot) => {
      if (version !== sessionVersion) return;

      catalogueReady = true;
      catalogueError = "";

      liveBooks = new Map(
        snapshot.docs.map((item) => [item.id, item.data()])
      );

      refreshDataViews();
    },
    (error) => {
      if (version !== sessionVersion) return;

      catalogueError =
        `Unable to load availability (${error.code}). Check Firestore Rules.`;

      refreshDataViews();
    }
  );

  const studentRequests = query(
    collection(db, "borrowRequests"),
    where("studentUid", "==", user.uid)
  );

  stopRequests = onSnapshot(
    studentRequests,
    (snapshot) => {
      if (version !== sessionVersion) return;

      requestsReady = true;
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

      refreshDataViews();
    },
    (error) => {
      if (version !== sessionVersion) return;

      requestsError =
        `Unable to load borrowing records (${error.code}). Check Firestore Rules.`;

      refreshDataViews();
    }
  );
}

// Favourites
function updateFavouriteButton(button, book) {
  const saved = favourites.has(book.id);

  button.classList.toggle("saved", saved);
  button.setAttribute("aria-pressed", String(saved));

  button.setAttribute(
    "aria-label",
    `${saved ? "Remove" : "Save"} ${book.title} ${
      saved ? "from" : "to"
    } favourites`
  );
}

function toggleFavourite(book, button) {
  const next = new Set(favourites);

  if (next.has(book.id)) {
    next.delete(book.id);
  } else {
    next.add(book.id);
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify([...next]));
    favourites = next;

    studentMessage(
      next.has(book.id)
        ? `${book.title} added to favourites.`
        : `${book.title} removed from favourites.`
    );

    if (currentView === "favourite") {
      renderBooks();
    } else {
      updateFavouriteButton(button, book);
    }
  } catch {
    studentMessage(
      "Unable to save favourites. Check browser storage settings.",
      true
    );
  }
}

// Availability and borrow request
function createBorrowingActions(book) {
  const wrapper = element("div");
  const note = element("p", "availability-text");
  const controls = element("div", "book-actions");

  const check = element("button", "", "View Availability");
  check.type = "button";

  const borrow = element("button", "borrow-button", "Borrow Book");
  borrow.type = "button";

  const active = requests.find(
    (request) =>
      request.bookId === book.id &&
      ["pending", "approved"].includes(request.status)
  );

  const copies = liveBooks.get(book.id)?.availableCopies;
  const available = Number.isInteger(copies) && copies > 0;

  if (catalogueError) {
    note.textContent = catalogueError;
  } else if (!catalogueReady) {
    note.textContent = "Loading availability...";
  } else if (!liveBooks.has(book.id)) {
    note.textContent = "Not listed for borrowing yet.";
  } else if (!Number.isInteger(copies) || copies < 0) {
    note.textContent = "Availability needs updating.";
  } else {
    note.textContent =
      `${copies} available ${copies === 1 ? "copy" : "copies"}`;
  }

  if (sending.has(book.id)) {
    borrow.textContent = "Request in progress...";
  } else if (active) {
    borrow.textContent = active.status === "pending"
      ? "Pending approval"
      : "Already borrowed";
  }

  borrow.disabled =
    Boolean(active) ||
    sending.has(book.id) ||
    !catalogueReady ||
    !requestsReady ||
    Boolean(catalogueError) ||
    Boolean(requestsError) ||
    !available;

  check.addEventListener("click", async () => {
    const version = sessionVersion;

    check.disabled = true;
    note.textContent = "Checking availability...";

    try {
      const snapshot = await getDoc(
        doc(db, "books", book.id)
      );

      if (version !== sessionVersion) return;

      const count = snapshot.data()?.availableCopies;
      let text;

      if (!snapshot.exists()) {
        text = "Not listed for borrowing yet.";
      } else if (!Number.isInteger(count) || count < 0) {
        text = "Availability needs updating.";
      } else if (count === 0) {
        text = "Book not available. Select another book.";
      } else {
        text =
          `${count} available copies. Admin approval required.`;
      }

      note.textContent = text;
      studentMessage(text, false, "info");
    } catch {
      if (version === sessionVersion) {
        note.textContent = "Unable to check availability.";

        studentMessage(
          "Unable to check availability. Try again.",
          true
        );
      }
    } finally {
      check.disabled = false;
    }
  });

  borrow.addEventListener("click", async () => {
    if (
      !currentUser ||
      sending.has(book.id) ||
      activeDialog?.open
    ) {
      return;
    }

    const user = currentUser;
    const version = sessionVersion;

    sending.add(book.id);
    borrow.disabled = true;
    borrow.textContent = "Confirming selection...";

    try {
      const confirmed = await confirmAction(
        "Request this book?",
        "Your request needs admin approval before a copy is issued.",
        "Yes, request book",
        book
      );

      if (
        !confirmed ||
        version !== sessionVersion ||
        auth.currentUser?.uid !== user.uid
      ) {
        return;
      }

      borrow.textContent = "Sending request...";

      studentMessage(
        "Sending your borrow request...",
        false,
        "info"
      );

      const requestRef = doc(
        collection(db, "borrowRequests")
      );

      const lockRef = doc(
        db,
        "borrowLocks",
        `${user.uid}_${book.id}`
      );

      await runTransaction(db, async (transaction) => {
        const bookSnapshot = await transaction.get(
          doc(db, "books", book.id)
        );

        const lockSnapshot = await transaction.get(lockRef);
        const count = bookSnapshot.data()?.availableCopies;

        if (
          !bookSnapshot.exists() ||
          !Number.isInteger(count) ||
          count <= 0
        ) {
          throw new Error(
            "Book not available. Please select another book."
          );
        }

        if (lockSnapshot.exists()) {
          throw new Error(
            "You already have an active request for this book."
          );
        }

        transaction.set(requestRef, {
          studentUid: user.uid,
          bookId: book.id,
          status: "pending",
          requestedAt: serverTimestamp()
        });

        transaction.set(lockRef, {
          studentUid: user.uid,
          bookId: book.id,
          requestId: requestRef.id
        });
      });

      if (version === sessionVersion) {
        studentMessage(
          `Request for “${book.title}” sent successfully. Waiting for admin approval.`
        );
      }
    } catch (error) {
      if (version === sessionVersion) {
        studentMessage(
          error.code
            ? `Unable to send request (${error.code}). Check your connection and try again.`
            : error.message,
          true
        );
      }
    } finally {
      if (version === sessionVersion) {
        sending.delete(book.id);
        refreshDataViews();
      }
    }
  });

  controls.append(check, borrow);
  wrapper.append(note, controls);

  return wrapper;
}

// Book catalogue
function renderBooks() {
  const grid = $("book-grid");
  grid.replaceChildren();

  const text = $("search").value.trim().toLowerCase();

  const rows = catalogueBooks().filter((book) => {
    const matchesSearch =
      `${book.title} ${book.author}`.toLowerCase().includes(text);

    const matchesCategory =
      currentView !== "category" ||
      selectedCategory === "All" ||
      book.category === selectedCategory;

    const matchesFavourite =
      currentView !== "favourite" ||
      favourites.has(book.id);

    return matchesSearch && matchesCategory && matchesFavourite;
  });

  $("result-count").textContent =
    `${rows.length} book${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    grid.append(element(
      "p",
      "empty",
      currentView === "favourite" && !text
        ? "No favourites yet. Tap the heart to save a book."
        : "No books match your search."
    ));
    return;
  }

  rows.forEach((book) => {
    const card = element("article", "book-card");
    const cover = element("div", "cover");

    cover.style.backgroundColor = book.color;
    cover.style.color = book.ink;

    const favourite = element("button", "favorite-button");
    favourite.type = "button";
    favourite.append(createIcon("heart"));

    updateFavouriteButton(favourite, book);

    favourite.addEventListener("click", () => {
      toggleFavourite(book, favourite);
    });

    cover.append(
      element("span", "cover-author", book.author),
      element("span", "cover-title", book.title),
      element("span", "cover-bottom", book.category),
      favourite
    );

    card.append(
      cover,
      element("h3", "", book.title),
      element("p", "", book.author),
      createBorrowingActions(book)
    );

    grid.append(card);
  });

  if (requestsError) {
    $("status").textContent = requestsError;
  }
}

function renderCategories() {
  const container = $("categories");
  container.replaceChildren();

  const categories = [
    "All",
    ...new Set(catalogueBooks().map((book) => book.category))
  ];

  if (!categories.includes(selectedCategory)) {
    selectedCategory = "All";
  }

  categories.forEach((category) => {
    const selected = category === selectedCategory;

    const button = element(
      "button",
      `chip${selected ? " active" : ""}`,
      category
    );

    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));

    button.addEventListener("click", () => {
      selectedCategory = category;
      renderCategories();
      renderBooks();
    });

    container.append(button);
  });
}

// Borrowed books and history
function renderBorrowing() {
  const container = $("details");
  container.replaceChildren();

  if (requestsError || !requestsReady) {
    container.append(element(
      "p",
      "empty",
      requestsError || "Loading borrowing records..."
    ));
    return;
  }

  const rows = requests.filter((request) =>
    currentView === "history"
      ? ["returned", "rejected"].includes(request.status)
      : ["pending", "approved"].includes(request.status)
  );

  if (!rows.length) {
    container.append(element(
      "p",
      "empty",
      currentView === "history"
        ? "No borrowing history yet."
        : "No pending requests or borrowed books yet."
    ));
    return;
  }

  const list = element("div", "loan-list");

  rows.forEach((request) => {
    const card = element("article", "loan-card");
    const info = element("div");

    let detail;

    if (request.status === "pending") {
      detail =
        "Waiting for admin approval. No copy has been issued.";
    } else if (request.status === "approved") {
      detail = request.dueAt
        ? `Due date: ${formatDate(request.dueAt)}`
        : "Approved. Contact the librarian for your due date.";
    } else if (request.status === "returned") {
      detail = request.returnedAt
        ? `Returned: ${formatDate(request.returnedAt, true)}`
        : "Book returned.";
    } else {
      detail =
        request.reason || "Request declined by the admin.";
    }

    info.append(
      element("h3", "", bookTitle(request.bookId)),
      element(
        "p",
        "request-timestamp",
        `Requested: ${formatDate(request.requestedAt, true)}`
      ),
      element("p", "", detail),
      element("p", "", `Reference: ${request.id}`)
    );

    const badge = element(
      "span",
      `loan-status ${request.status}`,
      request.status === "approved" ? "Borrowed" : request.status
    );

    card.append(info, badge);
    list.append(card);
  });

  container.append(list);
}

// Notification dropdown
function renderNotifications() {
  const container = $("notification-list");
  container.replaceChildren();

  const updates = requests.filter(
    (request) =>
      ["approved", "rejected", "returned"].includes(request.status)
  ).slice(0, 5);

  if (requestsError || !requestsReady || !updates.length) {
    container.append(element(
      "p",
      "",
      requestsError || (
        !requestsReady
          ? "Loading updates..."
          : "No borrowing updates yet."
      )
    ));
    return;
  }

  updates.forEach((request) => {
    let text =
      `${bookTitle(request.bookId)} — ${request.status}`;

    if (request.status === "approved" && request.dueAt) {
      text += `. Due ${formatDate(request.dueAt)}`;
    }

    const item = element("div", "notification-item");

    item.append(
      element("p", "", text),
      element(
        "small",
        "notification-time",
        `Requested: ${formatDate(request.requestedAt, true)}`
      )
    );

    container.append(item);
  });
}

// Page views
function renderDetails(title, lines) {
  const box = element("div", "detail-box");
  box.append(element("h3", "", title));

  lines.forEach((line) => {
    box.append(element("p", "", line));
  });

  $("details").replaceChildren(box);
}

function setView(view) {
  if (!views[view] || !currentUser) return;

  currentView = view;

  closeDropdowns();
  closeSidebar();
  studentMessage("");

  const [title, description, section] = views[view];

  $("page-title").textContent = title;
  $("page-description").textContent = description;
  $("section-title").textContent = section;

  document.querySelectorAll(".nav-button[data-view]").forEach(
    (button) => {
      const active = button.dataset.view === view;

      button.classList.toggle("active", active);

      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  );

  const isCatalogue =
    ["discover", "category", "favourite"].includes(view);

  $("categories").hidden = view !== "category";
  $("book-grid").hidden = !isCatalogue;
  $("details").hidden = isCatalogue;
  $("catalog-note").hidden = !isCatalogue;
  $("result-count").hidden = !isCatalogue;
  $("search").disabled = !isCatalogue;

  $("search").placeholder = isCatalogue
    ? "Search books or authors..."
    : "Search is available in the catalogue";

  if (isCatalogue) {
    renderCategories();
    renderBooks();
  } else if (["library", "history"].includes(view)) {
    renderBorrowing();
  } else if (view === "settings") {
    renderDetails("Student profile", profileLines());
  } else if (view === "support") {
    renderDetails("Contact your librarian", [
      "Visit your school library desk for account assistance.",
      "Borrow requests require admin approval.",
      "Available copies are checked again before a book is issued.",
      "For a forgotten password, use Forgot password on the login page."
    ]);
  }
}

// Logout
async function logoutStudent() {
  if (
    !currentUser ||
    loggingOut ||
    activeDialog?.open
  ) {
    return;
  }

  loggingOut = true;
  const version = sessionVersion;

  try {
    const confirmed = await confirmAction(
      "Log out of BookBase?",
      "You can sign in again whenever you need your library.",
      "Yes, log out",
      null,
      true
    );

    if (!confirmed || version !== sessionVersion) return;

    await signOut(auth);
    window.location.replace("./login.html");
  } catch {
    studentMessage(
      "Unable to log out. Check your connection and try again.",
      true
    );
  } finally {
    loggingOut = false;
  }
}

// Navigation — one handler to avoid duplicate actions
document.addEventListener("click", (event) => {
  const logout = event.target.closest("[data-logout]");

  if (logout) {
    logoutStudent();
    return;
  }

  const profile = event.target.closest(
    '#profile button[data-view="settings"], [data-student-profile], [data-profile-details]'
  );

  if (profile) {
    showProfile();
    return;
  }

  const view = event.target.closest("[data-view]");

  if (view) {
    setView(view.dataset.view);
    return;
  }

  const trigger = event.target.closest("[data-dropdown]");

  if (trigger) {
    const panel = $(trigger.dataset.dropdown);
    if (!panel) return;

    const open = panel.hidden;

    closeDropdowns();
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    return;
  }

  if (!event.target.closest(".action-wrap")) {
    closeDropdowns();
  }
});

$("menu-button").addEventListener("click", () => {
  const open = !$("sidebar").classList.contains("open");

  $("sidebar").classList.toggle("open", open);
  $("shade").hidden = !open;
  $("menu-button").setAttribute("aria-expanded", String(open));
});

$("shade").addEventListener("click", closeSidebar);

$("search").addEventListener("input", () => {
  if (
    ["discover", "category", "favourite"].includes(currentView)
  ) {
    renderBooks();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  const trigger = document.querySelector(
    '[data-dropdown][aria-expanded="true"]'
  );

  closeDropdowns();
  trigger?.focus();

  if ($("sidebar").classList.contains("open")) {
    closeSidebar();
    $("menu-button").focus();
  }
});

// Authentication
onAuthStateChanged(auth, async (user) => {
  const version = ++sessionVersion;

  stopBooks?.();
  stopRequests?.();
  activeDialog?.close();
  studentMessage("");

  currentUser = null;
  liveBooks = new Map();
  requests = [];
  sending.clear();

  catalogueReady = false;
  requestsReady = false;
  catalogueError = "";
  requestsError = "";

  $("app").hidden = true;
  $("loading").hidden = true;
  $("loading").textContent = "";

  if (!user || !user.emailVerified) {
    window.location.replace("./login.html");
    return;
  }

  try {
    const snapshot = await getDoc(
      doc(db, "roles", user.uid)
    );

    if (
      version !== sessionVersion ||
      auth.currentUser?.uid !== user.uid
    ) {
      return;
    }

    const role = snapshot.exists()
      ? snapshot.data().role
      : "student";

    if (role === "admin") {
      window.location.replace("./adminfiles/admin.html");
      return;
    }

    if (role !== "student") {
      throw new Error(
        "Invalid account role. Contact the librarian."
      );
    }

    currentUser = user;
    storageKey = `bookbase:favourites:${user.uid}`;

    try {
      const saved = JSON.parse(
        localStorage.getItem(storageKey) || "[]"
      );

      favourites = new Set(
        Array.isArray(saved)
          ? saved.filter((id) => typeof id === "string")
          : []
      );
    } catch {
      favourites = new Set();
    }

    fillProfile(user);
    $("app").hidden = false;

    setView("discover");
    startDataListeners(user, version);
  } catch (error) {
    if (version !== sessionVersion) return;

    $("loading").hidden = false;

    $("loading").textContent = error.code
      ? `Unable to check account (${error.code}). Check your connection and Firestore Rules, then refresh.`
      : error.message;
  }
});

// Live Philippine clock
// Updates only the display, not the Firestore data.
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
  const target = $("today");
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