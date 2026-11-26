// PAGE ENTRY: Firebase setup, UI events and live data.
// Open oop/ for the four presentation modules.
import { LibraryUser, PasswordPolicy, LoginController } from "./oop/encapsulation.js";
import { Student, Librarian } from "./oop/inheritance.js";
import { LoginService } from "./oop/abstraction.js";
export { LibraryUser, Student, Librarian, PasswordPolicy, LoginService, LoginController };

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
  signOut,
  validatePassword
} from
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc
} from
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";


// Firebase setup and page startup. OOP implementations are imported above.

const app = initializeApp({
  apiKey:
    "AIzaSyAI-ZTiaClMvISqvG5KIJW8rA_YQ0rukbw",

  authDomain:
    "library-db9da.firebaseapp.com",

  projectId:
    "library-db9da",

  storageBucket:
    "library-db9da.firebasestorage.app",

  messagingSenderId:
    "938072556708",

  appId:
    "1:938072556708:web:39370090740ce6125a9231",

  measurementId:
    "G-9W3G6V3WF2"
});

new LoginController(
  new LoginService(
    getAuth(app),
    getFirestore(app)
  )
).start();