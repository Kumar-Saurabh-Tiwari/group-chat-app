const authForm = document.querySelector("#auth-form");
const formAlert = document.querySelector("#form-alert");
const mode = authForm.dataset.authMode;
const passwordInput = document.querySelector("#password");
const passwordToggle = document.querySelector("#password-toggle");
const identifierInput = document.querySelector("#identifier");
const phoneInput = document.querySelector("#phone");
const forgotPassword = document.querySelector("#forgot-password");

function isValidPhone(value) {
  const trimmedValue = value.trim();
  const digits = trimmedValue.replace(/\D/g, "");
  return /^\+?[0-9\s().-]+$/.test(trimmedValue) && digits.length >= 7 && digits.length <= 15;
}

function isValidEmailOrPhone(value) {
  const trimmedValue = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedValue) || isValidPhone(trimmedValue);
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
    formAlert.className = "alert alert-info";
    formAlert.textContent = "Password reset is not available in this frontend demo.";
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

authForm.addEventListener("submit", (event) => {
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

  formAlert.className = "alert alert-info";
  formAlert.textContent = mode === "register"
    ? "Your details look good. Account creation will be connected when a backend is added."
    : "Your details look good. Sign-in will be connected when a backend is added.";
});
