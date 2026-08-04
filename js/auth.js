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
  if (student) {
    student.checked = true;
    const teacher = $('#signup-teacher-code').closest('label');
    teacher.hidden = true;
  }
  $('#signup-name').value = '';
  $('#signup-email').value = '';
  $('#signup-password').value = '';
  $('#signup-code').value = '';
  $('#signup-teacher-code').value = '';
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
  const roleInputs = document.querySelectorAll('input[name="role"]');
  roleInputs.forEach(input => input.addEventListener('change', () => {
    const teacher = document.getElementById('signup-teacher-code')?.closest('label');
    if (teacher) teacher.hidden = input.value !== 'teacher';
  }));
}

export function attachAuthHandlers(onAuthSuccess) {
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#login-email').value.trim(), password = $('#login-password').value;
    $('#login-error').textContent = '';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { $('#login-error').textContent = error.message; return; }
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
      if (role === 'student') {
        if (!joinCode) { $('#signup-error').textContent = 'Enter your class join code.'; return; }
        await createAccount(email, password, name, role, joinCode, onAuthSuccess);
      } else {
        const { data: code, error: codeErr } = await supabase.rpc('get_teacher_access_code');
        if (codeErr || !code) { $('#signup-error').textContent = 'Teacher registration is not available yet.'; return; }
        if ($('#signup-teacher-code').value.trim() !== code) { $('#signup-error').textContent = 'That teacher access code is not valid.'; return; }
        await createAccount(email, password, name, role, null, onAuthSuccess);
      }
    } catch (err) { $('#signup-error').textContent = err.message || 'Something went wrong.'; }
  });
}

async function createAccount(email, password, name, role, joinCode, onAuthSuccess) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('Account not created. Check your details and try again.');
  // Update the auto-created profile with the chosen role and name.
  const { error: profErr } = await supabase.from('profiles').update({ role, full_name: name }).eq('id', data.user.id);
  if (profErr) throw profErr;
  if (role === 'student' && joinCode) {
    const { error: joinErr } = await supabase.rpc('join_class', { p_code: joinCode });
    if (joinErr) throw new Error('That join code is not valid.');
  }
  const profile = await getProfile();
  onAuthSuccess(profile);
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function fetchTeacherAccessCode() {
  const { data, error } = await supabase.rpc('get_teacher_access_code');
  if (error) throw error;
  return data;
}

export async function rotateTeacherAccessCode() {
  const { data, error } = await supabase.rpc('rotate_teacher_code');
  if (error) throw error;
  return data;
}
