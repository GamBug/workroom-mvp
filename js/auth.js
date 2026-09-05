/**
 * auth.js - Authentication UI and API Integration for Workroom Mini
 * 
 * Handles:
 * - Switching between Log In and Sign Up views.
 * - Enforcing keyboard navigation (Enter key progression through fields).
 * - Client-side validation and inline error presentation.
 * - Submitting credentials to the Flask backend and managing loading states.
 */

document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const tabLogin = document.getElementById("tab-login");
  const tabSignup = document.getElementById("tab-signup");
  const loginPanel = document.getElementById("login-panel");
  const signupPanel = document.getElementById("signup-panel");
  const errorBanner = document.getElementById("auth-error");

  const loginForm = document.getElementById("login-form");
  const loginUsername = document.getElementById("login-username");
  const loginPassword = document.getElementById("login-password");
  const loginSubmitBtn = document.getElementById("login-submit-btn");

  const signupForm = document.getElementById("signup-form");
  const signupUsername = document.getElementById("signup-username");
  const signupPassword = document.getElementById("signup-password");
  const signupConfirm = document.getElementById("signup-confirm");
  const signupSubmitBtn = document.getElementById("signup-submit-btn");

  // Helper to show inline errors
  function showError(message) {
    if (!errorBanner) return;
    errorBanner.textContent = message;
    errorBanner.style.display = "block";
  }

  // Helper to clear inline errors
  function clearError() {
    if (!errorBanner) return;
    errorBanner.textContent = "";
    errorBanner.style.display = "none";
  }

  // Tab switching logic
  function activateTab(tabName) {
    clearError();
    if (tabName === "login") {
      tabLogin.classList.add("active");
      tabLogin.setAttribute("aria-selected", "true");
      tabSignup.classList.remove("active");
      tabSignup.setAttribute("aria-selected", "false");

      loginPanel.style.display = "block";
      signupPanel.style.display = "none";
      loginUsername.focus();
    } else {
      tabSignup.classList.add("active");
      tabSignup.setAttribute("aria-selected", "true");
      tabLogin.classList.remove("active");
      tabLogin.setAttribute("aria-selected", "false");

      signupPanel.style.display = "block";
      loginPanel.style.display = "none";
      signupUsername.focus();
    }
  }

  tabLogin.addEventListener("click", () => activateTab("login"));
  tabSignup.addEventListener("click", () => activateTab("signup"));

  // ===================================================================
  // KEYBOARD NAVIGATION UX
  // Requirements:
  // On login:
  //   Username -> Enter -> Password
  //   Password -> Enter -> Login
  // On sign up:
  //   Username -> Enter -> Password
  //   Password -> Enter -> Confirm password
  //   Confirm password -> Enter -> Create account
  // ===================================================================

  // Login inputs Enter key handling
  loginUsername.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loginPassword.focus();
    }
  });

  // Sign-up inputs Enter key handling
  signupUsername.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      signupPassword.focus();
    }
  });

  signupPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      signupConfirm.focus();
    }
  });

  // ===================================================================
  // FORM SUBMISSION & API CALLS
  // ===================================================================

  // Handle Log In
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    if (!username) {
      showError("Please enter your username.");
      loginUsername.focus();
      return;
    }
    if (!password) {
      showError("Please enter your password.");
      loginPassword.focus();
      return;
    }

    // Disable button to prevent duplicate submissions
    loginSubmitBtn.disabled = true;
    const originalText = loginSubmitBtn.textContent;
    loginSubmitBtn.textContent = "Logging in...";

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (response.ok && data.ok) {
        // Successful login, navigate to Workroom
        window.location.href = "/workroom";
      } else {
        showError(data.error || "Login failed. Please check your credentials.");
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = originalText;
      }
    } catch (err) {
      showError("Unable to reach server. Please ensure the local server is running.");
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = originalText;
    }
  });

  // Handle Sign Up
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const username = signupUsername.value.trim();
    const password = signupPassword.value;
    const confirmPassword = signupConfirm.value;

    if (!username) {
      showError("Please choose a username.");
      signupUsername.focus();
      return;
    }
    if (username.length < 2) {
      showError("Username must be at least 2 characters long.");
      signupUsername.focus();
      return;
    }
    if (!password) {
      showError("Please enter a password.");
      signupPassword.focus();
      return;
    }
    if (password.length < 6) {
      showError("Password must be at least 6 characters long.");
      signupPassword.focus();
      return;
    }
    if (password !== confirmPassword) {
      showError("Passwords do not match. Please verify.");
      signupConfirm.focus();
      return;
    }

    // Disable button to prevent duplicate submissions
    signupSubmitBtn.disabled = true;
    const originalText = signupSubmitBtn.textContent;
    signupSubmitBtn.textContent = "Creating account...";

    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          confirm_password: confirmPassword
        })
      });

      const data = await response.json();

      if (response.ok && data.ok) {
        // Successful signup logs the user in automatically via session
        window.location.href = "/workroom";
      } else {
        showError(data.error || "Sign-up failed. Please try another username.");
        signupSubmitBtn.disabled = false;
        signupSubmitBtn.textContent = originalText;
      }
    } catch (err) {
      showError("Unable to reach server. Please ensure the local server is running.");
      signupSubmitBtn.disabled = false;
      signupSubmitBtn.textContent = originalText;
    }
  });
});
