import { $, $$, state, showToast, loadState, canvas, render } from './core.js';
import { supabase } from './supabase.js';
import { fetchTeacherAccessCode, rotateTeacherAccessCode } from './auth.js';
import { deserializeState } from './serialize.js';
import { resizeCanvas } from './draw.js';
import { updateHistory } from './history.js';
import { renderActionsToVideo } from './recorder.js';
import { parseSteps, gradeSubmission, STEP_TYPES } from './autocheck.js';

async function recordSubmissionVideo(serialized) {
  const saved = deserializeState(serialized);
  if (!saved?.actions?.length) return null;
  if (!window.MediaRecorder || !canvas.captureStream) return null;
  try {
    return await renderActionsToVideo(saved.actions, { fps: 15, frameMs: 30, perMarkMs: 80, tailMs: 250, leadInMs: 150, bitrate: 1_500_000 });
  } catch (err) {
    console.error('Submission video failed:', err);
    return null;
  } finally {
    loadState(saved);
    render();
  }
}

async function storeSubmissionVideo(submissionId, blob) {
  if (!blob) return null;
  const path = `${currentProfile.id}/${submissionId}.webm`;
  const bucket = supabase.storage.from('submission-videos');
  let { error } = await bucket.upload(path, blob, { contentType: 'video/webm', upsert: true });
  if (error) {
    await bucket.remove([path]);
    ({ error } = await bucket.upload(path, blob, { contentType: 'video/webm' }));
  }
  if (error) { console.error('Video upload failed:', error); return null; }
  const { error: upErr } = await supabase.from('submissions').update({ video: path }).eq('id', submissionId);
  if (upErr) console.error('Video path update failed:', upErr);
  return path;
}

let currentProfile = null;

export async function showDashboard(profile) {
  currentProfile = profile;
  $('#auth-view').hidden = true;
  $('#dashboard-view').hidden = false;
  $('#workspace-view').hidden = true;
  $('#classroom-button').hidden = true;
  $('#back-button').hidden = false;
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

function showWorkspace() {
  currentProfile = null;
  $('#auth-view').hidden = true;
  $('#dashboard-view').hidden = true;
  $('#workspace-view').hidden = false;
  $('#classroom-button').hidden = false;
  $('#back-button').hidden = true;
  const strip = $('#review-strip'); if (strip) strip.hidden = true;
  resizeCanvas();
  updateHistory();
}

// ---------- Teacher ----------

async function renderTeacherDashboard() {
  const { data: classes, error } = await supabase.from('classes').select('*').order('created_at');
  if (error) { showToast('Could not load classes.'); return; }
  const { data: exercises, error: exErr } = await supabase.from('exercises').select('*').order('created_at');
  if (exErr) { showToast('Could not load exercises.'); return; }
  let selectedClass = $('#teacher-classes').dataset.selected;
  if (!selectedClass && classes.length === 1) selectedClass = classes[0].id;

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
  renderTeacherRoster();
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
  window.__activeExercise = exercise;
  window.__activeSubmission = submission;
  $('#exercise-title').textContent = exercise.title + ' (review)';
  $('#exercise-class').textContent = (submission.profiles?.full_name || 'student') + ' — review only';
  $('#exercise-badge').hidden = false;
  $('#back-button').hidden = false;
  $('#submission-bar').hidden = true;
  $('#dashboard-view').hidden = true;
  $('#workspace-view').hidden = false;
  resizeCanvas();
  updateHistory();
  setupReviewStrip(submission);
}

async function setupReviewStrip(submission) {
  const strip = $('#review-strip');
  if (!strip) return;
  strip.hidden = false;
  strip.innerHTML = '';
  const label = document.createElement('b');
  label.textContent = 'Student recording';
  strip.appendChild(label);

  const replay = document.createElement('button');
  replay.className = 'text-button';
  replay.textContent = 'Replay session';
  replay.addEventListener('click', async () => {
    if (replay.disabled) return;
    const saved = typeof submission.actions === 'string' ? JSON.parse(submission.actions || '{}') : (submission.actions || {});
    if (!saved.actions || !saved.actions.length) { showToast('No drawing in this submission.'); return; }
    replay.disabled = true;
    replay.textContent = 'Recording…';
    try {
      const blob = await renderActionsToVideo(saved.actions, { fps: 20, frameMs: 35, perMarkMs: 160, tailMs: 500, leadInMs: 250 });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = `submission-${submission.id ? String(submission.id).slice(0, 8) : 'review'}-session.webm`;
      a.href = url; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast('Recording ready — check your downloads');
    } catch (err) {
      showToast('Could not record: ' + err.message);
    } finally {
      replay.disabled = false;
      replay.textContent = 'Replay session';
    }
  });
  strip.appendChild(replay);

  if (submission.video) {
    let url = submission.video;
    if (!url.startsWith('data:')) {
      const { data } = await supabase.storage.from('submission-videos').createSignedUrl(url, 3600);
      url = data?.signedUrl || null;
    }
    if (url) {
      const link = document.createElement('a');
      link.className = 'text-button';
      link.href = url;
      link.download = `submission-${String(submission.id).slice(0, 8)}-recording.webm`;
      link.textContent = 'Download recorded video';
      strip.appendChild(link);
      const vid = document.createElement('video');
      vid.controls = true;
      vid.src = url;
      strip.appendChild(vid);
    }
  }
}

// ---------- Class roster ----------

async function renderTeacherRoster() {
  const heading = $('#roster-heading');
  const container = $('#teacher-roster');
  if (!heading || !container) return;
  heading.hidden = true;
  container.innerHTML = '';
  heading.querySelector('h1').textContent = 'Students';
  const selectedClass = $('#teacher-classes').dataset.selected;
  if (!selectedClass) return;

  const { data: members, error } = await supabase.from('class_members')
    .select('*, profiles(full_name, email)')
    .eq('class_id', selectedClass);
  if (error) {
    container.innerHTML = '<p class="dash-empty">Could not load students.</p>';
    return;
  }
  if (!members || !members.length) {
    container.innerHTML = '<p class="dash-empty">No students have joined this class with the join code yet.</p>';
    return;
  }

  const { data: exercises } = await supabase.from('exercises').select('id, title').eq('class_id', selectedClass);
  const exIds = (exercises || []).map(e => e.id);
  const { data: subs } = exIds.length
    ? await supabase.from('submissions').select('*, exercises(title)').in('exercise_id', exIds).order('submitted_at', { ascending: false })
    : { data: [] };

  heading.hidden = false;
  members.forEach(m => {
    const stu = m.profiles || {};
    const studentSubs = (subs || []).filter(s => s.student_id === m.student_id);
    const done = studentSubs.filter(s => s.status === 'submitted').length;
    const card = document.createElement('article');
    card.className = 'dash-card';
    card.innerHTML = `
      <div class="dash-card-main">
        <h3>${escapeHtml(stu.full_name || 'Student')}</h3>
        <p>${escapeHtml(stu.email || '')}${studentSubs.length ? ' · ' + done + '/' + studentSubs.length + ' submitted' : ' · no submissions yet'}</p>
      </div>
      <button class="text-button" data-student-id="${m.student_id}" data-action="roster-view">View</button>`;
    container.appendChild(card);
  });
  $$('#teacher-roster [data-action="roster-view"]').forEach(btn => btn.addEventListener('click', () => {
    const m = members.find(x => x.student_id === btn.dataset.studentId);
    showStudentSubmissions(m ? m.profiles || {} : {}, (subs || []).filter(s => s.student_id === btn.dataset.studentId));
  }));
}

function showStudentSubmissions(student, studentSubs) {
  const heading = $('#roster-heading');
  const container = $('#teacher-roster');
  heading.querySelector('h1').textContent = student.full_name || 'Student';
  container.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'text-button';
  back.textContent = '← All students';
  back.addEventListener('click', () => renderTeacherDashboard());
  container.appendChild(back);
  if (!studentSubs.length) {
    const p = document.createElement('p');
    p.className = 'dash-empty';
    p.textContent = 'This student has no submissions yet.';
    container.appendChild(p);
    return;
  }
  studentSubs.forEach(s => {
    const card = document.createElement('article');
    card.className = 'dash-card';
    card.innerHTML = `
      <div class="dash-card-main">
        <h3>${escapeHtml(s.exercises?.title || 'Exercise')}</h3>
        <p>${s.status}${s.score != null ? ' · score ' + s.score + '%' : ''}${s.submitted_at ? ' · ' + new Date(s.submitted_at).toLocaleString() : ''}</p>
      </div>
      <button class="text-button" data-sub-id="${s.id}" data-action="roster-review">Review</button>`;
    container.appendChild(card);
  });
  $$('#teacher-roster [data-action="roster-review"]').forEach(btn => btn.addEventListener('click', async () => {
    const s = studentSubs.find(x => x.id === btn.dataset.subId);
    const { data: exercise } = await supabase.from('exercises').select('*').eq('id', s.exercise_id).single();
    if (exercise) { showToast('Opening student work in the workspace…'); openForReview(s, exercise); }
  }));
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

// ---------- Modal ----------

let modalMode = null;

async function openModal(mode) {
  modalMode = mode;
  const isClass = mode === 'class';
  $('#modal-title').textContent = isClass ? 'New class' : 'New exercise';
  $('#modal-submit').textContent = isClass ? 'Create class' : 'Create exercise';
  $('#modal-field-class-name').hidden = !isClass;
  $('#modal-field-class-pick').hidden = isClass;
  $('#modal-field-title').hidden = isClass;
  $('#modal-field-prompt').hidden = isClass;
  $('#modal-field-steps').hidden = isClass;
  $('#modal-class-name').value = '';
  $('#modal-title-input').value = '';
  $('#modal-prompt').value = '';
  $('#modal-steps').value = '';
  $('#modal-error').textContent = '';
  if (!isClass) await populateClassPick();
  $('#modal-backdrop').hidden = false;
  const first = isClass ? $('#modal-class-name') : $('#modal-title-input');
  setTimeout(() => first.focus(), 30);
}

async function populateClassPick() {
  const { data: classes, error } = await supabase.from('classes').select('id, name').order('created_at');
  const pick = $('#modal-class-pick');
  pick.innerHTML = '';
  (classes || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    pick.appendChild(opt);
  });
  const selected = $('#teacher-classes').dataset.selected;
  if (selected && (classes || []).some(c => c.id === selected)) pick.value = selected;
  if (error) showToast('Could not load classes.');
}

function closeModal() {
  $('#modal-backdrop').hidden = true;
  modalMode = null;
}

async function submitModal() {
  $('#modal-error').textContent = '';
  const name = $('#modal-class-name').value.trim();
  if (!name) { $('#modal-error').textContent = 'Enter a class name.'; return; }
  const joinCode = generateJoinCode();
  const { data, error } = await supabase.from('classes').insert({ name, join_code: joinCode, teacher_id: currentProfile.id }).select('id').single();
  if (error) { $('#modal-error').textContent = error.message; return; }
  closeModal();
  $('#teacher-classes').dataset.selected = data.id;
  showToast('Class created. Join code: ' + joinCode);
  await renderTeacherDashboard();
}

let builderState = {
  classId: null,
  mode: 'build', // 'build' | 'preview'
  extractedSteps: []
};

function createExercise() {
  let selectedClass = $('#teacher-classes').dataset.selected;
  if (!selectedClass) {
    const btn = document.querySelector('#teacher-classes [data-action="copy-code"]');
    if (!btn) { showToast('Create a class first.'); return; }
    selectedClass = btn.dataset.classId;
    $('#teacher-classes').dataset.selected = selectedClass;
  }
  openExerciseBuilder(selectedClass);
}

// ---------- Exercise Builder ----------

async function openExerciseBuilder(classId) {
  builderState.classId = classId;
  builderState.mode = 'build';
  builderState.extractedSteps = [];
  
  // Switch to workspace in builder mode
  $('#dashboard-view').hidden = true;
  $('#workspace-view').hidden = false;
  $('#exercise-badge').hidden = true;
  $('#builder-badge').hidden = false;
  $('#builder-status').textContent = 'Build mode — draw the solution';
  $('#builder-extract').hidden = false;
  $('#builder-preview').hidden = false;
  $('#builder-assign').hidden = false;
  $('#back-button').hidden = true;
  $('#submission-bar').hidden = true;
  $('#builder-panel').hidden = false;
  
  // Clear canvas for fresh drawing
  clearCanvasForBuilder();
  renderBuilderSteps();
  
  // Load class name for badge
  const { data: cls } = await supabase.from('classes').select('name').eq('id', classId).single();
  $('#builder-status').textContent = cls?.name || 'Build mode — draw the solution';
}

function clearCanvasForBuilder() {
  // Reset state to empty
  loadState({ actions: [], scale: 32, origin: { x: 0, y: 0 } });
  resizeCanvas();
  updateHistory();
}

function exitBuilder() {
  builderState = { classId: null, mode: 'build', extractedSteps: [] };
  $('#workspace-view').hidden = true;
  $('#dashboard-view').hidden = false;
  $('#builder-badge').hidden = true;
  $('#builder-extract').hidden = true;
  $('#builder-preview').hidden = true;
  $('#builder-assign').hidden = true;
  $('#back-button').hidden = true;
  $('#builder-panel').hidden = true;
  $('#builder-preview').textContent = 'Preview';
  renderTeacherDashboard();
}

function toggleBuilderPreview() {
  if (builderState.mode === 'build') {
    builderState.mode = 'preview';
    $('#builder-preview').textContent = 'Edit';
    $('#builder-status').textContent = 'Preview mode — read only';
    $('#builder-extract').hidden = true;
    $('#builder-assign').hidden = true;
    $('#builder-panel').hidden = true;
    // Make canvas read-only by disabling tools
    $$('.tool').forEach(t => t.classList.add('disabled'));
    const shapeSel = $('#shape-select'); if (shapeSel) shapeSel.disabled = true;
    const shape3dSel = $('#shape3d-select'); if (shape3dSel) shape3dSel.disabled = true;
    // Show exercise badge like student view
    $('#exercise-badge').hidden = false;
    $('#exercise-title').textContent = 'Preview: ' + ($('#doc-title').value || 'Exercise');
    $('#exercise-class').textContent = 'Preview mode';
    $('#submission-bar').hidden = true;
  } else {
    builderState.mode = 'build';
    $('#builder-preview').textContent = 'Preview';
    $('#builder-status').textContent = 'Build mode — draw the solution';
    $('#builder-extract').hidden = false;
    $('#builder-assign').hidden = false;
    $('#builder-panel').hidden = false;
    $$('.tool').forEach(t => t.classList.remove('disabled'));
    const shapeSel = $('#shape-select'); if (shapeSel) shapeSel.disabled = false;
    const shape3dSel = $('#shape3d-select'); if (shape3dSel) shape3dSel.disabled = false;
    $('#exercise-badge').hidden = true;
    $('#submission-bar').hidden = true;
  }
}

function extractSteps() {
  const actions = state.actions || [];
  if (!actions.length) { showToast('Draw something first.'); return; }
  
  // Count actions by type
  const counts = {};
  actions.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1; });
  
  // Map action types to step types (STEP_TYPES from autocheck.js)
  const stepTypeMap = {
    'line': 'line',
    'ruler': 'ruler',
    'ray': 'ray',
    'dotted': 'dotted',
    'set45': 'set-square',
    'set60': 'set-square',
    'point': 'point',
    'circle': 'circle',
    'compass': 'compass',
    'protractor': 'angle',
    'pencil': 'pencil',
    'plot': 'plot',
    'dividers': 'compass', // dividers count as compass
    'label': 'point', // labeling a point
    'square': 'square',
    'rectangle': 'rectangle',
    'triangle': 'triangle',
    'right-triangle': 'right-triangle',
    'parallelogram': 'parallelogram',
    'rhombus': 'rhombus',
    'trapezoid': 'trapezoid',
    'pentagon': 'pentagon',
    'hexagon': 'hexagon',
    'octagon': 'octagon',
    'star': 'star',
    'ellipse': 'ellipse',
    'arrow': 'arrow',
    'double-arrow': 'double-arrow',
    'cube': 'cube',
    'cuboid': 'cuboid',
    'triangular-prism': 'triangular-prism',
    'square-pyramid': 'square-pyramid',
    'tetrahedron': 'tetrahedron',
    'cone': 'cone',
    'cylinder': 'cylinder',
    'sphere': 'sphere'
  };
  
  builderState.extractedSteps = [];
  Object.entries(counts).forEach(([type, count]) => {
    const stepType = stepTypeMap[type];
    if (stepType && STEP_TYPES.includes(stepType)) {
      builderState.extractedSteps.push({ type: stepType, count, label: type });
    }
  });
  
  // Deduplicate by type (sum counts)
  const merged = {};
  builderState.extractedSteps.forEach(s => {
    if (!merged[s.type] || merged[s.type].count < s.count) {
      merged[s.type] = { type: s.type, count: s.count, label: s.label };
    } else {
      merged[s.type].count += s.count;
    }
  });
  builderState.extractedSteps = Object.values(merged);
  
  renderBuilderSteps();
  showToast(`Extracted ${builderState.extractedSteps.length} step type(s).`);
}

function renderBuilderSteps() {
  const list = $('#builder-steps-list');
  const empty = $('#builder-steps-empty');
  list.innerHTML = '';
  
  if (!builderState.extractedSteps.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  
  builderState.extractedSteps.forEach((step, idx) => {
    const li = document.createElement('li');
    li.className = 'builder-step';
    li.innerHTML = `
      <span class="builder-step-type">${step.type}</span>
      <span class="builder-step-count">×${step.count}</span>
      <span class="builder-step-label">${step.label || step.type}</span>
      <div class="builder-step-actions">
        <button title="Edit" data-idx="${idx}" data-action="edit-step">✎</button>
        <button title="Delete" data-idx="${idx}" data-action="delete-step">✕</button>
      </div>
    `;
    list.appendChild(li);
  });
  
  // Bind edit/delete
  $$('#builder-steps-list [data-action="edit-step"]').forEach(btn => {
    btn.addEventListener('click', () => editStep(btn.dataset.idx));
  });
  $$('#builder-steps-list [data-action="delete-step"]').forEach(btn => {
    btn.addEventListener('click', () => deleteStep(btn.dataset.idx));
  });
}

function editStep(idx) {
  const step = builderState.extractedSteps[idx];
  const newCount = prompt(`Count for "${step.type}" steps:`, step.count);
  if (newCount !== null && !isNaN(newCount) && parseInt(newCount) > 0) {
    step.count = parseInt(newCount);
    renderBuilderSteps();
  }
}

function deleteStep(idx) {
  builderState.extractedSteps.splice(idx, 1);
  renderBuilderSteps();
}

async function assignExercise() {
  // Open assign modal with class pre-selected
  await openAssignModal();
}

async function openAssignModal() {
  // Reuse modal for assign, but with different fields
  modalMode = 'assign';
  $('#modal-title').textContent = 'Assign Exercise';
  $('#modal-submit').textContent = 'Assign';
  $('#modal-field-class-name').hidden = true;
  $('#modal-field-class-pick').hidden = false;
  $('#modal-field-title').hidden = false;
  $('#modal-field-prompt').hidden = false;
  $('#modal-field-steps').hidden = true; // steps come from builder
  $('#modal-class-name').value = '';
  $('#modal-title-input').value = $('#doc-title').value || 'Exercise';
  $('#modal-prompt').value = '';
  $('#modal-steps').value = '';
  $('#modal-error').textContent = '';
  await populateClassPick();
  // Pre-select builder class
  if (builderState.classId) $('#modal-class-pick').value = builderState.classId;
  $('#modal-backdrop').hidden = false;
  setTimeout(() => $('#modal-title-input').focus(), 30);
}

async function submitAssignModal() {
  $('#modal-error').textContent = '';
  const classId = $('#modal-class-pick').value;
  if (!classId) { $('#modal-error').textContent = 'Select a class.'; return; }
  const title = $('#modal-title-input').value.trim();
  if (!title) { $('#modal-error').textContent = 'Enter an exercise title.'; return; }
  const prompt = $('#modal-prompt').value.trim();
  
  // Convert builder steps to exercise steps format
  const steps = builderState.extractedSteps.map(s => ({ type: s.type, count: s.count, label: s.label }));
  
  const { error } = await supabase.from('exercises').insert({ 
    class_id: classId, 
    title, 
    prompt, 
    steps 
  });
  if (error) { $('#modal-error').textContent = error.message; return; }
  
  closeModal();
  exitBuilder();
  showToast(steps.length ? 'Exercise assigned with auto-check.' : 'Exercise assigned.');
  await renderTeacherDashboard();
}

// ---------- Modal (for class creation and assign) ----------

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
  let videoBlob = null;
  if (submit) {
    const btn = $('#submit-work-button');
    if (btn) btn.disabled = true;
    try {
      showToast('Recording your work for submission…');
      videoBlob = await recordSubmissionVideo(serialized);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
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
  let id = existing?.id;
  if (existing) {
    const { error } = await supabase.from('submissions').update(payload).eq('id', existing.id);
    if (error) { showToast(error.message); return; }
  } else {
    const { data, error } = await supabase.from('submissions').insert(payload).select('id').single();
    if (error) { showToast(error.message); return; }
    id = data.id;
    window.__activeSubmission = { id };
  }
  const videoPath = submit ? await storeSubmissionVideo(id, videoBlob) : null;
  const base = graded ? `Submitted! Score: ${graded.score}%` : 'Submitted! Your teacher can now see your work.';
  showToast(videoPath ? base + ' — recording saved.' : base);
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
  
  // Builder buttons
  $('#builder-extract').addEventListener('click', extractSteps);
  $('#builder-preview').addEventListener('click', toggleBuilderPreview);
  $('#builder-assign').addEventListener('click', assignExercise);
  $('#builder-close').addEventListener('click', exitBuilder);
  $('#builder-extract-steps').addEventListener('click', extractSteps);
  $('#builder-clear-steps').addEventListener('click', () => { builderState.extractedSteps = []; renderBuilderSteps(); });
  $('#builder-preview-btn').addEventListener('click', toggleBuilderPreview);
  $('#builder-assign-btn').addEventListener('click', assignExercise);
  
  $('#modal-form').addEventListener('submit', e => { e.preventDefault(); if (modalMode === 'assign') submitAssignModal(); else submitModal(); });
  $('#modal-cancel').addEventListener('click', () => { if (modalMode === 'assign') closeModal(); else closeModal(); });
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal-backdrop').hidden) closeModal(); else if (e.key === 'Escape' && !$('#builder-panel').hidden) exitBuilder(); });
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
    const strip = $('#review-strip'); if (strip) strip.hidden = true;
    if (window.__activeExercise || window.__activeSubmission) {
      window.__activeExercise = null;
      window.__activeSubmission = null;
      if (currentProfile) showDashboard(currentProfile);
      else showWorkspace();
    } else {
      showWorkspace();
    }
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
