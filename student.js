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

const firebaseConfig = {
  apiKey: "AIzaSyAI-ZTiaClMvISqvG5KIJW8rA_YQ0rukbw",
  authDomain: "library-db9da.firebaseapp.com",
  projectId: "library-db9da",
  storageBucket: "library-db9da.firebasestorage.app",
  messagingSenderId: "938072556708",
  appId: "1:938072556708:web:39370090740ce6125a9231",
  measurementId: "G-9W3G6V3WF2"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const $ = (id) => document.getElementById(id);

// Display examples. Actual availability comes from Firestore.
const sampleBooks = [
  {
    id: "money",
    title: "The Psychology of Money",
    author: "Morgan Housel",
    category: "Finance",
    color: "#789483",
    ink: "#ffffff"
  },
  {
    id: "innovation",
    title: "How Innovation Works",
    author: "Matt Ridley",
    category: "Science",
    color: "#f5d52c",
    ink: "#263b42"
  },
  {
    id: "company",
    title: "Company of One",
    author: "Paul Jarvis",
    category: "Business",
    color: "#e9eae3",
    ink: "#303a42"
  },
  {
    id: "habits",
    title: "Atomic Habits",
    author: "James Clear",
    category: "Self-development",
    color: "#e6d8c0",
    ink: "#554334"
  },
  {
    id: "alchemist",
    title: "The Alchemist",
    author: "Paulo Coelho",
    category: "Fiction",
    color: "#b76342",
    ink: "#fff3d8"
  },
  {
    id: "brief",
    title: "A Brief History of Time",
    author: "Stephen Hawking",
    category: "Science",
    color: "#263c60",
    ink: "#e7efff"
  },
  {
    id: "deep",
    title: "Deep Work",
    author: "Cal Newport",
    category: "Self-development",
    color: "#cc6c53",
    ink: "#fff7ed"
  },
  {
    id: "little",
    title: "The Little Prince",
    author: "Antoine de Saint-Exupéry",
    category: "Fiction",
    color: "#9fbfc9",
    ink: "#203c50"
  }
];

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
    "Track your pending requests and approved loans.",
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

const sending = new Set();

function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
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
  const merged = new Map(
    sampleBooks.map((book) => [book.id, { ...book }])
  );

  liveBooks.forEach((data, id) => {
    merged.set(id, {
      color: "#738baa",
      ink: "#ffffff",
      ...merged.get(id),
      ...data,
      id,
      title: data.title || merged.get(id)?.title || id,
      author: data.author || merged.get(id)?.author || "Unknown author",
      category: data.category || merged.get(id)?.category || "General"
    });
  });

  return [...merged.values()];
}

function bookTitle(id) {
  return catalogueBooks().find((book) => book.id === id)?.title || id;
}

function formatDate(value) {
  if (!value?.toDate) return "Processing...";

  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeZone: "Asia/Manila"
  }).format(value.toDate());
}

function closeDropdowns() {
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

function refreshDataViews() {
  if (!currentUser) return;

  if (["library", "history"].includes(currentView)) {
    renderBorrowing();
  } else if (["discover", "category", "favourite"].includes(currentView)) {
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

    $("status").textContent = next.has(book.id)
      ? `${book.title} added to favourites.`
      : `${book.title} removed from favourites.`;

    if (currentView === "favourite") {
      renderBooks();
    } else {
      updateFavouriteButton(button, book);
    }
  } catch {
    $("status").textContent =
      "Unable to save favourites. Check your browser storage settings.";
  }
}

function createBorrowingActions(book) {
  const wrapper = element("div");
  const note = element("p", "availability-text");
  const controls = element("div", "book-actions");

  const checkButton = element("button", "", "View Availability");
  checkButton.type = "button";

  const borrowButton = element("button", "borrow-button", "Borrow Book");
  borrowButton.type = "button";

  const activeRequest = requests.find(
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
    borrowButton.textContent = "Sending request...";
  } else if (activeRequest) {
    borrowButton.textContent = activeRequest.status === "pending"
      ? "Pending approval"
      : "Already borrowed";
  }

  borrowButton.disabled =
    Boolean(activeRequest) ||
    sending.has(book.id) ||
    !catalogueReady ||
    !requestsReady ||
    Boolean(catalogueError) ||
    Boolean(requestsError) ||
    !available;

  checkButton.addEventListener("click", async () => {
    checkButton.disabled = true;
    note.textContent = "Checking availability...";

    try {
      const snapshot = await getDoc(doc(db, "books", book.id));
      const count = snapshot.data()?.availableCopies;

      if (!snapshot.exists()) {
        note.textContent = "Not listed for borrowing yet.";
      } else if (!Number.isInteger(count) || count < 0) {
        note.textContent = "Availability needs updating.";
      } else if (count === 0) {
        note.textContent = "Book not available. Select another book.";
      } else {
        note.textContent =
          `${count} available copies. Admin approval required.`;
      }
    } catch {
      note.textContent = "Unable to check availability. Try again.";
    } finally {
      checkButton.disabled = false;
    }
  });

  borrowButton.addEventListener("click", async () => {
    if (!currentUser || sending.has(book.id)) return;

    const user = currentUser;
    const version = sessionVersion;

    // Every borrowing attempt has a unique record for history.
    const requestRef = doc(collection(db, "borrowRequests"));

    // One active request per student and book.
    const lockRef = doc(
      db,
      "borrowLocks",
      `${user.uid}_${book.id}`
    );

    sending.add(book.id);
    borrowButton.disabled = true;
    borrowButton.textContent = "Sending request...";

    try {
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
        $("status").textContent =
          `Request sent for ${book.title}. ` +
          "Waiting for admin approval. No copy has been issued yet.";
      }
    } catch (error) {
      if (version === sessionVersion) {
        $("status").textContent = error.code
          ? `Unable to send request (${error.code}). Check your connection and Firestore Rules.`
          : error.message;
      }
    } finally {
      sending.delete(book.id);

      if (version === sessionVersion) {
        refreshDataViews();
      }
    }
  });

  controls.append(checkButton, borrowButton);
  wrapper.append(note, controls);

  return wrapper;
}

function renderBooks() {
  const grid = $("book-grid");
  grid.replaceChildren();

  const searchText = $("search").value.trim().toLowerCase();

  const filtered = catalogueBooks().filter((book) => {
    const matchesSearch =
      `${book.title} ${book.author}`.toLowerCase().includes(searchText);

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
    `${filtered.length} book${filtered.length === 1 ? "" : "s"}`;

  if (!filtered.length) {
    grid.append(element(
      "p",
      "empty",
      currentView === "favourite" && !searchText
        ? "No favourites yet. Tap the heart on a book to save it."
        : "No books match your search."
    ));

    return;
  }

  filtered.forEach((book) => {
    const card = element("article", "book-card");
    const cover = element("div", "cover");

    cover.style.backgroundColor = book.color;
    cover.style.color = book.ink;

    const favoriteButton = element("button", "favorite-button");
    favoriteButton.type = "button";
    favoriteButton.append(createIcon("heart"));

    updateFavouriteButton(favoriteButton, book);

    favoriteButton.addEventListener("click", () => {
      toggleFavourite(book, favoriteButton);
    });

    cover.append(
      element("span", "cover-author", book.author),
      element("span", "cover-title", book.title),
      element("span", "cover-bottom", book.category),
      favoriteButton
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
    const information = element("div");

    let detail;

    if (request.status === "pending") {
      detail = "Waiting for admin approval. No copy has been issued.";
    } else if (request.status === "approved") {
      detail = request.dueAt
        ? `Due date: ${formatDate(request.dueAt)}`
        : "Approved. Contact the librarian for your due date.";
    } else if (request.status === "returned") {
      detail = request.returnedAt
        ? `Returned: ${formatDate(request.returnedAt)}`
        : "Book returned.";
    } else {
      detail = request.reason || "Request declined by the admin.";
    }

    information.append(
      element("h3", "", bookTitle(request.bookId)),
      element("p", "", `Requested: ${formatDate(request.requestedAt)}`),
      element("p", "", detail),
      element("p", "", `Reference: ${request.id}`)
    );

    const badge = element(
      "span",
      `loan-status ${request.status}`,
      request.status === "approved" ? "Borrowed" : request.status
    );

    card.append(information, badge);
    list.append(card);
  });

  container.append(list);
}

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
      requestsError ||
      (!requestsReady ? "Loading updates..." : "No borrowing updates yet.")
    ));

    return;
  }

  updates.forEach((request) => {
    let text = `${bookTitle(request.bookId)} — ${request.status}`;

    if (request.status === "approved" && request.dueAt) {
      text += `. Due ${formatDate(request.dueAt)}`;
    }

    container.append(element("p", "notification-item", text));
  });
}

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

  const [title, description, section] = views[view];

  $("page-title").textContent = title;
  $("page-description").textContent = description;
  $("section-title").textContent = section;
  $("status").textContent = "";

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
    renderDetails("Student profile", [
      `Name: ${currentUser.displayName || "Student"}`,
      `Email: ${currentUser.email || "Not provided"}`,
      "Account type: Student",
      "Email status: Verified",
      "Contact the librarian to correct your account details."
    ]);
  } else if (view === "support") {
    renderDetails("Contact your librarian", [
      "Visit your school library desk for account assistance.",
      "Borrow requests require admin approval.",
      "Available copies are checked again before a book is issued.",
      "For a forgotten password, use Forgot password on the login page."
    ]);
  }
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    setView(button.dataset.view);
  });
});

document.querySelectorAll("[data-dropdown]").forEach((button) => {
  button.addEventListener("click", () => {
    const panel = $(button.dataset.dropdown);
    const open = panel.hidden;

    closeDropdowns();

    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".action-wrap")) {
    closeDropdowns();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  const openButton = document.querySelector(
    '[data-dropdown][aria-expanded="true"]'
  );

  closeDropdowns();
  openButton?.focus();

  if ($("sidebar").classList.contains("open")) {
    closeSidebar();
    $("menu-button").focus();
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
  if (["discover", "category", "favourite"].includes(currentView)) {
    renderBooks();
  }
});

document.querySelectorAll("[data-logout]").forEach((button) => {
  button.addEventListener("click", async () => {
    const buttons = document.querySelectorAll("[data-logout]");

    buttons.forEach((item) => {
      item.disabled = true;
    });

    try {
      await signOut(auth);
     window.location.replace("./adminfiles/admin.html");
    } catch {
      $("status").textContent =
        "Unable to log out. Check your connection and try again.";

      buttons.forEach((item) => {
        item.disabled = false;
      });
    }
  });
});

$("today").textContent = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "long",
  timeZone: "Asia/Manila"
}).format(new Date());

onAuthStateChanged(auth, async (user) => {
    $("app").hidden = true;
$("loading").hidden = true;
$("loading").textContent = "";
  const version = ++sessionVersion;

  stopBooks?.();
  stopRequests?.();

  currentUser = null;
  liveBooks = new Map();
  requests = [];

  catalogueReady = false;
  requestsReady = false;
  catalogueError = "";
  requestsError = "";

  sending.clear();

  $("app").hidden = true;
  $("loading").hidden = true;
$("loading").textContent = "";

  if (!user || !user.emailVerified) {
    window.location.replace("./login.html");
    return;
  }

  try {
    const snapshot = await getDoc(doc(db, "roles", user.uid));

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
      window.location.replace("./admin.html");
      return;
    }

    if (role !== "student") {
      $("loading").textContent =
        "Invalid account role. Contact the librarian.";
      return;
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

    const name = user.displayName || "Student";

    $("header-name").textContent = name;
    $("profile-name").textContent = name;
    $("profile-email").textContent = user.email || "";

    $("avatar").textContent = name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join("")
      .toUpperCase();

    $("loading").hidden = true;
    $("app").hidden = false;

    setView("discover");
    startDataListeners(user, version);
  } catch (error) {
    if (version !== sessionVersion) return;

    $("loading").textContent =
      `Unable to check account (${error.code || "unknown error"}). ` +
      "Check your connection and Firestore Rules, then refresh.";
  }
});
// Student profile and logout interface

let studentLogoutBusy = false;
let studentLogoutDialog = null;
let studentProfileDialog = null;
let studentProfileObserver = null;

function studentCloseDropdowns() {
  document.querySelectorAll("[data-dropdown]").forEach((button) => {
    const panel = document.getElementById(
      button.dataset.dropdown
    );

    if (panel) panel.hidden = true;

    button.setAttribute("aria-expanded", "false");
  });
}

function studentPaintAvatar(target, user) {
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

    const image = document.createElement("img");

    image.src = url.href;
    image.alt = "";
    image.referrerPolicy = "no-referrer";

    image.addEventListener("error", () => {
      image.remove();
    });

    target.append(image);
  } catch {
    // Keep initials if the profile photo is unavailable.
  }
}

// Profile details

function studentShowProfile() {
  const user = auth.currentUser;

  if (!user) return;

  studentCloseDropdowns();

  if (studentProfileDialog?.open) return;

  const dialog = document.createElement("dialog");
  studentProfileDialog = dialog;

  dialog.className = "student-dialog";

  dialog.setAttribute(
    "aria-labelledby",
    "student-profile-heading"
  );

  dialog.innerHTML = `
    <h2 id="student-profile-heading">Profile details</h2>

    <dl class="student-profile-fields"></dl>

    <form method="dialog">
      <div class="student-dialog-actions">
        <button class="student-stay" autofocus>
          Close
        </button>
      </div>
    </form>
  `;

  const fields = [
    ["Full name", user.displayName || "Not provided"],
    ["Email address", user.email || "Not provided"],
    ["Account role", "Student"],
    [
      "Email status",
      user.emailVerified ? "Verified" : "Not verified"
    ],
    ["User ID", user.uid]
  ];

  const list = dialog.querySelector("dl");

  for (const [label, value] of fields) {
    const term = document.createElement("dt");
    term.textContent = label;

    const detail = document.createElement("dd");
    detail.textContent = value;

    list.append(term, detail);
  }

  dialog.addEventListener("close", () => {
    dialog.remove();
    studentProfileDialog = null;
  }, { once: true });

  document.body.append(dialog);
  dialog.showModal();
}

// Logout confirmation

function studentShowLogout() {
  const user = auth.currentUser;

  if (
    !user ||
    studentLogoutBusy ||
    studentLogoutDialog?.open
  ) {
    return;
  }

  studentCloseDropdowns();

  const dialog = document.createElement("dialog");
  studentLogoutDialog = dialog;

  dialog.className = "student-dialog";

  dialog.setAttribute(
    "aria-labelledby",
    "student-logout-heading"
  );

  dialog.setAttribute(
    "aria-describedby",
    "student-logout-description"
  );

  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="student-logout-heading">
        Log out of BookBase?
      </h2>

      <p id="student-logout-description">
        You can sign in again whenever you need your library.
      </p>

      <p class="student-dialog-error" role="alert"></p>

      <div class="student-dialog-actions">
        <button
          value="cancel"
          class="student-stay"
          autofocus
        >
          No, stay
        </button>

        <button
          type="button"
          class="student-confirm-logout"
        >
          Yes, log out
        </button>
      </div>
    </form>
  `;

  const yesButton = dialog.querySelector(
    ".student-confirm-logout"
  );

  const noButton = dialog.querySelector(".student-stay");
  const errorMessage = dialog.querySelector(".student-dialog-error");

  dialog.addEventListener("cancel", (event) => {
    if (studentLogoutBusy) {
      event.preventDefault();
    }
  });

  dialog.addEventListener("close", () => {
    dialog.remove();
    studentLogoutDialog = null;
  }, { once: true });

  yesButton.addEventListener("click", async () => {
    if (studentLogoutBusy) return;

    if (auth.currentUser?.uid !== user.uid) {
      dialog.close();
      return;
    }

    studentLogoutBusy = true;

    yesButton.disabled = true;
    noButton.disabled = true;
    yesButton.textContent = "Logging out...";
    errorMessage.textContent = "";

    try {
      await signOut(auth);
      window.location.replace("./login.html");
    } catch {
      errorMessage.textContent =
        "Unable to log out. Check your connection and try again.";
    } finally {
      studentLogoutBusy = false;

      yesButton.disabled = false;
      noButton.disabled = false;
      yesButton.textContent = "Yes, log out";
    }
  });

  document.body.append(dialog);
  dialog.showModal();
}

// Intercept logout before the existing immediate-logout handler.
// Also open the profile dialog from the existing Profile details button.

document.addEventListener(
  "click",
  (event) => {
    const logoutButton = event.target.closest("[data-logout]");

    const profileButton = event.target.closest(
      '#profile button[data-view="settings"], [data-student-profile]'
    );

    if (!logoutButton && !profileButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (logoutButton) {
      studentShowLogout();
    } else {
      studentShowProfile();
    }
  },
  true
);

// Populate the signed-in student's profile.

onAuthStateChanged(auth, (user) => {
  studentProfileObserver?.disconnect();

  if (!user) {
    if (!studentLogoutBusy) {
      studentLogoutDialog?.close();
    }

    studentProfileDialog?.close();
    return;
  }

  const name = user.displayName || user.email || "Student";

  for (const id of ["header-name", "profile-name"]) {
    const target = document.getElementById(id);

    if (target) {
      target.textContent = name;
    }
  }

  const email = document.getElementById("profile-email");

  if (email) {
    email.textContent = user.email || "No email provided";
  }

  const profile = document.getElementById("profile");

  let profileAvatar = document.getElementById(
    "student-profile-avatar"
  );

  if (!profileAvatar && profile) {
    profileAvatar = document.createElement("span");

    profileAvatar.id = "student-profile-avatar";
    profileAvatar.className = "avatar student-profile-avatar";
    profileAvatar.setAttribute("aria-hidden", "true");

    profile.prepend(profileAvatar);
  }

  studentPaintAvatar(profileAvatar, user);

  // Apply the header photo after the original account check finishes.

  const appPanel = document.getElementById("app");

  function paintHeader() {
    if (
      !appPanel ||
      appPanel.hidden ||
      auth.currentUser?.uid !== user.uid
    ) {
      return;
    }

    studentPaintAvatar(
      document.getElementById("avatar"),
      user
    );

    studentProfileObserver?.disconnect();
  }

  if (appPanel && appPanel.hidden) {
    studentProfileObserver = new MutationObserver(paintHeader);

    studentProfileObserver.observe(appPanel, {
      attributes: true,
      attributeFilter: ["hidden"]
    });
  } else {
    paintHeader();
  }
});