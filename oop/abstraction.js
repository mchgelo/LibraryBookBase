// PILLAR 3: ABSTRACTION
// Public service operations hide Firebase calls, validation and transactions.
// Runtime abstract base contracts are in encapsulation.js.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, getAuth, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signOut, updateProfile, validatePassword } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { Timestamp, collection, doc, getDoc, getFirestore, onSnapshot, query, runTransaction, serverTimestamp, setDoc, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { LibraryUser, PasswordPolicy, BookCoverPalette } from "./encapsulation.js";
import { Student, Librarian, Book, StudentProfile, AdminProfile, AdminBook } from "./inheritance.js";
import { dashboardPath } from "./polymorphism.js";
import { normalizeSearch } from "./search-utils.js";

export class LoginService {
  #auth;
  #db;

  constructor(auth, db) {
    this.#auth = auth;
    this.#db = db;
  }

  async register(name, email, password) {
    if (
      !name.trim() ||
      name.trim().length > 100
    ) {
      throw new Error(
        "Enter your full name (up to 100 characters)."
      );
    }

    if (!PasswordPolicy.isValid(password)) {
      throw new Error(
        "Complete all password requirements before registering."
      );
    }

    await setPersistence(
      this.#auth,
      browserSessionPersistence
    );

    // Check the configured Firebase password policy too.
    const policy = await validatePassword(
      this.#auth,
      password
    );

    if (!policy.isValid) {
      throw new Error(
        "Your password does not meet the Firebase password policy. Check the requirements or contact the librarian."
      );
    }

    const credential =
      await createUserWithEmailAndPassword(
        this.#auth,
        email,
        password
      );

    let profileSaved = true;
    let verificationSent = true;
    let sessionCleared = true;

    try {
      await updateProfile(
        credential.user,
        {
          displayName: name.trim()
        }
      );
    } catch {
      profileSaved = false;
    }

    try {
      await sendEmailVerification(
        credential.user
      );
    } catch {
      verificationSent = false;
    }

    try {
      await signOut(this.#auth);
    } catch {
      sessionCleared = false;
    }

    return {
      profileSaved,
      verificationSent,
      sessionCleared
    };
  }

  async login(email, password, remember) {
    await setPersistence(
      this.#auth,
      remember
        ? browserLocalPersistence
        : browserSessionPersistence
    );

    const { user } =
      await signInWithEmailAndPassword(
        this.#auth,
        email,
        password
      );

    if (!user.emailVerified) {
      await signOut(this.#auth);

      const error = new Error(
        "Verify your email first. Re-enter your password to resend the verification email."
      );

      error.code = "app/email-unverified";
      throw error;
    }

    try {
      return await this.getAccount(user);
    } catch (error) {
      try {
        await signOut(this.#auth);
      } catch {
        // Preserve the original error.
      }

      throw error;
    }
  }

  async getAccount(user) {
    if (
      !user?.emailVerified ||
      this.#auth.currentUser?.uid !== user.uid
    ) {
      throw new Error(
        "Your session has changed. Please sign in again."
      );
    }

    const snapshot = await getDoc(
      doc(
        this.#db,
        "roles",
        user.uid
      )
    );

    if (
      this.#auth.currentUser?.uid !== user.uid
    ) {
      throw new Error(
        "Your session has changed. Please sign in again."
      );
    }

    const role = snapshot.exists()
      ? snapshot.data().role
      : "student";

    if (role === "admin") {
      return new Librarian(
        user.uid,
        user.displayName,
        user.email
      );
    }

    if (role === "student") {
      return new Student(
        user.uid,
        user.displayName,
        user.email
      );
    }

    throw new Error(
      "Invalid account role. Contact the librarian."
    );
  }

  async resendVerification(email, password) {
    await setPersistence(
      this.#auth,
      browserSessionPersistence
    );

    try {
      const { user } =
        await signInWithEmailAndPassword(
          this.#auth,
          email,
          password
        );

      if (user.emailVerified) {
        return {
          alreadyVerified: true
        };
      }

      await sendEmailVerification(user);

      return {
        alreadyVerified: false
      };
    } finally {
      if (this.#auth.currentUser) {
        await signOut(this.#auth);
      }
    }
  }

  async resetPassword(email) {
    try {
      await sendPasswordResetEmail(
        this.#auth,
        email
      );
    } catch (error) {
      // Keep the same response for nonexistent accounts.
      if (
        error.code !== "auth/user-not-found"
      ) {
        throw error;
      }
    }
  }

  openDashboard(account) {
    if (
      !(account instanceof LibraryUser) ||
      this.#auth.currentUser?.uid !==
        account.getUid()
    ) {
      throw new Error(
        "Your session has changed. Please sign in again."
      );
    }

    // [OOP] POLYMORPHISM CALL SITE: the runtime account class selects the method.
    // Actual polymorphism:
    // Student and Librarian provide different paths.
    window.location.replace(
      new URL(
        dashboardPath(account),
        new URL("../", import.meta.url)
      ).href
    );
  }
}

export class CatalogueService {
  static normalize(value) {
    return normalizeSearch(value);
  }

  getBooks(samples, inventory) {
    const merged = new Map(
      samples.map((book) => [book.id, { ...book }])
    );

    inventory.forEach((data, id) => {
      const previous = merged.get(id);

      merged.set(id, {
        ...previous,
        ...data,
        id,
        title: data.title || previous?.title || id,
        author: data.author || previous?.author || "Unknown author",
        category: data.category || previous?.category || "General"
      });
    });

    return [...merged].map(
      ([id, data]) =>
        new Book(id, data, inventory.has(id))
    );
  }
}

export class StudentProfileService {
  #db;
  #auth;

  constructor(db, auth) {
    this.#db = db;
    this.#auth = auth;
  }

  #assertSession(user) {
    if (
      !user?.emailVerified ||
      this.#auth.currentUser?.uid !== user.uid
    ) {
      throw new Error(
        "Your session changed. Sign in again."
      );
    }
  }

  listen(user, onProfile, onError) {
    this.#assertSession(user);

    return onSnapshot(
      doc(this.#db, "users", user.uid),
      (snapshot) => {
        onProfile(
          new StudentProfile(
            user,
            snapshot.exists() ? snapshot.data() : {}
          )
        );
      },
      onError
    );
  }

  async save(user, fullName, studentId, course) {
    this.#assertSession(user);

    StudentProfile.validate(
      fullName,
      studentId,
      course
    );

    const data = {
      fullName: fullName.trim(),
      studentId: studentId.trim(),
      course: course.trim(),
      email: user.email
    };

    await setDoc(
      doc(this.#db, "users", user.uid),
      {
        ...data,
        updatedAt: serverTimestamp()
      }
    );

    this.#assertSession(user);

    return new StudentProfile(user, data);
  }
}

export class BorrowingService {
  #db;
  #auth;

  constructor(db, auth) {
    this.#db = db;
    this.#auth = auth;
  }

  #assertSession(user) {
    if (
      !user?.emailVerified ||
      this.#auth.currentUser?.uid !== user.uid
    ) {
      throw new Error(
        "Your session changed. Sign in again."
      );
    }
  }

  async requestBook(user, profile, bookId) {
    this.#assertSession(user);

    if (
      !(profile instanceof StudentProfile) ||
      profile.id !== user.uid ||
      !profile.isComplete()
    ) {
      throw new Error(
        "Save your full name, Student ID, and course in Settings first."
      );
    }

    const requestRef = doc(
      collection(this.#db, "borrowRequests")
    );

    const lockRef = doc(
      this.#db,
      "borrowLocks",
      `${user.uid}_${bookId}`
    );

    await runTransaction(this.#db, async (transaction) => {
      this.#assertSession(user);

      const snapshot = await transaction.get(
        doc(this.#db, "books", bookId)
      );

      const lock = await transaction.get(lockRef);

      const book = snapshot.exists()
        ? new Book(bookId, snapshot.data(), true)
        : null;

      if (!book?.isAvailable()) {
        throw new Error(
          "Book not available. Please select another book."
        );
      }

      if (lock.exists()) {
        throw new Error(
          "You already have an active request for this book."
        );
      }

      transaction.set(requestRef, {
        studentUid: user.uid,
        bookId,
        status: "pending",
        requestedAt: serverTimestamp()
      });

      transaction.set(lockRef, {
        studentUid: user.uid,
        bookId,
        requestId: requestRef.id
      });

      // No inventory decrement while pending.
    });

    return requestRef.id;
  }

  async cancelRequest(user, requestId) {
    this.#assertSession(user);

    await runTransaction(this.#db, async (transaction) => {
      this.#assertSession(user);

      const requestRef = doc(
        this.#db,
        "borrowRequests",
        requestId
      );

      const snapshot = await transaction.get(requestRef);

      if (!snapshot.exists()) {
        throw new Error(
          "This request no longer exists."
        );
      }

      const data = snapshot.data();

      if (data.studentUid !== user.uid) {
        throw new Error(
          "You can only cancel your own request."
        );
      }

      if (data.status !== "pending") {
        throw new Error(
          "This request is no longer pending. Approved books must be returned through the librarian."
        );
      }

      const lockRef = doc(
        this.#db,
        "borrowLocks",
        `${user.uid}_${data.bookId}`
      );

      const lock = await transaction.get(lockRef);

      if (
        !lock.exists() ||
        lock.data().requestId !== requestId
      ) {
        throw new Error(
          "The active request record needs checking. Contact the librarian."
        );
      }

      transaction.update(requestRef, {
        status: "cancelled",
        cancelledAt: serverTimestamp()
      });

      transaction.delete(lockRef);
    });
  }
}

export class AdminProfileService {
  #auth;

  constructor(auth) {
    this.#auth = auth;
  }

  async updateName(profile, name) {
    const user = this.#auth.currentUser;

    if (
      !(profile instanceof AdminProfile) ||
      !user?.emailVerified ||
      user.uid !== profile.id
    ) {
      throw new Error("Your session changed. Sign in again.");
    }

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100
    ) {
      throw new Error("Enter a full name up to 100 characters.");
    }

    await updateProfile(user, {
      displayName: name.trim()
    });

    if (this.#auth.currentUser?.uid !== profile.id) {
      throw new Error("Your session changed. Sign in again.");
    }

    return new AdminProfile({
      uid: user.uid,
      displayName: name.trim(),
      email: user.email,
      emailVerified: user.emailVerified,
      photoURL: user.photoURL
    });
  }
}

export class AdminBorrowingService {
  #db;
  #auth;

  constructor(db, auth) {
    this.#db = db;
    this.#auth = auth;
  }

  #assertActor(profile) {
    if (
      !(profile instanceof AdminProfile) ||
      !this.#auth.currentUser?.emailVerified ||
      this.#auth.currentUser.uid !== profile.id
    ) {
      throw new Error("Your session changed. Sign in again.");
    }

    // Firestore Rules enforce the saved admin role.
  }

  approve(profile, requestId, dueAt) {
    return this.#process(profile, requestId, "approve", "", dueAt);
  }

  reject(profile, requestId, reason) {
    if (
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.trim().length > 500
    ) {
      throw new Error("Enter a rejection reason up to 500 characters.");
    }

    return this.#process(profile, requestId, "reject", reason.trim());
  }

  returnBook(profile, requestId) {
    return this.#process(profile, requestId, "return");
  }

  #validateDueDate(dueAt) {
    const millis = dueAt?.toMillis?.();

    if (!Number.isFinite(millis) || millis <= Date.now()) {
      throw new Error(
        "Select a due date and time later than the current time."
      );
    }
  }

  async #process(
    profile,
    requestId,
    action,
    reason = "",
    dueAt = null
  ) {
    this.#assertActor(profile);

    if (action === "approve") {
      this.#validateDueDate(dueAt);
    }

    await runTransaction(this.#db, async transaction => {
      this.#assertActor(profile);

      const requestRef = doc(this.#db, "borrowRequests", requestId);
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

      const bookRef = doc(this.#db, "books", data.bookId);

      const lockRef = doc(
        this.#db,
        "borrowLocks",
        `${data.studentUid}_${data.bookId}`
      );

      const bookSnapshot = await transaction.get(bookRef);
      const lock = await transaction.get(lockRef);

      if (
        !lock.exists() ||
        lock.data().requestId !== requestId ||
        lock.data().studentUid !== data.studentUid ||
        lock.data().bookId !== data.bookId
      ) {
        throw new Error(
          "The active borrowing record is inconsistent. Review it first."
        );
      }

      if (action === "reject") {
        transaction.update(requestRef, {
          status: "rejected",
          reason,
          reviewedAt: serverTimestamp(),
          reviewedBy: profile.id
        });

        transaction.delete(lockRef);
        return;
      }

      if (!bookSnapshot.exists()) {
        throw new Error("Book inventory needs correcting.");
      }

      const book = new AdminBook(
        data.bookId,
        bookSnapshot.data()
      );

      if (action === "approve") {
        this.#validateDueDate(dueAt);
        book.issueCopy();

        transaction.update(bookRef, {
          availableCopies: book.availableCopies
        });

        transaction.update(requestRef, {
          status: "approved",
          approvedAt: serverTimestamp(),
          approvedBy: profile.id,
          dueAt
        });
      } else {
        book.returnCopy();

        transaction.update(bookRef, {
          availableCopies: book.availableCopies
        });

        transaction.update(requestRef, {
          status: "returned",
          returnedAt: serverTimestamp(),
          returnedBy: profile.id
        });

        transaction.delete(lockRef);
      }
    });
  }
}

export class AdminCatalogueService {
  #db;
  #auth;
  #lastColor = "";

  constructor(db, auth) {
    this.#db = db;
    this.#auth = auth;
  }

  getBooks(samples, inventory) {
    const merged = new Map(
      samples.map(book => [book.id, { ...book }])
    );

    inventory.forEach((data, id) => {
      const previous = merged.get(id);

      merged.set(id, {
        ...previous,
        ...data,
        id,
        title: data.title || previous?.title || id,
        author: data.author || previous?.author || "Unknown author",
        category: data.category || previous?.category || "General"
      });
    });

    return [...merged]
      .map(
        ([id, data]) =>
          new AdminBook(id, data, inventory.has(id))
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async addBook(profile, values, usedColors = []) {
    const assertSession = () => {
      if (
        !(profile instanceof AdminProfile) ||
        !this.#auth.currentUser?.emailVerified ||
        this.#auth.currentUser.uid !== profile.id
      ) {
        throw new Error("Your session changed. Sign in again.");
      }
    };

    assertSession();

    const {
      id,
      title,
      author,
      category,
      availableCopies
    } = values;

    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9-]+$/.test(id) ||
      id.length > 100 ||
      ![title, author, category].every(
        value => typeof value === "string" && value.trim()
      ) ||
      title.length > 200 ||
      author.length > 150 ||
      category.length > 100 ||
      !Number.isSafeInteger(availableCopies) ||
      availableCopies < 0 ||
      availableCopies > 100000
    ) {
      throw new Error("Complete all fields with valid values.");
    }

    const cover = BookCoverPalette.pick(
      usedColors,
      this.#lastColor
    );

    const book = new AdminBook(id, {
      title: title.trim(),
      author: author.trim(),
      category: category.trim(),
      availableCopies,
      ...cover
    });

    await runTransaction(this.#db, async transaction => {
      assertSession();

      const ref = doc(this.#db, "books", id);
      const existing = await transaction.get(ref);

      if (existing.exists()) {
        throw new Error(
          "Book ID already exists. Use a different ID."
        );
      }

      transaction.set(ref, {
        ...book.toDocument(),
        createdAt: serverTimestamp()
      });
    });

    this.#lastColor = cover.color;
    return book;
  }

  async updateBook(profile, bookId, values) {
    const assertSession = () => {
      if (
        !(profile instanceof AdminProfile) ||
        !this.#auth.currentUser?.emailVerified ||
        this.#auth.currentUser.uid !== profile.id
      ) {
        throw new Error("Your session changed. Sign in again.");
      }
    };

    assertSession();

    const {
      title,
      author,
      category,
      addCopies = 0
    } = values;

    if (
      ![title, author, category].every(
        value => typeof value === "string" && value.trim()
      ) ||
      title.length > 200 ||
      author.length > 150 ||
      category.length > 100 ||
      !Number.isSafeInteger(addCopies) ||
      addCopies < 0 ||
      addCopies > 100000
    ) {
      throw new Error(
        "Complete all book fields and enter valid additional copies."
      );
    }

    await runTransaction(this.#db, async transaction => {
      assertSession();

      const ref = doc(this.#db, "books", bookId);
      const snapshot = await transaction.get(ref);

      if (!snapshot.exists()) {
        throw new Error(
          "This book no longer exists. Refresh the catalogue."
        );
      }

      const book = new AdminBook(
        bookId,
        snapshot.data()
      );

      // Use the latest stock inside the transaction.
      book.addCopies(addCopies);

      const changes = {
        title: title.trim(),
        author: author.trim(),
        category: category.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: profile.id
      };

      if (addCopies > 0) {
        changes.availableCopies = book.availableCopies;
      }

      // Keep Book ID, cover colors, and existing loans unchanged.
      transaction.update(ref, changes);
    });
  }
}

export class AdminFilterService {
  #collator = new Intl.Collator("en", {
    sensitivity: "base",
    numeric: true
  });

  static normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .trim();
  }

  static matches(query, fields) {
    const text = this.normalize(fields.join(" "));

    return this.normalize(query)
      .split(/\s+/)
      .filter(Boolean)
      .every(term => text.includes(term));
  }

  books(records, query, category, order) {
    return records
      .filter(book =>
        (
          category === "all" ||
          AdminFilterService.normalize(book.category) === category
        ) &&
        AdminFilterService.matches(query, [
          book.id,
          book.title,
          book.author,
          book.category
        ])
      )
      .sort((a, b) => {
        const result =
          this.#collator.compare(a.title, b.title) ||
          this.#collator.compare(a.id, b.id);

        return order === "title-desc"
          ? -result
          : result;
      });
  }

  transactions(
    records,
    query,
    order,
    profileFor,
    titleFor
  ) {
    return records
      .filter(request => {
        const profile = profileFor(request.studentUid);

        return AdminFilterService.matches(query, [
          profile.fullName,
          profile.studentId,
          profile.course,
          profile.email,
          request.studentUid,
          titleFor(request.bookId),
          request.bookId,
          request.id,
          request.status
        ]);
      })
      .sort((a, b) => {
        if (order === "newest" || order === "oldest") {
          const stamp = item =>
            (
              item.cancelledAt ||
              item.returnedAt ||
              item.reviewedAt ||
              item.approvedAt ||
              item.requestedAt
            )?.toMillis?.() || 0;

          return order === "oldest"
            ? stamp(a) - stamp(b)
            : stamp(b) - stamp(a);
        }

        const result = this.#collator.compare(
          profileFor(a.studentUid).fullName,
          profileFor(b.studentUid).fullName
        );

        return (
          order === "name-desc" ? -result : result
        ) || this.#collator.compare(a.id, b.id);
      });
  }
}
