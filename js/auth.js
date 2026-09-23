import { $, showToast } from './core.js';
import { supabase, getProfile } from './supabase.js';

let authFormsBound = false;
window.__authFormsBound = false; // for debugging

export async function showAuthView() {
  $('#auth-view').hidden = false;
  $('#dashboard-view').hidden = true;
  $('#workspace-view').hidden = true;
  if (!authFormsBound) { setupAuthForms(); authFormsBound = true; window.__authFormsBound = true; }
  resetAuthForms();
}

function resetAuthForms() {
  const student = $('input[name="role"][value="student"]');
  if (student) student.checked = true;
  const codeField = document.getElementById('signup-code-field');
  if (codeField) codeField.hidden = false;
  $('#signup-name').value = '';
  $('#signup-email').value = '';
  $('#signup-password').value = '';
  $('#signup-code').value = '';
  $('#signup-error').textContent = '';
  $('#login-error').textContent = '';
}

function setupAuthForms() {
  // Use event delegation on the tabs container for reliability
  const tabs = document.querySelector('.auth-tabs');
  if (tabs) {
    tabs.addEventListener('click', e => {
      const tab = e.target.closest('button[data-authtab]');
      if (!tab) return;
      document.querySelectorAll('.auth-tabs button').forEach(t => t.classList.toggle('active', t === tab));
      const tabName = tab.dataset.authtab;
      const loginForm = document.getElementById('login-form');
      const signupForm = document.getElementById('signup-form');
      if (loginForm) loginForm.hidden = tabName !== 'login';
      if (signupForm) signupForm.hidden = tabName !== 'signup';
      const loginError = document.getElementById('login-error');
      const signupError = document.getElementById('signup-error');
      if (loginError) loginError.textContent = '';
      if (signupError) signupError.textContent = '';
    });
  }
  // The join-code field only applies to students.
  document.querySelectorAll('input[name="role"]').forEach(input => input.addEventListener('change', () => {
    const codeField = document.getElementById('signup-code-field');
    if (codeField) codeField.hidden = input.value !== 'student';
  }));
}

export function attachAuthHandlers(onAuthSuccess) {
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#login-email').value.trim(), password = $('#login-password').value;
    $('#login-error').textContent = '';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { $('#login-error').textContent = error.message; return; }
    await applyPendingSignup();
    const profile = await getProfile();
    if (!profile) { await signOut(); $('#login-error').textContent = 'No account profile found.'; return; }
    onAuthSuccess(profile);
  });

  $('#signup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#signup-name').value.trim(), email = $('#signup-email').value.trim(), password = $('#signup-password').value;
    const role = $('input[name="role"]:checked').value;
    const joinCode = $('#signup-code').value.trim().toUpperCase();
    $('#signup-error').textContent = '';
    try {
      // Open SaaS registration: teachers sign up directly, students join with
      // their class code.
      if (role === 'student' && !joinCode) { $('#signup-error').textContent = 'Enter your class join code.'; return; }
      await createAccount(email, password, name, role, role === 'student' ? joinCode : null, onAuthSuccess);
    } catch (err) { $('#signup-error').textContent = err.message || 'Something went wrong.'; }
  });
}

// Signup details that could not be applied yet because the new account has no
// session (email-confirmation mode). They are applied on the next sign-in.
const PENDING_KEY = 'graphboard-pending-signup';
function stashPending(p) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch (e) {} }
function takePending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

async function applyPendingSignup() {
  const p = takePending();
  if (!p) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { stashPending(p); return; }
  if (p.name) {
    const { error } = await supabase.from('profiles').update({ full_name: p.name }).eq('id', user.id);
    if (error) { stashPending(p); showToast('Signed in, but your display name was not saved.'); return; }
  }
  if (p.role === 'student' && p.joinCode) {
    const { error } = await supabase.rpc('join_class', { p_code: p.joinCode });
    if (error) showToast('Signed in, but joining your class failed: ' + (error.message || 'invalid join code.'));
  }
}

async function createAccount(email, password, name, role, joinCode, onAuthSuccess) {
  // The chosen role travels in the auth metadata so the database trigger can
  // assign it at profile creation (the client may never set roles directly).
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { role, full_name: name } }
  });
  if (error) throw error;
  if (!data.user) throw new Error('Account not created. Check your details and try again.');
  if (!data.session) {
    // Email-confirmation mode: no session yet, so the class join would be
    // rejected. Stash it and finish after sign-in (the role is already stored
    // and applied by the trigger at confirmation time).
    stashPending({ name, role, joinCode });
    throw new Error('Account created — check your email to confirm it, then sign in.');
  }
  // Confirm the display name (the trigger already set it from the metadata;
  // this covers databases running an older trigger).
  const { error: profErr } = await supabase.from('profiles').update({ full_name: name }).eq('id', data.user.id);
  if (profErr) throw profErr;
  if (role === 'student' && joinCode) {
    const { error: joinErr } = await supabase.rpc('join_class', { p_code: joinCode });
    if (joinErr) throw new Error(joinErr.message || 'That join code is not valid.');
  }
  const profile = await getProfile();
  onAuthSuccess(profile);
}

export async function signOut() {
  await supabase.auth.signOut();
}
