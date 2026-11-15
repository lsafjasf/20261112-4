import { defaultProject, PROJECT_FORMAT } from './defaults.js';
import { validateConfig } from './validate.js';

export const STORAGE_KEY = 'asm2d.project';

export function serializeProject(project) {
  return JSON.stringify({
    format: PROJECT_FORMAT,
    savedAt: new Date().toISOString(),
    config: project.config,
    view: project.view,
    activeStateOrder: project.activeStateOrder,
  }, null, 2);
}

export function parseProject(text) {
  const data = JSON.parse(text);
  const validation = validateConfig(data.config);
  if (!validation.ok) {
    const err = new Error('工程校验失败');
    err.validation = validation;
    throw err;
  }
  return {
    config: data.config,
    view: { ...defaultProject().view, ...(data.view || {}) },
    activeStateOrder: Array.isArray(data.activeStateOrder)
      ? data.activeStateOrder : defaultProject().activeStateOrder,
  };
}

export function saveLocal(project) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(project));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function loadLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return parseProject(raw);
}

export function clearLocal() {
  localStorage.removeItem(STORAGE_KEY);
}
