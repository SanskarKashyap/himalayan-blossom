(function () {
  'use strict';

  let hasRedirected = false;

  function ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function resolveRedirectTarget() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('redirect');
    if (!requested) {
      return 'index.html';
    }

    try {
      const url = new URL(requested, window.location.origin);
      if (url.origin !== window.location.origin) {
        return 'index.html';
      }
      const path = url.pathname || '/';
      return path + (url.search || '') + (url.hash || '');
    } catch (error) {
      return 'index.html';
    }
  }

  function setStatus(element, type, message) {
    if (!element) return;
    if (!message) {
      element.textContent = '';
      element.setAttribute('hidden', 'hidden');
      element.classList.remove('alert-danger', 'alert-success', 'alert-info');
      return;
    }
    element.textContent = message;
    element.removeAttribute('hidden');
    element.classList.remove('alert-danger', 'alert-success', 'alert-info');
    if (type === 'success') {
      element.classList.add('alert-success');
    } else if (type === 'info') {
      element.classList.add('alert-info');
    } else {
      element.classList.add('alert-danger');
    }
  }

  function toggleFormDisabled(form, isDisabled) {
    if (!form) return;
    const elements = form.querySelectorAll('input, button, select, textarea');
    elements.forEach((element) => {
      if (isDisabled) {
        element.setAttribute('disabled', 'disabled');
      } else {
        element.removeAttribute('disabled');
      }
    });
  }

  function mapAuthError(error) {
    if (!error || !error.code) {
      return error && error.message ? error.message : 'Something went wrong. Please try again.';
    }
    switch (error.code) {
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Contact support for assistance.';
      case 'auth/user-not-found':
        return 'We could not find an account with that email. Please sign up first.';
      case 'auth/wrong-password':
        return 'Incorrect password. Please try again.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'auth/email-already-in-use':
        return 'An account with this email already exists. Try signing in instead.';
      case 'auth/weak-password':
        return 'Choose a stronger password with at least 6 characters.';
      default:
        return error.message || 'Unable to complete the request.';
    }
  }

  function redirectToTarget(target) {
    if (hasRedirected) {
      return;
    }
    hasRedirected = true;
    const destination = target || resolveRedirectTarget();
    window.location.assign(destination);
  }

  async function handleLoginSubmit(event, statusElement) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    const email = (form.email && form.email.value) ? form.email.value.trim() : '';
    const password = (form.password && form.password.value) ? form.password.value : '';

    if (!email || !password) {
      setStatus(statusElement, 'error', 'Please enter both email and password.');
      return;
    }

    toggleFormDisabled(form, true);
    setStatus(statusElement, 'info', 'Signing you in...');

    try {
      const resources = await window.Auth.ensureFirebaseReady();
      await resources.auth.setPersistence(resources.firebase.auth.Auth.Persistence.LOCAL);
      await resources.auth.signInWithEmailAndPassword(email, password);
      setStatus(statusElement, 'success', 'Signed in! Redirecting…');
      redirectToTarget();
    } catch (error) {
      setStatus(statusElement, 'error', mapAuthError(error));
      toggleFormDisabled(form, false);
    }
  }

  async function handleSignupSubmit(event, statusElement) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    const name = (form.name && form.name.value) ? form.name.value.trim() : '';
    const email = (form.email && form.email.value) ? form.email.value.trim() : '';
    const password = (form.password && form.password.value) ? form.password.value : '';
    const confirmPassword = (form.confirmPassword && form.confirmPassword.value)
      ? form.confirmPassword.value
      : '';

    if (!name || !email || !password || !confirmPassword) {
      setStatus(statusElement, 'error', 'Please fill in all required fields.');
      return;
    }

    if (password !== confirmPassword) {
      setStatus(statusElement, 'error', 'Passwords do not match. Please try again.');
      return;
    }

    toggleFormDisabled(form, true);
    setStatus(statusElement, 'info', 'Creating your account...');

    try {
      const resources = await window.Auth.ensureFirebaseReady();
      await resources.auth.setPersistence(resources.firebase.auth.Auth.Persistence.LOCAL);
      const credential = await resources.auth.createUserWithEmailAndPassword(email, password);
      if (credential && credential.user && name) {
        try {
          await credential.user.updateProfile({ displayName: name });
        } catch (profileError) {
          console.warn('Auth forms: unable to update display name', profileError);
        }
      }
      setStatus(statusElement, 'success', 'Account created! Redirecting…');
      redirectToTarget();
    } catch (error) {
      setStatus(statusElement, 'error', mapAuthError(error));
      toggleFormDisabled(form, false);
    }
  }

  function initAuthForms() {
    const loginForm = document.querySelector('form[data-auth-form="login"]');
    const signupForm = document.querySelector('form[data-auth-form="signup"]');
    const statusElement = document.querySelector('[data-auth-status]');
    const redirectTarget = resolveRedirectTarget();

    if (!loginForm && !signupForm) {
      return;
    }

    hasRedirected = false;

    if (window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated()) {
      redirectToTarget(redirectTarget);
      return;
    }

    window.addEventListener(
      'hb:auth:signed-in',
      () => {
        redirectToTarget(redirectTarget);
      },
      { once: true }
    );

    if (loginForm && !loginForm.dataset.hbBound) {
      loginForm.dataset.hbBound = 'true';
      loginForm.addEventListener('submit', (event) => handleLoginSubmit(event, statusElement));
    }

    if (signupForm && !signupForm.dataset.hbBound) {
      signupForm.dataset.hbBound = 'true';
      signupForm.addEventListener('submit', (event) => handleSignupSubmit(event, statusElement));
    }
  }

  ready(() => {
    if (!window.Auth || typeof window.Auth.ensureFirebaseReady !== 'function') {
      console.warn('Auth forms: auth.js is required before auth-forms.js');
      return;
    }
    initAuthForms();
    window.addEventListener('hb:spa:pagechange', initAuthForms);
  });
})();
