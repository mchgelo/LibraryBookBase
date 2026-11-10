import { initializeApp } from
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signOut
} from
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const form = document.getElementById("login-form");
const emailInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const fullNameInput = document.getElementById("full-name");
const confirmInput = document.getElementById("confirm-password");

const registrationFields = document.getElementById("registration-fields");
const confirmField = document.getElementById("confirm-field");
const options = document.querySelector(".options");
const rememberInput = form.querySelector('[name="remember"]');

const title = document.getElementById("form-title");
const description = document.getElementById("form-description");
const message = document.getElementById("message");
const submitButton = document.getElementById("submit-button");
const switchButton = document.getElementById("switch-mode");
const switchDescription = document.getElementById("switch-description");
const forgotButton = document.getElementById("forgot-password");
const togglePassword = document.getElementById("toggle-password");
const resendButton = document.getElementById("resend-verification");

let registering = false;
let busy = false;

function showMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#b42318" : "#15547a";
}

function setBusy(value) {
  busy = value;

  [
    submitButton,
    switchButton,
    forgotButton,
    resendButton
  ].forEach((button) => {
    button.disabled = value;
  });

  // Prevent account details changing during a request.
  emailInput.readOnly = value;
  passwordInput.readOnly = value;
  fullNameInput.readOnly = value;
  confirmInput.readOnly = value;
  rememberInput.disabled = value;

  submitButton.textContent = value
    ? "Please wait..."
    : registering
      ? "Create account →"
      : "Sign in →";
}

function setMode(isRegistration) {
  registering = isRegistration;

  registrationFields.hidden = !registering;
  confirmField.hidden = !registering;
  options.hidden = registering;

  fullNameInput.disabled = !registering;
  fullNameInput.required = registering;

  confirmInput.disabled = !registering;
  confirmInput.required = registering;

  passwordInput.autocomplete = registering
    ? "new-password"
    : "current-password";

  if (registering) {
    passwordInput.minLength = 8;
  } else {
    passwordInput.removeAttribute("minlength");
  }

  passwordInput.value = "";
  confirmInput.value = "";
  passwordInput.type = "password";

  togglePassword.textContent = "Show";
  togglePassword.setAttribute("aria-pressed", "false");

  title.textContent = registering
    ? "Create your account"
    : "Welcome back";

  description.textContent = registering
    ? "Register for a student library account. Use at least 8 characters for your password."
    : "Sign in to access your library account.";

  submitButton.textContent = registering
    ? "Create account →"
    : "Sign in →";

  switchDescription.textContent = registering
    ? "Already have an account?"
    : "Need an account?";

  switchButton.textContent = registering
    ? "Sign in here"
    : "Register here";

  resendButton.hidden = true;
  showMessage("");
}

function errorMessage(error) {
  console.error("Firebase request failed:", error.code);

  switch (error.code) {
    case "auth/email-already-in-use":
      return "Unable to register this email. Try signing in or resetting your password.";

    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Please use a stronger password.";

    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Incorrect email or password.";

    case "auth/user-disabled":
      return "This account has been disabled. Contact the librarian.";

    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";

    case "auth/network-request-failed":
    case "unavailable":
      return "Check your internet connection and try again.";

    case "permission-denied":
      return "Unable to read your account role. Check the Firestore Rules.";

    case "auth/operation-not-allowed":
      return "Enable Email/Password in Firebase Authentication.";

    default:
      return `Unable to complete the request (${error.code || "unknown error"}).`;
  }
}

async function openDashboard(user) {
  let destination;

  try {
    const roleDocument = await getDoc(
      doc(db, "roles", user.uid)
    );

    const role = roleDocument.exists()
      ? roleDocument.data().role
      : "student";

    if (role === "admin") {
      destination = "./admin.html";
    } else if (role === "student") {
      destination = "./student.html";
    } else {
      throw new Error("Invalid account role.");
    }
  } catch (error) {
    await signOut(auth);

    showMessage(
      error.code
        ? errorMessage(error)
        : "Invalid account role. Contact the librarian.",
      true
    );

    return;
  }

  showMessage("Successfully signed in! Opening dashboard...");
  window.location.assign(destination);
}

switchButton.addEventListener("click", () => {
  if (busy) return;

  setMode(!registering);

  if (registering) {
    fullNameInput.focus();
  } else {
    emailInput.focus();
  }
});

togglePassword.addEventListener("click", () => {
  const show = passwordInput.type === "password";

  passwordInput.type = show ? "text" : "password";
  togglePassword.textContent = show ? "Hide" : "Show";
  togglePassword.setAttribute("aria-pressed", String(show));
});

// Pressing Enter or clicking Sign in submits this form.
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (busy) return;

  emailInput.value = emailInput.value.trim();
  fullNameInput.value = fullNameInput.value.trim();

  if (!form.reportValidity()) return;

  if (registering && !fullNameInput.value) {
    showMessage("Please enter your full name.", true);
    fullNameInput.focus();
    return;
  }

  if (registering && passwordInput.value !== confirmInput.value) {
    showMessage("Passwords do not match.", true);
    confirmInput.focus();
    return;
  }

  setBusy(true);
  resendButton.hidden = true;
  showMessage("");

  try {
    await setPersistence(
      auth,
      !registering && rememberInput.checked
        ? browserLocalPersistence
        : browserSessionPersistence
    );

    if (registering) {
      const credential = await createUserWithEmailAndPassword(
        auth,
        emailInput.value,
        passwordInput.value
      );

      let profileSaved = true;
      let verificationSent = true;

      try {
        await updateProfile(credential.user, {
          displayName: fullNameInput.value
        });
      } catch {
        profileSaved = false;
      }

      try {
        await sendEmailVerification(credential.user);
      } catch {
        verificationSent = false;
      }

      await signOut(auth);
      setMode(false);

      let result = verificationSent
        ? "Account created! Check your inbox or Spam folder and verify your email before signing in."
        : "Account created, but the verification email could not be sent. Sign in to resend it.";

      if (!profileSaved) {
        result += " Your name could not be saved. Contact the librarian to update it.";
      }

      showMessage(result);
      return;
    }

    const credential = await signInWithEmailAndPassword(
      auth,
      emailInput.value,
      passwordInput.value
    );

    passwordInput.value = "";

    if (!credential.user.emailVerified) {
      await signOut(auth);
      resendButton.hidden = false;

      showMessage(
        "Verify your email first. To resend the verification email, re-enter your password and click Resend verification email.",
        true
      );

      return;
    }

    await openDashboard(credential.user);
  } catch (error) {
    showMessage(errorMessage(error), true);
  } finally {
    setBusy(false);
  }
});

resendButton.addEventListener("click", async () => {
  if (busy) return;

  emailInput.value = emailInput.value.trim();

  if (!form.reportValidity()) return;

  setBusy(true);
  showMessage("");

  try {
    // Use a temporary session for verification.
    await setPersistence(auth, browserSessionPersistence);

    const credential = await signInWithEmailAndPassword(
      auth,
      emailInput.value,
      passwordInput.value
    );

    if (credential.user.emailVerified) {
      showMessage("Your email is already verified. You can sign in.");
      resendButton.hidden = true;
    } else {
      await sendEmailVerification(credential.user);

      showMessage(
        "Verification email sent. Check your inbox and Spam folder."
      );
    }
  } catch (error) {
    showMessage(errorMessage(error), true);
  } finally {
    try {
      if (auth.currentUser) {
        await signOut(auth);
      }
    } finally {
      passwordInput.value = "";
      setBusy(false);
    }
  }
});

forgotButton.addEventListener("click", async () => {
  if (busy) return;

  emailInput.value = emailInput.value.trim();

  if (!emailInput.reportValidity()) return;

  setBusy(true);
  showMessage("Requesting password reset...");

  const resetMessage =
    "If an account exists for this email, a reset link will be sent. Check your inbox and Spam folder.";

  try {
    await sendPasswordResetEmail(auth, emailInput.value);
    showMessage(resetMessage);
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      showMessage(resetMessage);
    } else {
      showMessage(errorMessage(error), true);
    }
  } finally {
    setBusy(false);
  }
});

setMode(false);