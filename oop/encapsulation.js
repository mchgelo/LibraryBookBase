// PILLAR 1: ENCAPSULATION
// Private #fields and #methods control access to object state.
// Base classes also enforce runtime abstraction contracts.
// LoginController keeps form state private; PasswordPolicy and BookCoverPalette are helpers.


export class LibraryUser {
  #uid;
  #name;
  #email;

  constructor(uid, name, email) {
    if (new.target === LibraryUser) {
      throw new Error(
        "LibraryUser is abstract. Use Student or Librarian."
      );
    }

    if (
      typeof uid !== "string" ||
      !uid ||
      uid.includes("/")
    ) {
      throw new Error("Invalid account UID.");
    }

    this.#uid = uid;

    this.#name =
      typeof name === "string"
        ? name.trim()
        : "";

    this.#email =
      typeof email === "string"
        ? email
        : "";
  }

  getUid() {
    return this.#uid;
  }

  getDisplayName() {
    return this.#name || this.#email;
  }

  getEmail() {
    return this.#email;
  }

  getDashboardPath() {
    throw new Error(
      "A child class must implement getDashboardPath()."
    );
  }
}

export class LibraryRecord {
  #id;

  constructor(id) {
    if (new.target === LibraryRecord) {
      throw new Error("LibraryRecord is abstract.");
    }

    if (
      typeof id !== "string" ||
      !id ||
      id.includes("/")
    ) {
      throw new Error("Invalid record ID.");
    }

    this.#id = id;
  }

  getId() {
    return this.#id;
  }

  get id() {
    return this.#id;
  }

  getSummary() {
    throw new Error(
      "Implement getSummary() in the child class."
    );
  }
}

export class AdminRecord {
  #id;

  constructor(id) {
    if (new.target === AdminRecord) {
      throw new Error("AdminRecord is abstract.");
    }

    if (typeof id !== "string" || !id || id.includes("/")) {
      throw new Error("Invalid record ID.");
    }

    this.#id = id;
  }

  getId() { return this.#id; }
  get id() { return this.#id; }

  getSummary() {
    throw new Error("Implement getSummary() in the child class.");
  }
}

export class PasswordPolicy {
  static check(password) {
    return {
      length:
        password.length >= 8 &&
        password.length <= 16,

      uppercase: /[A-Z]/.test(password),

      lowercase: /[a-z]/.test(password),

      number: /[0-9]/.test(password),

      special:
        /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\/;'`~]/.test(password)
    };
  }

  static isValid(password) {
    return Object.values(
      this.check(password)
    ).every(Boolean);
  }
}

export class BookCoverPalette {
  static #colors = [
    { color: "#1E3A5F", ink: "#FFFFFF" },
    { color: "#3B5B46", ink: "#FFFFFF" },
    { color: "#6B3E26", ink: "#FFFFFF" },
    { color: "#5B3C6F", ink: "#FFFFFF" },
    { color: "#2D5C63", ink: "#FFFFFF" },
    { color: "#8A3C3C", ink: "#FFFFFF" },
    { color: "#F7D794", ink: "#1F2937" },
    { color: "#C8D5B9", ink: "#1F2937" },
    { color: "#C9D6EA", ink: "#1F2937" },
    { color: "#E7D7C1", ink: "#1F2937" }
  ];

  static pick(usedColors = [], lastColor = "") {
    const used = new Set(
      usedColors.map(color => String(color).toLowerCase())
    );

    let choices = this.#colors.filter(
      item =>
        !used.has(item.color.toLowerCase()) &&
        item.color !== lastColor
    );

    if (!choices.length) {
      choices = this.#colors.filter(item => item.color !== lastColor);
    }

    return {
      ...choices[Math.floor(Math.random() * choices.length)]
    };
  }
}

export class LoginController {
  #service;
  #ui;
  #registering = false;
  #busy = false;

  constructor(service) {
    this.#service = service;

    const ids = [
      "login-form",
      "username",
      "password",
      "full-name",
      "confirm-password",
      "registration-fields",
      "confirm-field",
      "login-options",
      "form-title",
      "form-description",
      "submit-button",
      "switch-mode",
      "switch-description",
      "forgot-password",
      "toggle-password",
      "resend-verification",
      "message",
      "message-title",
      "message-text",
      "dismiss-message",
      "password-requirements"
    ];

    this.#ui = Object.fromEntries(
      ids.map((id) => [
        id,
        document.getElementById(id)
      ])
    );

    if (
      Object.values(this.#ui).some(
        (value) => !value
      )
    ) {
      throw new Error(
        "Login HTML is incomplete. Use the matching updated login.html."
      );
    }

    this.#ui.remember =
      this.#ui["login-form"].querySelector(
        '[name="remember"]'
      );
  }

  start() {
    const ui = this.#ui;

    ui["login-form"].addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        this.#submit();
      }
    );

    ui["switch-mode"].addEventListener(
      "click",
      () => {
        if (this.#busy) return;

        this.#setMode(
          !this.#registering
        );

        const target = this.#registering
          ? ui["full-name"]
          : ui.username;

        target.focus();
      }
    );

    ui["toggle-password"].addEventListener(
      "click",
      () => {
        const visible =
          ui.password.type === "password";

        ui.password.type =
          visible ? "text" : "password";

        ui["confirm-password"].type =
          visible ? "text" : "password";

        ui["toggle-password"].textContent =
          visible ? "Hide" : "Show";

        ui["toggle-password"].setAttribute(
          "aria-pressed",
          String(visible)
        );
      }
    );

    ui.password.addEventListener(
      "input",
      () => this.#updateRequirements()
    );

    ui["forgot-password"].addEventListener(
      "click",
      () => this.#resetPassword()
    );

    ui["resend-verification"].addEventListener(
      "click",
      () => this.#resend()
    );

    ui["dismiss-message"].addEventListener(
      "click",
      () => {
        ui.message.hidden = true;
      }
    );

    this.#setMode(false);
  }

  #setMode(registering) {
    const ui = this.#ui;

    this.#registering = registering;

    ui["registration-fields"].hidden =
      !registering;

    ui["confirm-field"].hidden =
      !registering;

    ui["password-requirements"].hidden =
      !registering;

    ui["login-options"].hidden =
      registering;

    ui["full-name"].disabled =
      !registering;

    ui["full-name"].required =
      registering;

    ui["confirm-password"].disabled =
      !registering;

    ui["confirm-password"].required =
      registering;

    ui.password.autocomplete = registering
      ? "new-password"
      : "current-password";

    ui.password.maxLength = registering
      ? 16
      : 4096;

    if (registering) {
      ui.password.minLength = 8;
    } else {
      ui.password.removeAttribute(
        "minlength"
      );
    }

    ui.password.value = "";
    ui["confirm-password"].value = "";

    ui.password.type = "password";
    ui["confirm-password"].type =
      "password";

    ui["toggle-password"].textContent =
      "Show";

    ui["toggle-password"].setAttribute(
      "aria-pressed",
      "false"
    );

    ui["form-title"].textContent =
      registering
        ? "Create your account"
        : "Welcome back";

    ui["form-description"].textContent =
      registering
        ? "Register for a student library account. Complete the password requirements below."
        : "Sign in to access your library account.";

    ui["switch-description"].textContent =
      registering
        ? "Already have an account?"
        : "Need an account?";

    ui["switch-mode"].textContent =
      registering
        ? "Sign in here"
        : "Register here";

    ui["resend-verification"].hidden = true;
    ui.message.hidden = true;

    this.#setBusy(this.#busy);
    this.#updateRequirements();
  }

  #setBusy(busy) {
    this.#busy = busy;

    const ui = this.#ui;

    [
      "submit-button",
      "switch-mode",
      "forgot-password",
      "resend-verification",
      "toggle-password"
    ].forEach((id) => {
      ui[id].disabled = busy;
    });

    [
      "username",
      "password",
      "full-name",
      "confirm-password"
    ].forEach((id) => {
      ui[id].readOnly = busy;
    });

    ui.remember.disabled = busy;

    ui["login-form"].setAttribute(
      "aria-busy",
      String(busy)
    );

    ui["submit-button"].textContent =
      busy
        ? "Please wait..."
        : this.#registering
          ? "Create account →"
          : "Sign in →";
  }

  #notify(text, type = "success") {
    const ui = this.#ui;

    ui.message.className =
      `notice ${type}`;

    ui["message-title"].textContent =
      type === "error"
        ? "Action failed"
        : type === "info"
          ? "Please wait"
          : "Successful";

    ui["message-text"].textContent =
      text;

    ui.message.setAttribute(
      "role",
      type === "error"
        ? "alert"
        : "status"
    );

    ui.message.setAttribute(
      "aria-live",
      type === "error"
        ? "assertive"
        : "polite"
    );

    ui.message.hidden = false;
  }

  #updateRequirements() {
    const checks = PasswordPolicy.check(
      this.#ui.password.value
    );

    this.#ui["password-requirements"]
      .querySelectorAll("[data-rule]")
      .forEach((item) => {
        const met =
          checks[item.dataset.rule];

        item.dataset.met = String(met);

        item.querySelector("span")
          .textContent = met ? "✓" : "○";

        item.setAttribute(
          "aria-label",
          `${item.dataset.label}: ${
            met ? "met" : "not met"
          }`
        );
      });
  }

  #validEmail() {
    const input = this.#ui.username;

    input.value = input.value.trim();

    if (input.checkValidity()) {
      return true;
    }

    this.#notify(
      "Enter a valid email address.",
      "error"
    );

    input.reportValidity();
    return false;
  }

  async #submit() {
    if (
      this.#busy ||
      !this.#validEmail()
    ) {
      return;
    }

    const ui = this.#ui;

    ui["full-name"].value =
      ui["full-name"].value.trim();

    if (
      !ui["login-form"].checkValidity()
    ) {
      this.#notify(
        "Complete all required fields with valid values.",
        "error"
      );

      ui["login-form"].reportValidity();
      return;
    }

    if (
      this.#registering &&
      !ui["full-name"].value
    ) {
      this.#notify(
        "Enter your full name.",
        "error"
      );

      ui["full-name"].focus();
      return;
    }

    if (
      this.#registering &&
      !PasswordPolicy.isValid(
        ui.password.value
      )
    ) {
      this.#notify(
        "Use 8–128 characters with uppercase, lowercase, a number, and a special character such as ! @ # $.",
        "error"
      );

      ui.password.focus();
      return;
    }

    if (
      this.#registering &&
      ui.password.value !==
        ui["confirm-password"].value
    ) {
      this.#notify(
        "Passwords do not match.",
        "error"
      );

      ui["confirm-password"].focus();
      return;
    }

    this.#setBusy(true);

    ui["resend-verification"].hidden =
      true;

    try {
      this.#notify(
        this.#registering
          ? "Creating your account..."
          : "Signing in...",
        "info"
      );

      if (this.#registering) {
        const result =
          await this.#service.register(
            ui["full-name"].value,
            ui.username.value,
            ui.password.value
          );

        this.#setMode(false);

        const issues = [];

        if (!result.profileSaved) {
          issues.push(
            "Your name could not be saved; contact the librarian."
          );
        }

        if (!result.verificationSent) {
          issues.push(
            "The verification email could not be sent. Re-enter your password and use Resend verification email."
          );

          ui["resend-verification"].hidden =
            false;
        }

        if (!result.sessionCleared) {
          issues.push(
            "Your session could not be closed. Refresh and try signing in again."
          );
        }

        this.#notify(
          issues.length
            ? `Account created, but ${issues.join(" ")}`
            : "Account created successfully! Check your inbox or Spam folder and verify your email before signing in.",
          issues.length
            ? "error"
            : "success"
        );
      } else {
        const account =
          await this.#service.login(
            ui.username.value,
            ui.password.value,
            ui.remember.checked
          );

        ui.password.value = "";

        this.#notify(
          `Signed in successfully. Welcome, ${account.getDisplayName()}!`
        );

        await new Promise((resolve) => {
          setTimeout(resolve, 650);
        });

        this.#service.openDashboard(
          account
        );
      }
    } catch (error) {
      if (
        error.code ===
          "app/email-unverified"
      ) {
        ui["resend-verification"].hidden =
          false;

        ui.password.value = "";
      }

      this.#notify(
        this.#errorText(error),
        "error"
      );
    } finally {
      this.#setBusy(false);
    }
  }

  async #resetPassword() {
    if (
      this.#busy ||
      !this.#validEmail()
    ) {
      return;
    }

    this.#setBusy(true);

    this.#notify(
      "Requesting a password reset...",
      "info"
    );

    try {
      await this.#service.resetPassword(
        this.#ui.username.value
      );

      this.#notify(
        "If an account exists for this email, a reset link will be sent. Check your inbox and Spam folder."
      );
    } catch (error) {
      this.#notify(
        this.#errorText(error),
        "error"
      );
    } finally {
      this.#setBusy(false);
    }
  }

  async #resend() {
    if (
      this.#busy ||
      !this.#validEmail()
    ) {
      return;
    }

    if (
      !this.#ui.password.reportValidity()
    ) {
      this.#notify(
        "Re-enter your password to resend the verification email.",
        "error"
      );

      return;
    }

    this.#setBusy(true);

    this.#notify(
      "Requesting a verification email...",
      "info"
    );

    try {
      const result =
        await this.#service.resendVerification(
          this.#ui.username.value,
          this.#ui.password.value
        );

      this.#notify(
        result.alreadyVerified
          ? "Your email is already verified. You can sign in."
          : "Verification email sent successfully. Check your inbox and Spam folder."
      );

      if (result.alreadyVerified) {
        this.#ui["resend-verification"]
          .hidden = true;
      }
    } catch (error) {
      this.#notify(
        this.#errorText(error),
        "error"
      );
    } finally {
      this.#ui.password.value = "";
      this.#setBusy(false);
    }
  }

  #errorText(error) {
    const messages = {
      "auth/email-already-in-use":
        "Unable to register this email. Try signing in or resetting your password.",

      "auth/invalid-email":
        "Enter a valid email address.",

      "auth/weak-password":
        "Use a password that meets all the requirements.",

      "auth/password-does-not-meet-requirements":
        "Your password does not meet the Firebase password requirements.",

      "auth/invalid-credential":
        "Incorrect email or password.",

      "auth/user-not-found":
        "Incorrect email or password.",

      "auth/wrong-password":
        "Incorrect email or password.",

      "auth/user-disabled":
        "This account is disabled. Contact the librarian.",

      "auth/too-many-requests":
        "Too many attempts. Please try again later.",

      "auth/network-request-failed":
        "Check your internet connection and try again.",

      "unavailable":
        "Check your internet connection and try again.",

      "permission-denied":
        "Unable to read your account role. Contact the librarian to check Firestore Rules.",

      "auth/operation-not-allowed":
        "Email/password sign-in is unavailable. Contact the librarian.",

      "auth/unauthorized-domain":
        "This website address is not authorized in Firebase Authentication. Contact the librarian."
    };

    if (messages[error.code]) {
      return messages[error.code];
    }

    return error.code
      ? "Unable to complete the request. Please try again."
      : error.message ||
        "Unable to complete the request. Please try again.";
  }
}
