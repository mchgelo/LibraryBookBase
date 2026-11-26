// PAGE ENTRY: Firebase setup, UI events and live data.
// Open oop/ for the four presentation modules.
import { LibraryRecord } from "./oop/encapsulation.js";
import { Book, StudentProfile } from "./oop/inheritance.js";
import { CatalogueService, StudentProfileService, BorrowingService } from "./oop/abstraction.js";
import { recordSummary } from "./oop/polymorphism.js";
export { LibraryRecord, Book, StudentProfile, CatalogueService, StudentProfileService, BorrowingService };

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
  setDoc,
  query,
  where,
  onSnapshot,
  runTransaction,
  serverTimestamp
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
const $ = (id) => document.getElementById(id);


// Record classes and services are imported from oop/.

// =====================================================
// SERVICE OBJECTS
// =====================================================

const catalogueService = new CatalogueService();
const profileService = new StudentProfileService(db, auth);
const borrowingService = new BorrowingService(db, auth);

let profileModel = null;

// Polymorphism: accepts Book or StudentProfile records.
function recordHeading(record, tag = "h3") {
  const summary = recordSummary(record);
  return element(tag, "", summary.title);
}


// =====================================================
// CATALOGUE EXAMPLES
// Actual borrowing inventory still comes from Firestore.
// =====================================================

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
  id,
  title,
  author,
  category,
  color,
  ink
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
    "Track pending requests, approved loans, and due dates.",
    "Current borrowing"
  ],
  history: [
    "Borrowing history",
    "Review returned books, declined requests, and cancellations.",
    "Past transactions"
  ],
  favourite: [
    "Your favourites",
    "Books you saved for later.",
    "Saved books"
  ],
  settings: [
    "Account settings",
    "Complete your student details before borrowing.",
    "Student profile"
  ],
  support: [
    "Library support",
    "Get help with your account and borrowing.",
    "Contact the librarian"
  ]
};


// =====================================================
// STATE
// =====================================================

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
let stopProfile = null;
let sessionVersion = 0;

let studentProfile = {};
let profileReady = false;
let profileError = "";
let profileSaving = false;

let toastTimer = null;
let activeDialog = null;
let loggingOut = false;
let overdueSignature = "";

const sending = new Set();
const cancelling = new Set();


// =====================================================
// HELPERS
// =====================================================

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

  const svg = document.createElementNS(
    namespace,
    "svg"
  );

  const use = document.createElementNS(
    namespace,
    "use"
  );

  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);

  return svg;
}

function catalogueBooks() {
  return catalogueService.getBooks(
    sampleBooks,
    liveBooks
  );
}

function bookTitle(id) {
  return catalogueBooks().find(
    (book) => book.id === id
  )?.title || id;
}

function formatDate(value, includeTime = true) {
  if (!value?.toDate) {
    return "Awaiting server timestamp";
  }

  const options = {
    dateStyle: "medium",
    timeZone: "Asia/Manila"
  };

  if (includeTime) {
    options.timeStyle = "medium";
    options.hour12 = true;
  }

  return new Intl.DateTimeFormat(
    "en-PH",
    options
  ).format(value.toDate()) +
    (includeTime ? " PHT" : "");
}

function studentName(user = currentUser) {
  return profileModel?.fullName ||
    user?.displayName ||
    user?.email ||
    "Student";
}

function profileComplete() {
  return Boolean(profileModel?.isComplete());
}

function isOverdue(request, now = Date.now()) {
  const due = request.dueAt?.toMillis?.();

  return request.status === "approved" &&
    typeof due === "number" &&
    due <= now;
}

function closeDropdowns() {
  document.querySelectorAll("[data-dropdown]")
    .forEach((button) => {
      const panel = $(button.dataset.dropdown);

      if (panel) {
        panel.hidden = true;
      }

      button.setAttribute(
        "aria-expanded",
        "false"
      );
    });
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("shade").hidden = true;

  $("menu-button").setAttribute(
    "aria-expanded",
    "false"
  );
}


// =====================================================
// SUCCESS / ERROR NOTIFICATIONS
// =====================================================

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

  const toast = element(
    "div",
    `student-toast ${type}`
  );

  toast.id = "student-toast";

  const icon = element(
    "span",
    "student-toast-icon",
    symbols[type]
  );

  icon.setAttribute("aria-hidden", "true");

  const content = element(
    "div",
    "student-toast-content"
  );

  content.setAttribute(
    "role",
    error ? "alert" : "status"
  );

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

  close.setAttribute(
    "aria-label",
    "Dismiss notification"
  );

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

  toast.addEventListener(
    "pointerleave",
    dismissLater
  );

  toast.addEventListener(
    "focusout",
    dismissLater
  );

  dismissLater();
}


// =====================================================
// CONFIRMATION DIALOG
// =====================================================

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

  const dialog = element(
    "dialog",
    "student-dialog"
  );

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
    const summary = element(
      "div",
      "borrow-confirm-summary"
    );

    summary.append(
      element("strong", "", book.title),
      element("p", "", book.author)
    );

    form.append(summary);
  }

  const explanation = element(
    "p",
    "",
    description
  );

  explanation.id = "student-confirm-description";

  const actions = element(
    "div",
    "student-dialog-actions"
  );

  const cancel = element(
    "button",
    "student-stay",
    danger ? "No, keep it" : "No, go back"
  );

  cancel.type = "submit";
  cancel.value = "cancel";
  cancel.autofocus = true;

  const yes = element(
    "button",
    danger
      ? "student-confirm-logout"
      : "student-confirm-borrow",
    yesLabel
  );

  yes.type = "submit";
  yes.value = "confirm";

  actions.append(cancel, yes);
  form.append(explanation, actions);
  dialog.append(form);

  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const confirmed =
          dialog.returnValue === "confirm";

        dialog.remove();

        if (activeDialog === dialog) {
          activeDialog = null;
        }

        resolve(confirmed);
      },
      { once: true }
    );

    document.body.append(dialog);
    dialog.showModal();
  });
}


// =====================================================
// PROFILE DISPLAY
// =====================================================

function paintAvatar(target, user) {
  if (!target) return;

  target.textContent = studentName(user)
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

    image.addEventListener(
      "error",
      () => image.remove()
    );

    target.append(image);
  } catch {
    // Keep initials if a photo is unavailable.
  }
}

function fillProfile(user) {
  const name = studentName(user);

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

  $("dropdown-student-id").textContent =
    profileModel?.studentId || "Not provided";

  $("profile-course-text").textContent =
    profileModel?.course || "Not provided";

  updateProfileDialog();
}

function profileFields() {
  const profile = profileModel ||
    new StudentProfile(currentUser);

  return [
    ["user", "Full name", profile.fullName],
    ["id", "Student ID", profile.studentId || "Not provided"],
    ["graduation", "Course / Program", profile.course || "Not provided"],
    ["mail", "Email address", profile.email || "Not provided"],
    ["shield", "Account type", "Student"],
    ["check", "Email status", profile.emailVerified ? "Verified" : "Not verified"],
    ["key", "User ID", profile.id]
  ];
}

function updateProfileDialog() {
  const container = $("profile-dialog-fields");

  if (!container || !currentUser) return;

  container.replaceChildren();

  profileFields().forEach(([icon, label, value]) => {
    const row = element(
      "div",
      "profile-detail-row"
    );

    const text = element("div");

    text.append(
      element("dt", "", label),
      element("dd", "", value)
    );

    row.append(
      createIcon(icon),
      text
    );

    container.append(row);
  });

  const name = $("profile-dialog-name");

  if (name) {
    name.textContent = studentName();
  }

  paintAvatar(
    $("profile-dialog-avatar"),
    currentUser
  );
}

function showProfile() {
  if (
    !currentUser ||
    activeDialog?.open
  ) {
    return;
  }

  closeDropdowns();

  const dialog = element(
    "dialog",
    "student-dialog profile-dialog"
  );

  activeDialog = dialog;

  const heading = element(
    "h2",
    "",
    "Profile details"
  );

  heading.id = "student-profile-title";

  dialog.setAttribute(
    "aria-labelledby",
    heading.id
  );

  const identity = element(
    "div",
    "profile-dialog-identity"
  );

  const avatar = element("span", "avatar");
  avatar.id = "profile-dialog-avatar";

  paintAvatar(avatar, currentUser);

  const name = recordHeading(
    profileModel || new StudentProfile(currentUser)
  );

  name.id = "profile-dialog-name";
  identity.append(avatar, name);

  const details = element(
    "dl",
    "profile-detail-list"
  );

  details.id = "profile-dialog-fields";

  const actions = element(
    "div",
    "student-dialog-actions"
  );

  const edit = element(
    "button",
    "student-confirm-borrow"
  );

  edit.type = "button";

  edit.append(
    createIcon("edit"),
    element("span", "", "Edit profile")
  );

  edit.addEventListener("click", () => {
    dialog.close();
    setView("settings");
    $("profile-full-name")?.focus();
  });

  const close = element(
    "button",
    "student-stay",
    "Close"
  );

  close.type = "button";
  close.autofocus = true;

  close.addEventListener(
    "click",
    () => dialog.close()
  );

  actions.append(close, edit);

  dialog.append(
    heading,
    identity,
    details,
    actions
  );

  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();

      if (activeDialog === dialog) {
        activeDialog = null;
      }
    },
    { once: true }
  );

  document.body.append(dialog);
  updateProfileDialog();
  dialog.showModal();
}

function updateProfileNotice() {
  const notice = $("profile-notice");

  notice.replaceChildren();

  notice.hidden =
    !profileReady ||
    (!profileError && profileComplete());

  if (notice.hidden) return;

  notice.append(
    element(
      "span",
      "",
      profileError ||
        "Complete your Student ID and course before requesting a book."
    )
  );

  const button = element(
    "button",
    "profile-notice-button",
    "Open Settings"
  );

  button.type = "button";
  button.dataset.view = "settings";
  notice.append(button);
}


// =====================================================
// PROFILE SETTINGS FORM
// =====================================================

function renderStudentProfile() {
  const container = $("details");
  container.replaceChildren();

  if (!profileReady) {
    container.append(
      element(
        "p",
        "empty",
        "Loading your student profile..."
      )
    );

    return;
  }

  const form = element(
    "form",
    "student-profile-form"
  );

  form.id = "student-profile-form";

  form.append(
    element(
      "p",
      "profile-help",
      "Your Student ID and course will be visible to the librarian."
    )
  );

  if (profileError) {
    form.append(
      element(
        "p",
        "profile-error",
        profileError
      )
    );
  }

  const grid = element(
    "div",
    "profile-form-grid"
  );

  const definitions = [
    [
      "profile-full-name",
      "Full name",
      "text",
      studentProfile.fullName || currentUser.displayName || "",
      100
    ],
    [
      "profile-student-id",
      "Student ID",
      "text",
      studentProfile.studentId || "",
      40
    ],
    [
      "profile-course",
      "Course / Program",
      "text",
      studentProfile.course || "",
      100
    ],
    [
      "profile-email-address",
      "Email address",
      "email",
      currentUser.email || "",
      254
    ]
  ];

  const iconNames = {
    "profile-full-name": "user",
    "profile-student-id": "id",
    "profile-course": "graduation",
    "profile-email-address": "mail"
  };

  definitions.forEach(([id, title, type, value, max]) => {
    const label = element(
      "label",
      "profile-field"
    );

    label.htmlFor = id;

    const caption = element(
      "span",
      "profile-field-label"
    );

    caption.append(
      createIcon(iconNames[id]),
      element("span", "", title)
    );

    const input = element("input");

    input.id = id;
    input.type = type;
    input.value = value;
    input.dataset.initialValue = value;
    input.maxLength = max;
    input.required = id !== "profile-email-address";
    input.readOnly = id === "profile-email-address";

    if (id === "profile-full-name") {
      input.autocomplete = "name";
    }

    if (id === "profile-student-id") {
      input.placeholder =
        "Enter your school Student ID";
    }

    if (id === "profile-course") {
      input.placeholder =
        "Example: BS Information Technology";
    }

    label.append(caption, input);
    grid.append(label);
  });

  const save = element(
    "button",
    "profile-save-button"
  );

  save.type = "submit";
  save.disabled = profileSaving;

  save.append(
    createIcon("save"),
    element("span", "", "Save profile")
  );

  form.append(grid, save);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (
      !currentUser ||
      profileSaving ||
      !form.reportValidity()
    ) {
      return;
    }

    const user = currentUser;
    const version = sessionVersion;

    const fullName =
      $("profile-full-name").value.trim();

    const studentId =
      $("profile-student-id").value.trim();

    const course =
      $("profile-course").value.trim();

    if (!fullName || !studentId || !course) {
      studentMessage(
        "Complete your full name, Student ID, and course.",
        true
      );

      return;
    }

    profileSaving = true;
    save.disabled = true;
    save.textContent = "Saving...";

    form.querySelectorAll("input").forEach(
      (input) => {
        input.readOnly = true;
      }
    );

    try {
      const saved = await profileService.save(
        user,
        fullName,
        studentId,
        course
      );

      if (version === sessionVersion) {
        profileModel = saved;
        studentProfile = saved.toData();

        [
          "profile-full-name",
          "profile-student-id",
          "profile-course"
        ].forEach((id) => {
          const input = $(id);

          if (input) {
            input.dataset.initialValue =
              input.value.trim();
          }
        });

        form.dataset.dirty = "false";
        profileError = "";

        fillProfile(user);
        updateProfileNotice();

        studentMessage(
          "Student profile saved successfully."
        );
      }
    } catch (error) {
      if (version === sessionVersion) {
        studentMessage(
          `Unable to save profile (${error.code || "unknown error"}). Check your connection and profile Firestore Rules.`,
          true
        );
      }
    } finally {
      if (version === sessionVersion) {
        profileSaving = false;
      }

      save.disabled = false;

      form.querySelectorAll("input").forEach(
        (input) => {
          input.readOnly =
            input.id === "profile-email-address";
        }
      );

      save.replaceChildren(
        createIcon("save"),
        element("span", "", "Save profile")
      );
    }
  });

  form.addEventListener("input", () => {
    const dirty = [
      ...form.querySelectorAll(
        "input:not([readonly])"
      )
    ].some(
      (input) =>
        input.value !==
          input.dataset.initialValue
    );

    form.dataset.dirty = String(dirty);
  });

  container.append(form);
}


// =====================================================
// REAL-TIME LISTENERS
// =====================================================

function startProfileListener(user, version) {
  stopProfile = profileService.listen(
    user,
    (profile) => {
      if (version !== sessionVersion) return;

      profileReady = true;
      profileError = "";
      profileModel = profile;
      studentProfile = profile.toData();

      fillProfile(user);
      updateProfileNotice();

      const form = $("student-profile-form");

      if (
        currentView === "settings" &&
        !profileSaving &&
        !form?.contains(document.activeElement) &&
        form?.dataset.dirty !== "true"
      ) {
        renderStudentProfile();
      }
    },
    (error) => {
      if (version !== sessionVersion) return;

      profileReady = true;

      profileError =
        `Unable to load your profile (${error.code}). Publish the profile Firestore Rules.`;

      updateProfileNotice();

      if (currentView === "settings") {
        renderStudentProfile();
      }
    }
  );
}

function refreshDataViews() {
  if (!currentUser) return;

  if (
    ["library", "history"].includes(currentView)
  ) {
    renderBorrowing();
  } else if (
    ["discover", "category", "favourite"]
      .includes(currentView)
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
        snapshot.docs.map(
          (item) => [item.id, item.data()]
        )
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

  stopRequests = onSnapshot(
    query(
      collection(db, "borrowRequests"),
      where("studentUid", "==", user.uid)
    ),
    (snapshot) => {
      if (version !== sessionVersion) return;

      requestsReady = true;
      requestsError = "";

      requests = snapshot.docs.map(
        (item) => ({
          ...item.data(),
          id: item.id
        })
      );

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


// =====================================================
// FAVOURITES
// =====================================================

function updateFavouriteButton(button, book) {
  const saved = favourites.has(book.id);

  button.classList.toggle("saved", saved);

  button.setAttribute(
    "aria-pressed",
    String(saved)
  );

  button.setAttribute(
    "aria-label",
    `${saved ? "Remove" : "Save"} ${book.title} ${saved ? "from" : "to"} favourites`
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
    localStorage.setItem(
      storageKey,
      JSON.stringify([...next])
    );

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


// =====================================================
// AVAILABILITY AND BORROW REQUESTS
// =====================================================

function createBorrowingActions(book) {
  const wrapper = element("div");

  const note = element(
    "p",
    "availability-text"
  );

  const controls = element(
    "div",
    "book-actions"
  );

  const check = element(
    "button",
    "",
    "View Availability"
  );

  check.type = "button";

  const borrow = element(
    "button",
    "borrow-button",
    "Borrow Book"
  );

  borrow.type = "button";

  const active = requests.find(
    (request) =>
      request.bookId === book.id &&
      ["pending", "approved"].includes(
        request.status
      )
  );

  const copies =
    liveBooks.get(book.id)?.availableCopies;

  const available = book.isAvailable();

  note.textContent = catalogueError || (
    !catalogueReady
      ? "Loading availability..."
      : !liveBooks.has(book.id)
        ? "Not listed for borrowing yet."
        : !Number.isInteger(copies) || copies < 0
          ? "Availability needs updating."
          : `${copies} available ${copies === 1 ? "copy" : "copies"}`
  );

  borrow.textContent = sending.has(book.id)
    ? "Request in progress..."
    : active
      ? active.status === "pending"
        ? "Pending approval"
        : "Already borrowed"
      : "Borrow Book";

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

      const count =
        snapshot.data()?.availableCopies;

      const text = !snapshot.exists()
        ? "Not listed for borrowing yet."
        : !Number.isInteger(count) || count < 0
          ? "Availability needs updating."
          : count === 0
            ? "Book not available. Select another book."
            : `${count} available copies. Admin approval required.`;

      note.textContent = text;

      studentMessage(
        text,
        false,
        "info"
      );
    } catch {
      if (version === sessionVersion) {
        note.textContent =
          "Unable to check availability.";

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

    if (!profileReady) {
      studentMessage(
        "Your profile is still loading. Please try again.",
        false,
        "info"
      );

      return;
    }

    if (
      profileError ||
      !profileComplete()
    ) {
      setView("settings");

      studentMessage(
        profileError ||
          "Complete and save your Student ID and course before requesting a book.",
        false,
        "info"
      );

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

      await borrowingService.requestBook(
        user,
        profileModel,
        book.id
      );

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


// =====================================================
// CANCEL PENDING REQUEST
// =====================================================

async function cancelPendingRequest(request) {
  if (
    !currentUser ||
    cancelling.has(request.id) ||
    activeDialog?.open
  ) {
    return;
  }

  const user = currentUser;
  const version = sessionVersion;

  cancelling.add(request.id);
  renderBorrowing();

  try {
    const confirmed = await confirmAction(
      "Cancel this request?",
      "Only this pending request will be cancelled. No book copies will be changed.",
      "Yes, cancel request",
      {
        title: bookTitle(request.bookId),
        author: `Requested: ${formatDate(request.requestedAt, true)}`
      },
      true
    );

    if (
      !confirmed ||
      version !== sessionVersion ||
      auth.currentUser?.uid !== user.uid
    ) {
      return;
    }

    studentMessage(
      "Cancelling your request...",
      false,
      "info"
    );

    await borrowingService.cancelRequest(
      user,
      request.id
    );

    if (version === sessionVersion) {
      studentMessage(
        "Request cancelled successfully. You can find it in Borrowing History."
      );
    }
  } catch (error) {
    if (version === sessionVersion) {
      studentMessage(
        error.code
          ? `Unable to cancel request (${error.code}). Check your connection and cancellation Firestore Rules.`
          : error.message,
        true
      );
    }
  } finally {
    if (version === sessionVersion) {
      cancelling.delete(request.id);
      refreshDataViews();
    }
  }
}


// =====================================================
// CATALOGUE AND CATEGORY SEARCH
// =====================================================

function renderBooks() {
  const grid = $("book-grid");
  grid.replaceChildren();

  const text = $("search").value.trim();

  const rows = catalogueBooks().filter(
    (book) =>
      book.matchesSearch(text) &&
      (
        currentView !== "category" ||
        selectedCategory === "All" ||
        book.matchesCategory(selectedCategory)
      ) &&
      (
        currentView !== "favourite" ||
        favourites.has(book.id)
      )
  );

  $("result-count").textContent =
    `${rows.length} book${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    grid.append(
      element(
        "p",
        "empty",
        currentView === "favourite" && !text
          ? "No favourites yet. Tap the heart to save a book."
          : "No books match your search."
      )
    );

    return;
  }

  rows.forEach((book) => {
    const card = element(
      "article",
      "book-card"
    );

    const cover = element("div", "cover");

    cover.style.backgroundColor = book.color;
    cover.style.color = book.ink;

    const favourite = element(
      "button",
      "favorite-button"
    );

    favourite.type = "button";
    favourite.append(createIcon("heart"));

    updateFavouriteButton(
      favourite,
      book
    );

    favourite.addEventListener("click", () => {
      toggleFavourite(
        book,
        favourite
      );
    });

    cover.append(
      element("span", "cover-author", book.author),
      element("span", "cover-title", book.title),
      element("span", "cover-bottom", book.category),
      favourite
    );

    card.append(
      cover,
      recordHeading(book),
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
    ...new Set(
      catalogueBooks().map(
        (book) => book.category
      )
    )
  ];

  if (!categories.includes(selectedCategory)) {
    selectedCategory = "All";
  }

  categories.forEach((category) => {
    const selected =
      category === selectedCategory;

    const button = element(
      "button",
      `chip${selected ? " active" : ""}`,
      category
    );

    button.type = "button";

    button.setAttribute(
      "aria-pressed",
      String(selected)
    );

    button.addEventListener("click", () => {
      selectedCategory = category;
      renderCategories();
      renderBooks();
    });

    container.append(button);
  });
}


// =====================================================
// BORROWED BOOKS AND HISTORY
// =====================================================

function renderBorrowing() {
  const container = $("details");
  container.replaceChildren();

  if (
    requestsError ||
    !requestsReady
  ) {
    container.append(
      element(
        "p",
        "empty",
        requestsError || "Loading borrowing records..."
      )
    );

    return;
  }

  const rows = requests.filter(
    (request) =>
      currentView === "history"
        ? ["returned", "rejected", "cancelled"]
            .includes(request.status)
        : ["pending", "approved"]
            .includes(request.status)
  );

  if (!rows.length) {
    container.append(
      element(
        "p",
        "empty",
        currentView === "history"
          ? "No borrowing history yet."
          : "No pending requests or borrowed books yet."
      )
    );

    return;
  }

  const list = element(
    "div",
    "loan-list"
  );

  rows.forEach((request) => {
    const overdue = isOverdue(request);

    const card = element(
      "article",
      `loan-card${overdue ? " overdue-card" : ""}`
    );

    const info = element("div");

    info.append(
      element("h3", "", bookTitle(request.bookId)),
      element(
        "p",
        "request-timestamp",
        `Requested: ${formatDate(request.requestedAt, true)}`
      )
    );

    if (request.status === "pending") {
      info.append(
        element(
          "p",
          "",
          "Waiting for admin approval. No copy has been issued."
        )
      );
    } else if (request.status === "approved") {
      info.append(
        element(
          "p",
          "request-timestamp",
          request.dueAt
            ? `Due: ${formatDate(request.dueAt, true)}`
            : "Contact the librarian for your due date."
        )
      );

      if (overdue) {
        info.append(
          element(
            "p",
            "overdue-reminder",
            "Overdue — please return this book to the library."
          )
        );
      }
    } else if (request.status === "returned") {
      info.append(
        element(
          "p",
          "request-timestamp",
          request.returnedAt
            ? `Returned: ${formatDate(request.returnedAt, true)}`
            : "Book returned."
        )
      );
    } else if (request.status === "cancelled") {
      info.append(
        element(
          "p",
          "request-timestamp",
          request.cancelledAt
            ? `Cancelled: ${formatDate(request.cancelledAt, true)}`
            : "Cancelled by student."
        )
      );
    } else {
      info.append(
        element(
          "p",
          "",
          request.reason ||
            "Request declined by the admin."
        )
      );
    }

    info.append(
      element(
        "p",
        "",
        `Reference: ${request.id}`
      )
    );

    const actions = element(
      "div",
      "loan-card-actions"
    );

    actions.append(
      element(
        "span",
        `loan-status ${overdue ? "overdue" : request.status}`,
        overdue
          ? "Overdue"
          : request.status === "approved"
            ? "Borrowed"
            : request.status
      )
    );

    if (request.status === "pending") {
      const cancel = element(
        "button",
        "cancel-request-button",
        cancelling.has(request.id)
          ? "Please wait..."
          : "Cancel request"
      );

      cancel.type = "button";
      cancel.disabled =
        cancelling.has(request.id);

      cancel.addEventListener("click", () => {
        cancelPendingRequest(request);
      });

      actions.append(cancel);
    }

    card.append(info, actions);
    list.append(card);
  });

  container.append(list);
}


// =====================================================
// NOTIFICATION DROPDOWN
// =====================================================

function renderNotifications() {
  const container = $("notification-list");
  container.replaceChildren();

  function lastUpdate(request) {
    return request.cancelledAt?.toMillis?.() ||
      request.returnedAt?.toMillis?.() ||
      request.reviewedAt?.toMillis?.() ||
      request.approvedAt?.toMillis?.() ||
      request.requestedAt?.toMillis?.() ||
      0;
  }

  const updates = requests
    .filter(
      (request) =>
        ["approved", "rejected", "returned", "cancelled"]
          .includes(request.status)
    )
    .sort(
      (a, b) =>
        Number(isOverdue(b)) -
          Number(isOverdue(a)) ||
        lastUpdate(b) - lastUpdate(a)
    )
    .slice(0, 5);

  if (
    requestsError ||
    !requestsReady ||
    !updates.length
  ) {
    container.append(
      element(
        "p",
        "",
        requestsError || (
          !requestsReady
            ? "Loading updates..."
            : "No borrowing updates yet."
        )
      )
    );

    return;
  }

  updates.forEach((request) => {
    const overdue = isOverdue(request);

    const item = element(
      "div",
      `notification-item${overdue ? " overdue-notification" : ""}`
    );

    let text =
      `${bookTitle(request.bookId)} — ${
        overdue
          ? "Overdue. Please return this book."
          : request.status
      }`;

    if (
      request.status === "approved" &&
      request.dueAt
    ) {
      text +=
        ` Due ${formatDate(request.dueAt, true)}.`;
    }

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


// =====================================================
// VIEW SWITCHING
// =====================================================

function renderDetails(title, lines) {
  const box = element(
    "div",
    "detail-box"
  );

  box.append(
    element("h3", "", title)
  );

  lines.forEach((line) => {
    box.append(
      element("p", "", line)
    );
  });

  $("details").replaceChildren(box);
}

function setView(view) {
  if (
    !views[view] ||
    !currentUser
  ) {
    return;
  }

  currentView = view;

  closeDropdowns();
  closeSidebar();
  studentMessage("");

  const [title, description, section] =
    views[view];

  $("page-title").textContent = title;
  $("page-description").textContent = description;
  $("section-title").textContent = section;

  document.querySelectorAll(
    ".nav-button[data-view]"
  ).forEach((button) => {
    const active =
      button.dataset.view === view;

    button.classList.toggle(
      "active",
      active
    );

    if (active) {
      button.setAttribute(
        "aria-current",
        "page"
      );
    } else {
      button.removeAttribute(
        "aria-current"
      );
    }
  });

  const isCatalogue =
    ["discover", "category", "favourite"]
      .includes(view);

  $("categories").hidden = view !== "category";
  $("book-grid").hidden = !isCatalogue;
  $("details").hidden = isCatalogue;
  $("catalog-note").hidden = !isCatalogue;
  $("result-count").hidden = !isCatalogue;

  $("search").disabled = false;

  $("search").placeholder =
    "Search title, author, category or Book ID...";

  if (isCatalogue) {
    renderCategories();
    renderBooks();
  } else if (
    ["library", "history"].includes(view)
  ) {
    renderBorrowing();
  } else if (view === "settings") {
    renderStudentProfile();
  } else if (view === "support") {
    renderDetails(
      "Contact your librarian",
      [
        "Visit your school library desk for account assistance.",
        "Pending requests can be cancelled from My Borrowed Books.",
        "Approved books must be returned through the librarian.",
        "For a forgotten password, use Forgot password on the login page."
      ]
    );
  }
}


// =====================================================
// LOGOUT CONFIRMATION
// =====================================================

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

    if (
      !confirmed ||
      version !== sessionVersion
    ) {
      return;
    }

    await signOut(auth);

    window.location.replace(
      "./login.html"
    );
  } catch {
    studentMessage(
      "Unable to log out. Check your connection and try again.",
      true
    );
  } finally {
    loggingOut = false;
  }
}


// =====================================================
// NAVIGATION EVENTS
// =====================================================

document.addEventListener("click", (event) => {
  if (
    event.target.closest("[data-logout]")
  ) {
    logoutStudent();
    return;
  }

  if (
    event.target.closest(
      "[data-student-profile], [data-profile-details]"
    )
  ) {
    showProfile();
    return;
  }

  const view = event.target.closest(
    "[data-view]"
  );

  if (view) {
    setView(view.dataset.view);
    return;
  }

  const trigger = event.target.closest(
    "[data-dropdown]"
  );

  if (trigger) {
    const panel = $(
      trigger.dataset.dropdown
    );

    if (!panel) return;

    const open = panel.hidden;

    closeDropdowns();

    panel.hidden = !open;

    trigger.setAttribute(
      "aria-expanded",
      String(open)
    );

    return;
  }

  if (
    !event.target.closest(".action-wrap")
  ) {
    closeDropdowns();
  }
});

$("menu-button").addEventListener("click", () => {
  const open =
    !$("sidebar").classList.contains("open");

  $("sidebar").classList.toggle(
    "open",
    open
  );

  $("shade").hidden = !open;

  $("menu-button").setAttribute(
    "aria-expanded",
    String(open)
  );
});

$("shade").addEventListener(
  "click",
  closeSidebar
);

$("search").addEventListener("input", () => {
  if (currentView === "category") {
    selectedCategory = "All";
    renderCategories();
  }

  if (
    !["discover", "category", "favourite"]
      .includes(currentView)
  ) {
    setView("discover");
  } else {
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

  if (
    $("sidebar").classList.contains("open")
  ) {
    closeSidebar();
    $("menu-button").focus();
  }
});


// =====================================================
// AUTHENTICATION AND SESSION RESET
// =====================================================

onAuthStateChanged(auth, async (user) => {
  const version = ++sessionVersion;

  stopBooks?.();
  stopRequests?.();
  stopProfile?.();

  activeDialog?.close();
  studentMessage("");

  currentUser = null;

  studentProfile = {};
  profileModel = null;
  profileSaving = false;
  profileReady = false;
  profileError = "";

  liveBooks = new Map();
  requests = [];

  sending.clear();
  cancelling.clear();
  overdueSignature = "";

  catalogueReady = false;
  requestsReady = false;
  catalogueError = "";
  requestsError = "";

  $("app").hidden = true;
  $("loading").hidden = true;
  $("loading").textContent = "";

  if (
    !user ||
    !user.emailVerified
  ) {
    window.location.replace(
      "./login.html"
    );

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
      window.location.replace(
        "./adminfiles/admin.html"
      );

      return;
    }

    if (role !== "student") {
      throw new Error(
        "Invalid account role. Contact the librarian."
      );
    }

    currentUser = user;

    profileModel =
      new StudentProfile(user);

    storageKey =
      `bookbase:favourites:${user.uid}`;

    try {
      const saved = JSON.parse(
        localStorage.getItem(storageKey) ||
          "[]"
      );

      favourites = new Set(
        Array.isArray(saved)
          ? saved.filter(
              (id) => typeof id === "string"
            )
          : []
      );
    } catch {
      favourites = new Set();
    }

    fillProfile(user);

    $("app").hidden = false;

    setView("discover");
    updateProfileNotice();

    startProfileListener(
      user,
      version
    );

    startDataListeners(
      user,
      version
    );
  } catch (error) {
    if (
      version !== sessionVersion
    ) {
      return;
    }

    $("loading").hidden = false;

    $("loading").textContent =
      error.code
        ? `Unable to check account (${error.code}). Check your connection and Firestore Rules, then refresh.`
        : error.message;
  }
});


// =====================================================
// LIVE PHILIPPINE CLOCK AND OVERDUE REFRESH
// =====================================================

const clockDateFormatter =
  new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila"
  });

const clockTimeFormatter =
  new Intl.DateTimeFormat("en-PH", {
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

  if (
    !target ||
    !date ||
    !time
  ) {
    return;
  }

  const now = new Date();

  target.dateTime = now.toISOString();

  date.textContent =
    clockDateFormatter.format(now);

  time.textContent =
    `${clockTimeFormatter.format(now)} PHT`;

  if (
    currentUser &&
    requestsReady
  ) {
    const signature = requests
      .filter(
        (request) =>
          request.status === "approved"
      )
      .map(
        (request) =>
          `${request.id}:${isOverdue(request, now.getTime())}`
      )
      .join("|");

    if (
      signature !== overdueSignature
    ) {
      overdueSignature = signature;

      if (
        currentView === "library"
      ) {
        renderBorrowing();
      }

      renderNotifications();
    }
  }
}

function startDashboardClock() {
  clearInterval(clockTimer);

  updateDashboardClock();

  clockTimer = setInterval(
    updateDashboardClock,
    1000
  );
}

startDashboardClock();

window.addEventListener("pagehide", () => {
  clearInterval(clockTimer);
});

window.addEventListener(
  "pageshow",
  startDashboardClock
);

document.addEventListener(
  "visibilitychange",
  () => {
    if (!document.hidden) {
      updateDashboardClock();
    }
  }
);