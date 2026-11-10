const authForm = document.querySelector("#auth-form");
const formAlert = document.querySelector("#form-alert");
const mode = authForm.dataset.authMode;
const passwordInput = document.querySelector("#password");
const passwordToggle = document.querySelector("#password-toggle");
const identifierInput = document.querySelector("#identifier");
const emailInput = document.querySelector("#email");
const phoneInput = document.querySelector("#phone");
const forgotPassword = document.querySelector("#forgot-password");
const submitButton = authForm.querySelector('button[type="submit"]');

function isValidPhone(value) {
  const trimmedValue = value.trim();
  const digits = trimmedValue.replace(/\D/g, "");
  return /^\+?[0-9\s().-]+$/.test(trimmedValue) && digits.length >= 7 && digits.length <= 15;
}

function isValidEmailOrPhone(value) {
  const trimmedValue = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedValue) || isValidPhone(trimmedValue);
}

function showMessage(message, type) {
  formAlert.className = `alert alert-${type}`;
  formAlert.textContent = message;
}

if (passwordToggle) {
  passwordToggle.addEventListener("click", () => {
    const isVisible = passwordInput.type === "text";
    passwordInput.type = isVisible ? "password" : "text";
    passwordToggle.textContent = isVisible ? "Show" : "Hide";
    passwordToggle.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
    passwordToggle.setAttribute("aria-pressed", String(!isVisible));
  });
}

if (forgotPassword) {
  forgotPassword.addEventListener("click", (event) => {
    event.preventDefault();
    showMessage("Password reset is not available yet.", "info");
  });
}

if (identifierInput) {
  identifierInput.addEventListener("input", () => {
    identifierInput.setCustomValidity(
      identifierInput.value && !isValidEmailOrPhone(identifierInput.value)
        ? "Enter a valid email address or phone number."
        : ""
    );
  });
}

if (phoneInput) {
  phoneInput.addEventListener("input", () => {
    phoneInput.setCustomValidity(
      phoneInput.value && !isValidPhone(phoneInput.value)
        ? "Enter a valid phone number."
        : ""
    );
  });
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authForm.classList.add("was-validated");
  formAlert.className = "alert d-none";

  if (identifierInput) {
    identifierInput.setCustomValidity(
      isValidEmailOrPhone(identifierInput.value)
        ? ""
        : "Enter a valid email address or phone number."
    );
  }

  if (phoneInput) {
    phoneInput.setCustomValidity(
      isValidPhone(phoneInput.value) ? "" : "Enter a valid phone number."
    );
  }

  if (!authForm.checkValidity()) {
    const firstInvalidField = authForm.querySelector(":invalid");
    if (firstInvalidField) firstInvalidField.focus();
    return;
  }

  const payload = mode === "register"
    ? {
        name: authForm.elements.name.value.trim(),
        email: authForm.elements.email.value.trim(),
        phone: authForm.elements.phone.value.trim(),
        password: authForm.elements.password.value
      }
    : {
        identifier: authForm.elements.identifier.value.trim(),
        password: authForm.elements.password.value
      };

  submitButton.disabled = true;
  const originalButtonText = submitButton.textContent;
  submitButton.textContent = mode === "register" ? "Creating account..." : "Signing in...";

  try {
    const response = await fetch(`/api/auth/${mode === "register" ? "signup" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) {
      showMessage(result.error || "The request could not be completed.", "danger");
      return;
    }

    if (result.token) {
      sessionStorage.setItem("authToken", result.token);
      window.location.assign("../chat.html");
      return;
    }

    showMessage(result.message, "success");
  } catch (error) {
    showMessage("Could not reach the server. Make sure the backend is running and try again.", "danger");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalButtonText;
  }
});
