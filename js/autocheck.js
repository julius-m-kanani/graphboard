// Auto-check engine: scores a student's saved actions against the exercise's
// steps. A step is { type, count, label }. Scoring is additive: a step is
// satisfied if at least `count` actions of that type exist on the page.
const STEP_TYPES = ['line', 'ruler', 'set-square', 'point', 'circle', 'compass', 'angle', 'protractor', 'pencil', 'plot'];

export function parseSteps(raw) {
  if (Array.isArray(raw)) return raw.filter(s => s && STEP_TYPES.includes(s.type));
  if (typeof raw !== 'string') return [];
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(s => STEP_TYPES.includes(s)).map(type => ({ type, count: 1 }));
}

export function grade(exercise, actions) {
  const steps = parseSteps(exercise?.steps || []);
  if (!steps.length) return null;
  const counts = {};
  (actions || []).forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1; });
  const results = steps.map(step => {
    const have = counts[step.type] || 0;
    const ok = have >= (step.count || 1);
    return {
      type: step.type,
      expected: step.count || 1,
      found: have,
      ok,
      label: step.label || step.type
    };
  });
  const passed = results.filter(r => r.ok).length;
  const score = Math.round((passed / results.length) * 100);
  const feedback = passed === results.length
    ? 'All steps completed. Well done!'
    : `Completed ${passed} of ${results.length} steps. Missing: ${results.filter(r => !r.ok).map(r => r.type).join(', ')}.`;
  return { score, feedback, results };
}

export function gradeSubmission(exercise, serializedState) {
  const actions = serializedState?.actions || [];
  const result = grade(exercise, actions);
  if (!result) return null;
  return { score: result.score, feedback: result.feedback };
}
