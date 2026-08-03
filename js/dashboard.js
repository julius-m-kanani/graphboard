import { $, $$, showToast, loadState } from './core.js';
import { supabase } from './supabase.js';
import { fetchTeacherAccessCode, rotateTeacherAccessCode } from './auth.js';
import { deserializeState } from './serialize.js';
import { resizeCanvas } from './draw.js';
import { updateHistory } from './history.js';
import { parseSteps, gradeSubmission } from './autocheck.js';

let currentProfile = null;

export async function showDashboard(profile) {
  currentProfile = profile;
  $('#auth-view').hidden = true;
  $('#dashboard-view').hidden = false;
  $('#workspace-view').hidden = true;
  $('#dash-user-name').textContent = profile.full_name || 'You';
  if (profile.role === 'teacher') {
    $('#dash-teacher').hidden = false;
    $('#dash-student').hidden = true;
    $('#dash-admin').hidden = true;
    await renderTeacherDashboard();
  } else if (profile.role === 'admin') {
    $('#dash-admin').hidden = false;
    $('#dash-teacher').hidden = true;
    $('#dash-student').hidden = true;
    await renderAdminDashboard();
  } else {
    $('#dash-student').hidden = false;
    $('#dash-teacher').hidden = true;
    $('#dash-admin').hidden = true;
    await renderStudentDashboard();
  }
}

// ---------- Teacher ----------

async function renderTeacherDashboard() {
  const { data: classes, error } = await supabase.from('classes').select('*').order('created_at');
  if (error) { showToast('Could not load classes.'); return; }
  const { data: exercises, error: exErr } = await supabase.from('exercises').select('*').order('created_at');
  if (exErr) { showToast('Could not load exercises.'); return; }
  const selectedClass = $('#teacher-classes').dataset.selected;

  const container = $('#teacher-classes');
  container.innerHTML = '';
  classes.forEach(c => {
    const card = document.createElement('article');
    card.className = 'dash-card' + (c.id === selectedClass ? ' selected' : '');
    const count = exercises.filter(e => e.class_id === c.id).length;
    card.innerHTML = `
      <div class="dash-card-main">
        <h3>${escapeHtml(c.name)}</h3>
        <p>${count} exercise${count === 1 ? '' : 's'}</p>
      </div>
      <span class="join-code">${c.join_code}</span>
      <button class="icon-button small" data-class-id="${c.id}" data-action="copy-code" title="Copy join code">⧉</button>`;
    container.appendChild(card);
  });
  container.dataset.selected = selectedClass || '';
  bindTeacherClassActions();
  renderTeacherExercises(exercises);
  fetchTeacherAccessCode().then(code => { if (code) $('#teacher-access-code').textContent = code; }).catch(() => {});
}

function bindTeacherClassActions() {
  $$('#teacher-classes [data-action="copy-code"]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const code = btn.previousElementSibling.textContent;
    try {
      await navigator.clipboard.writeText(code);
      showToast('Join code copied: ' + code);
    } catch { showToast('Join code: ' + code); }
  }));
  $$('#teacher-classes .dash-card').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.querySelector('[data-action="copy-code"]').dataset.classId;
      const isSelected = $('#teacher-classes').dataset.selected === id;
      $('#teacher-classes').dataset.selected = isSelected ? '' : id;
      await renderTeacherDashboard();
    });
  });
}

async function renderTeacherExercises(exercises) {
  const selectedClass = $('#teacher-classes').dataset.selected;
  $('#exercise-heading').hidden = !selectedClass;
  $('#new-exercise-button').hidden = !selectedClass;
  const container = $('#teacher-exercises');
  container.innerHTML = '';
  if (!selectedClass) return;
  const list = exercises.filter(e => e.class_id === selectedClass);
  list.forEach(ex => {
    const card = document.createElement('article');
    card.className = 'dash-card';
    card.innerHTML = `
      <div class="dash-card-main">
        <h3>${escapeHtml(ex.title)}</h3>
        <p>${escapeHtml(ex.prompt)}</p>
      </div>
      <button class="text-button" data-ex-id="${ex.id}" data-action="view">View</button>`;
    container.appendChild(card);
  });
  $$('#teacher-exercises [data-action="view"]').forEach(btn => btn.addEventListener('click', () => viewExercise(btn.dataset.exId)));
}

async function viewExercise(exerciseId) {
  const { data: exercise } = await supabase.from('exercises').select('*, classes(name)').eq('id', exerciseId).single();
  if (!exercise) return;
  $('#submission-heading').hidden = false;
  const heading = document.querySelector('#submission-heading h1');
  heading.textContent = exercise.title + ' — submissions' + (exercise.steps?.length ? ` (auto-check: ${parseSteps(exercise.steps).map(s => s.type).join(', ')})` : '');
  const { data: submissions } = await supabase
    .from('submissions')
    .select('*, profiles(full_name)')
    .eq('exercise_id', exerciseId)
    .order('submitted_at', { ascending: false });
  const container = $('#teacher-submissions');
  container.innerHTML = '';
  if (!submissions || !submissions.length) {
    container.innerHTML = '<p class="dash-empty">No submissions yet.</p>';
  }
  (submissions || []).forEach(s => {
    const card = document.createElement('article');
    card.className = 'dash-card';
    const name = s.profiles?.full_name || 'Student';
    card.innerHTML = `
      <div class="dash-card-main">
        <h3>${escapeHtml(name)}</h3>
        <p>${s.status}${s.score != null ? ' · score ' + s.score + '%' : ''}${s.submitted_at ? ' · ' + new Date(s.submitted_at).toLocaleString() : ''}</p>
      </div>
      <button class="text-button" data-sub-id="${s.id}" data-action="review">Review</button>`;
    container.appendChild(card);
  });
  $$('#teacher-submissions [data-action="review"]').forEach(btn => btn.addEventListener('click', () => {
    const sub = (submissions || []).find(x => x.id === btn.dataset.subId);
    showToast('Opening student work in the workspace…');
    openForReview(sub, exercise);
  }));
}

function openForReview(submission, exercise) {
  const saved = typeof submission.actions === 'string' ? JSON.parse(submission.actions || '{}') : (submission.actions || {});
  loadState(deserializeState(saved));
  $('#exercise-title').textContent = exercise.title + ' (review)';
  $('#exercise-class').textContent = (submission.profiles?.full_name || 'student') + ' — review only';
  $('#exercise-badge').hidden = false;
  $('#back-button').hidden = false;
  $('#submission-bar').hidden = true;
  $('#dashboard-view').hidden = true;
  $('#workspace-view').hidden = false;
  resizeCanvas();
  updateHistory();
}

function generateJoinCode() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const part = (len, set) => Array.from({ length: len }, () => set[Math.floor(Math.random() * set.length)]).join('');
  return part(2, letters) + '-' + part(3, digits);
}

function createClass() {
  openModal('class');
}

function createExercise() {
  const selectedClass = $('#teacher-classes').dataset.selected;
  if (!selectedClass) { showToast('Select a class first.'); return; }
  openModal('exercise');
}

// ---------- Modal ----------

let modalMode = null;

function openModal(mode) {
  modalMode = mode;
  const isClass = mode === 'class';
  $('#modal-title').textContent = isClass ? 'New class' : 'New exercise';
  $('#modal-submit').textContent = isClass ? 'Create class' : 'Create exercise';
  $('#modal-field-class-name').hidden = !isClass;
  $('#modal-field-title').hidden = isClass;
  $('#modal-field-prompt').hidden = isClass;
  $('#modal-field-steps').hidden = isClass;
  $('#modal-class-name').value = '';
  $('#modal-title-input').value = '';
  $('#modal-prompt').value = '';
  $('#modal-steps').value = '';
  $('#modal-error').textContent = '';
  $('#modal-backdrop').hidden = false;
  const first = isClass ? $('#modal-class-name') : $('#modal-title-input');
  setTimeout(() => first.focus(), 30);
}

function closeModal() {
  $('#modal-backdrop').hidden = true;
  modalMode = null;
}

async function submitModal() {
  $('#modal-error').textContent = '';
  if (modalMode === 'class') {
    const name = $('#modal-class-name').value.trim();
    if (!name) { $('#modal-error').textContent = 'Enter a class name.'; return; }
    const joinCode = generateJoinCode();
    const { error } = await supabase.from('classes').insert({ name, join_code: joinCode, teacher_id: currentProfile.id });
    if (error) { $('#modal-error').textContent = error.message; return; }
    closeModal();
    showToast('Class created. Join code: ' + joinCode);
    await renderTeacherDashboard();
  } else {
    const selectedClass = $('#teacher-classes').dataset.selected;
    const title = $('#modal-title-input').value.trim();
    if (!title) { $('#modal-error').textContent = 'Enter an exercise title.'; return; }
    const prompt = $('#modal-prompt').value.trim();
    const stepsRaw = $('#modal-steps').value.trim();
    const steps = parseSteps(stepsRaw);
    const { error } = await supabase.from('exercises').insert({ class_id: selectedClass, title, prompt, steps });
    if (error) { $('#modal-error').textContent = error.message; return; }
    closeModal();
    showToast(steps.length ? 'Exercise created with auto-check.' : 'Exercise created.');
    await renderTeacherDashboard();
  }
}

// ---------- Admin ----------

async function renderAdminDashboard() {
  const [users, classes, exercises, submissions] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, role, created_at').order('created_at'),
    supabase.from('classes').select('id, name, join_code, teacher_id, created_at, profiles!classes_teacher_id_fkey(full_name)').order('created_at'),
    supabase.from('exercises').select('id, class_id, title, prompt, steps').order('created_at'),
    supabase.from('submissions').select('*, exercises(title, class_id), profiles(full_name)').order('updated_at', { ascending: false }),
  ]);
  if (users.error) { showToast('Could not load users.'); return; }
  renderAdminUsers(users.data);
  renderAdminClasses(classes.data, exercises.data);
  renderAdminSubmissions(submissions.data, exercises.data);
  fetchTeacherAccessCode().then(code => { if (code) $('#admin-access-code').textContent = code; }).catch(() => {});
}

function renderAdminUsers(users) {
  const container = $('#admin-users');
  container.innerHTML = '';
  (users || []).forEach(u => {
    const card = document.createElement('article');
    card.className = 'dash-card';
    const isSelf = u.id === currentProfile.id;
    card.innerHTML = `
      <div class="dash-card-main">
        <h3>${escapeHtml(u.full_name || u.email)}${isSelf ? ' <em>(you)</em>' : ''}</h3>
        <p>${escapeHtml(u.email)} · ${u.role} · ${new Date(u.created_at).toLocaleDateString()}</p>
      </div>
      <select class="role-select" data-user-id="${u.id}" ${isSelf ? 'disabled' : ''} title="${isSelf ? 'You cannot change your own role' : 'Change role'}">
        <option value="student" ${u.role === 'student' ? 'selected' : ''}>student</option>
        <option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>teacher</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
      </select>`;
    container.appendChild(card);
  });
  $$('#admin-users select').forEach(sel => sel.addEventListener('change', async () => {
    const { error } = await supabase.rpc('admin_set_role', { p_user_id: sel.dataset.userId, p_role: sel.value });
    if (error) { showToast(error.message); renderAdminUsers(users); }
    else { showToast('Role updated.'); }
  }));
}

function renderAdminClasses(classes, exercises) {
  const container = $('#admin-classes');
  container.innerHTML = '';
  (classes || []).forEach(c => {
    const teacher = c.profiles?.full_name || 'Unknown teacher';
    const count = (exercises || []).filter(e => e.class_id === c.id).length;
    const card = document.createElement('article');
    card.className = 'dash-card';
    card.innerHTML = `
      <div class="dash-card-main">
        <h3>${escapeHtml(c.name)}</h3>
        <p>${escapeHtml(teacher)} · ${count} exercise${count === 1 ? '' : 's'}</p>
      </div>
      <span class="join-code">${c.join_code}</span>`;
    container.appendChild(card);
  });
  if (!classes?.length) container.innerHTML = '<p class="dash-empty">No classes yet.</p>';
}

function renderAdminSubmissions(submissions, exercises) {
  const container = $('#admin-submissions');
  container.innerHTML = '';
  (submissions || []).forEach(s => {
    const exercise = (exercises || []).find(e => e.id === s.exercise_id);
    const student = s.profiles?.full_name || 'Student';
    const card = document.createElement('article');
    card.className = 'dash-card';
    card.innerHTML = `
      <div class="dash-card-main">
        <h3>${escapeHtml(exercise?.title || 'Untitled')} — ${escapeHtml(student)}</h3>
        <p>${s.status}${s.score != null ? ' · score ' + s.score + '%' : ''}${s.submitted_at ? ' · ' + new Date(s.submitted_at).toLocaleString() : ''}</p>
      </div>
      <button class="text-button" data-admin-sub-id="${s.id}">Review</button>`;
    container.appendChild(card);
  });
  if (!submissions?.length) container.innerHTML = '<p class="dash-empty">No submissions yet.</p>';
  $$('#admin-submissions [data-admin-sub-id]').forEach(btn => btn.addEventListener('click', () => {
    const s = (submissions || []).find(x => x.id === btn.dataset.adminSubId);
    const exercise = (exercises || []).find(e => e.id === s?.exercise_id);
    if (s && exercise) { showToast('Opening student work in the workspace…'); openForReview(s, exercise); }
  }));
}

// ---------- Student ----------

async function renderStudentDashboard() {
  const { data: memberships } = await supabase.from('class_members').select('class_id').eq('student_id', currentProfile.id);
  if (!memberships || !memberships.length) {
    $('#student-exercises').innerHTML = '<p class="dash-empty">You are not in any classes yet. Ask your teacher for the join code.</p>';
    return;
  }
  const classIds = memberships.map(m => m.class_id);
  const { data: classes } = await supabase.from('classes').select('id, name').in('id', classIds);
  const { data: exercises } = await supabase
    .from('exercises')
    .select('*, submissions(status, submitted_at)')
    .in('class_id', classIds)
    .order('created_at');
  const container = $('#student-exercises');
  container.innerHTML = '';
  if (!exercises || !exercises.length) {
    container.innerHTML = '<p class="dash-empty">No exercises assigned yet.</p>';
    return;
  }
  (exercises || []).forEach(ex => {
    const className = (classes || []).find(c => c.id === ex.class_id)?.name || '';
    const sub = Array.isArray(ex.submissions) ? ex.submissions[0] : ex.submissions;
    const status = sub?.status || 'not started';
    const card = document.createElement('article');
    card.className = 'dash-card';
    card.innerHTML = `
      <div class="dash-card-main">
        <h3>${escapeHtml(ex.title)}</h3>
        <p>${className} · ${status}</p>
      </div>
      <button class="auth-submit slim" data-ex-id="${ex.id}">Open</button>`;
    container.appendChild(card);
  });
  $$('#student-exercises [data-ex-id]').forEach(btn => btn.addEventListener('click', () => openExercise(btn.dataset.exId)));
}

async function openExercise(exerciseId) {
  const { data: exercise } = await supabase.from('exercises').select('*, classes(name)').eq('id', exerciseId).single();
  if (!exercise) return;
  const { data: submission } = await supabase.from('submissions').select('*').eq('exercise_id', exerciseId).eq('student_id', currentProfile.id).maybeSingle();
  $('#exercise-title').textContent = exercise.title;
  $('#exercise-class').textContent = exercise.classes?.name || '';
  $('#submission-prompt').textContent = exercise.prompt || 'Complete the exercise on the graph paper below.';
  $('#exercise-badge').hidden = false;
  $('#back-button').hidden = false;
  $('#submission-bar').hidden = false;
  if (submission?.status === 'submitted') {
    $('#submission-status').textContent = 'Submitted — reopen to edit? Submit again to update.';
    $('#submit-work-button').textContent = 'Re-submit';
  } else {
    $('#submission-status').textContent = '';
    $('#submit-work-button').textContent = 'Submit';
  }
  window.__activeExercise = exercise;
  window.__activeSubmission = submission;
  const saved = submission ? (typeof submission.actions === 'string' ? JSON.parse(submission.actions || '{}') : submission.actions || {}) : null;
  loadState(saved ? deserializeState(saved) : {});
  $('#dashboard-view').hidden = true;
  $('#workspace-view').hidden = false;
  resizeCanvas();
  updateHistory();
  showToast('Open exercise: ' + exercise.title);
}

// ---------- Saving & submitting ----------

export async function saveWork(submit = false) {
  const exercise = window.__activeExercise;
  if (!exercise) return;
  const serialized = serializeCurrentState();
  const graded = submit ? gradeSubmission(exercise, serialized) : null;
  const payload = {
    exercise_id: exercise.id,
    student_id: currentProfile.id,
    actions: serialized,
    status: submit ? 'submitted' : 'draft',
    score: graded ? graded.score : null,
    feedback: graded ? graded.feedback : null,
    submitted_at: submit ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const existing = window.__activeSubmission;
  if (existing) {
    const { error } = await supabase.from('submissions').update(payload).eq('id', existing.id);
    if (error) { showToast(error.message); return; }
  } else {
    const { data, error } = await supabase.from('submissions').insert(payload).select('id').single();
    if (error) { showToast(error.message); return; }
    window.__activeSubmission = { id: data.id };
  }
  showToast(submit
    ? (graded ? `Submitted! Score: ${graded.score}%` : 'Submitted! Your teacher can now see your work.')
    : 'Work saved.');
  if (submit) $('#submission-status').textContent = graded ? `Submitted. Score: ${graded.score}% — ${graded.feedback}` : 'Submitted.';
}

function serializeCurrentState() {
  return window.__serializeState ? window.__serializeState() : {};
}

export function bindDashboardActions(onAuthSuccess) {
  $('#logout-button').addEventListener('click', async () => {
    await supabase.auth.signOut();
    onAuthSuccess(null);
  });
  $('#new-class-button').addEventListener('click', createClass);
  $('#new-exercise-button').addEventListener('click', createExercise);
  $('#modal-form').addEventListener('submit', e => { e.preventDefault(); submitModal(); });
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal-backdrop').hidden) closeModal(); });
  $('#rotate-code-button').addEventListener('click', async () => {
    const code = await rotateTeacherAccessCode();
    $('#teacher-access-code').textContent = code || '——';
    showToast('Teacher access code rotated.');
  });
  $('#admin-rotate-code-button').addEventListener('click', async () => {
    const code = await rotateTeacherAccessCode();
    $('#admin-access-code').textContent = code || '——';
    showToast('Teacher access code rotated.');
  });
  $('#save-work-button').addEventListener('click', () => saveWork(false));
  $('#submit-work-button').addEventListener('click', () => saveWork(true));
  $('#back-button').addEventListener('click', () => {
    window.__activeExercise = null;
    window.__activeSubmission = null;
    showDashboard(currentProfile);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
