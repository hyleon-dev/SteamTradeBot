// Show or hide the password. The button stays hidden without JavaScript.
const input = document.getElementById('password');
const toggle = document.getElementById('togglePassword');

toggle.hidden = false;
toggle.addEventListener('click', () => {
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(show));
  toggle.textContent = show ? 'Hide' : 'Show';
  input.focus();
});

// Hide the password again before sending, so the browser does not store it as plain text history.
input.form.addEventListener('submit', () => {
  input.type = 'password';
});
