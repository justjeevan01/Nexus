import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// --- YOUR LIVE FIREBASE CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyAFhKjh4EOB6pSOzPf6dphV3po62lHHjfk",
  authDomain: "nexus-f89db.firebaseapp.com",
  projectId: "nexus-f89db",
  storageBucket: "nexus-f89db.firebasestorage.app",
  messagingSenderId: "401131215906",
  appId: "1:401131215906:web:c4283363f9f3ed535dfe7b",
  measurementId: "G-85H409EKTR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);
