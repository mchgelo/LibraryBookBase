// PILLAR 2: INHERITANCE
// Actual child classes use extends and super(...).
// Their overridden methods also supply the implementations used in polymorphism.js.

import { LibraryUser, LibraryRecord, AdminRecord } from "./encapsulation.js";
import { normalizeSearch } from "./search-utils.js";

export class Student extends LibraryUser {
  constructor(uid, name, email) {
    super(uid, name, email);
  }

  getDashboardPath() {
    return "./student.html";
  }
}

export class Librarian extends LibraryUser {
  constructor(uid, name, email) {
    super(uid, name, email);
  }

  getDashboardPath() {
    return "./adminfiles/admin.html";
  }
}

export class Book extends LibraryRecord {
  #data;
  #registered;

  constructor(id, data, registered = false) {
    super(id);

    this.#data = { ...data };
    this.#registered = registered;
  }

  get title() {
    return this.#data.title || this.id;
  }

  get author() {
    return this.#data.author || "Unknown author";
  }

  get category() {
    return this.#data.category || "General";
  }

  get color() {
    return this.#data.color || "#738baa";
  }

  get ink() {
    return this.#data.ink || "#ffffff";
  }

  get availableCopies() {
    return this.#registered
      ? this.#data.availableCopies
      : undefined;
  }

  isAvailable() {
    return Number.isSafeInteger(this.availableCopies) &&
      this.availableCopies > 0;
  }

  getSummary() {
    return {
      title: this.title,
      subtitle: this.author
    };
  }

  matchesSearch(searchText) {
    const searchable = normalizeSearch(
      `${this.id} ${this.title} ${this.author} ${this.category}`
    );

    const terms = normalizeSearch(searchText)
      .split(/\s+/)
      .filter(Boolean);

    return terms.every((term) => searchable.includes(term));
  }

  matchesCategory(category) {
    return category === "All" ||
      normalizeSearch(this.category) ===
        normalizeSearch(category);
  }
}

export class StudentProfile extends LibraryRecord {
  #user;
  #data;

  constructor(user, data = {}) {
    super(user.uid);

    this.#user = {
      displayName: user.displayName,
      email: user.email,
      emailVerified: user.emailVerified
    };

    this.#data = { ...data };
  }

  get fullName() {
    const savedName =
      typeof this.#data.fullName === "string"
        ? this.#data.fullName.trim()
        : "";

    return savedName ||
      this.#user.displayName ||
      this.email ||
      "Student";
  }

  get studentId() {
    return this.#data.studentId || "";
  }

  get course() {
    return this.#data.course || "";
  }

  get email() {
    return this.#user.email || "";
  }

  get emailVerified() {
    return this.#user.emailVerified === true;
  }

  getSummary() {
    return {
      title: this.fullName,
      subtitle: this.email
    };
  }

  isComplete() {
    return ["fullName", "studentId", "course"].every(
      (key) =>
        typeof this.#data[key] === "string" &&
        this.#data[key].trim()
    );
  }

  toData() {
    return {
      fullName: this.fullName,
      studentId: this.studentId,
      course: this.course,
      email: this.email
    };
  }

  static validate(fullName, studentId, course) {
    const missing = [fullName, studentId, course].some(
      (value) =>
        typeof value !== "string" ||
        !value.trim()
    );

    if (
      missing ||
      fullName.trim().length > 100 ||
      studentId.trim().length > 40 ||
      course.trim().length > 100
    ) {
      throw new Error(
        "Enter your full name, Student ID, and course within the allowed lengths."
      );
    }
  }
}

export class AdminProfile extends AdminRecord {
  #data;

  constructor(user) {
    super(user.uid);

    this.#data = {
      name: user.displayName || "",
      email: user.email || "",
      verified: user.emailVerified === true,
      photoURL: user.photoURL || ""
    };
  }

  get name() { return this.#data.name.trim() || this.email || "Admin"; }
  get email() { return this.#data.email; }
  get verified() { return this.#data.verified; }
  get photoURL() { return this.#data.photoURL; }

  getSummary() {
    return { title: this.name, subtitle: this.email };
  }
}

export class AdminBook extends AdminRecord {
  #data;
  #copies;
  #registered;

  constructor(id, data, registered = true) {
    super(id);
    this.#data = { ...data };
    this.#copies = data.availableCopies;
    this.#registered = registered;
  }

  get title() { return this.#data.title || this.id; }
  get author() { return this.#data.author || "Unknown author"; }
  get category() { return this.#data.category || "General"; }
  get color() { return this.#data.color || "#738baa"; }
  get ink() { return this.#data.ink || "#ffffff"; }
  get availableCopies() { return this.#copies; }
  get registered() { return this.#registered; }

  getSummary() {
    return { title: this.title, subtitle: this.author };
  }

  isInventoryValid() {
    return Number.isSafeInteger(this.#copies) && this.#copies >= 0;
  }

  issueCopy() {
    if (!this.isInventoryValid()) {
      throw new Error("Book inventory needs correcting.");
    }

    if (this.#copies <= 0) {
      throw new Error("No copies available. The request was not approved.");
    }

    this.#copies -= 1;
  }

  addCopies(count) {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 100000 ||
      !this.isInventoryValid() ||
      !Number.isSafeInteger(this.#copies + count)
    ) {
      throw new Error("Enter a valid number of additional copies (0–100000).");
    }

    this.#copies += count;
  }

  returnCopy() {
    if (
      !this.isInventoryValid() ||
      this.#copies >= Number.MAX_SAFE_INTEGER
    ) {
      throw new Error("Book inventory needs correcting.");
    }

    this.#copies += 1;
  }

  toDocument() {
    return {
      title: this.title,
      author: this.author,
      category: this.category,
      availableCopies: this.#copies,
      color: this.color,
      ink: this.ink
    };
  }
}
