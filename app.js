const vaultButton = document.querySelector('#vaultButton');
const welcomeVaultButton = document.querySelector('#welcomeVaultButton');
const tree = document.querySelector('#projectTree');
const content = document.querySelector('#content');
const createDialog = document.querySelector('#createDialog');
const createForm = document.querySelector('#createForm');
const nameInput = document.querySelector('#nameInput');
const saveState = document.querySelector('#saveState');
const toast = document.querySelector('#toast');
const themeToggleButton = document.querySelector('#themeToggleButton');

let vaultHandle = null;
let savedVaultHandle = null;
let projects = [];
let currentProject = null;
let currentFolder = null;
let currentFolderParent = null;
let currentFolderPath = [];
let activeNote = null;
let activeNotePath = [];
let createMode = 'project';
let expandedPaths = new Set();
let saveTimer = null;
let toastTimer = null;
let previewObjectUrls = [];

const IMAGE_DIRECTORY_NAME = '__data';
const LEGACY_IMAGE_DIRECTORY_NAMES = ['__images', '__images__'];
const ARCHIVE_DIRECTORY_NAME = '__bin';
const HIDDEN_DIRECTORY_NAMES = new Set([IMAGE_DIRECTORY_NAME, ...LEGACY_IMAGE_DIRECTORY_NAMES, 'images', ARCHIVE_DIRECTORY_NAME]);
const LAST_PROJECT_STORAGE_KEY = 'notizraum.last-project';
const VAULT_HANDLE_DATABASE = 'notizraum-browser-settings';
const VAULT_HANDLE_STORE = 'handles';
const SAVED_VAULT_HANDLE_KEY = 'last-vault';
const FOLDER_METADATA_FILENAME = '.data.json';
const PROJECT_ORDER_FILENAME = '.projects.json';
const THEME_STORAGE_KEY = 'notizraum.theme';
const languageCatalog = window.NOTIZRAUM_LANGUAGE;
const locale = languageCatalog.locale;
const messages = languageCatalog.messages;
const folderMetadataWrites = new WeakMap();

function translate(key, values = {}) {
  const template = messages[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? `{${name}}`));
}

function applyStaticTranslations() {
  document.documentElement.lang = locale;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = translate(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = translate(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = translate(element.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', translate(element.dataset.i18nAriaLabel));
  });
}

function applyDefaultTranslations() {
  applyStaticTranslations();
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
}

function applyTheme(theme, savePreference = false) {
  const isDark = theme === 'dark';
  const action = translate(isDark ? 'themeEnableLight' : 'themeEnableDark');
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  themeToggleButton.setAttribute('aria-label', action);
  themeToggleButton.setAttribute('title', action);
  themeToggleButton.setAttribute('aria-pressed', String(isDark));
  themeToggleButton.querySelector('span').textContent = isDark ? '☀' : '☾';
  document.querySelector('meta[name="theme-color"]').content = isDark ? '#171d19' : '#f7f7f4';
  if (savePreference) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch {
      // The theme still changes for the current session if storage is unavailable
    }
  }
}

try {
  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light');
} catch {
  applyTheme('light');
}

const supportsFileAccess = 'showDirectoryPicker' in window;
if (!supportsFileAccess) document.querySelector('#compatibilityNote').hidden = false;

vaultButton.addEventListener('click', chooseVault);
welcomeVaultButton.addEventListener('click', chooseVault);
themeToggleButton.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
});
document.querySelector('#newProjectButton').addEventListener('click', () => openCreateDialog('project'));
document.querySelector('#newFolderButton').addEventListener('click', () => openCreateDialog('folder'));
document.querySelector('#newNoteButton').addEventListener('click', () => openCreateDialog('note'));
document.querySelector('#renameItemButton').addEventListener('click', renameSelectedItem);
document.querySelector('#deleteItemButton').addEventListener('click', deleteSelectedItem);
document.querySelector('#emptyTrashButton').addEventListener('click', emptyTrash);
document.querySelector('#closeDialog').addEventListener('click', () => createDialog.close());
document.querySelector('#cancelDialog').addEventListener('click', () => createDialog.close());
createForm.addEventListener('submit', handleCreate);
void initializeApp();

async function initializeApp() {
  applyDefaultTranslations();
  renderLastProjectHint();
  await restoreSavedVault();
}

async function chooseVault() {
  if (!supportsFileAccess) {
    showToast(translate('vaultOpenUnsupported'));
    return;
  }
  try {
    const picked = await window.showDirectoryPicker({ mode: 'readwrite' });
    await connectVault(picked, true);
  } catch (error) {
    if (error.name !== 'AbortError') showToast(translate('vaultOpenError', { details: error.message }));
  }
}

async function restoreSavedVault() {
  if (!supportsFileAccess) return;
  try {
    const handle = await getSavedVaultHandle();
    if (!handle) return;
    savedVaultHandle = handle;
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') await connectVault(handle, false);
    else {
      const hint = document.querySelector('#lastProjectHint');
      if (hint) {
        const lastProject = loadLastProject();
        hint.textContent = lastProject
          ? translate('lastProjectPermissionHint', { projectName: lastProject.projectName })
          : translate('vaultPermissionRequired');
        hint.hidden = false;
      }
    }
  } catch (error) {
    showToast(translate('vaultRestoreError', { details: error.message }));
  }
}

async function connectVault(handle, requestPermission) {
  let permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted' && requestPermission) permission = await handle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    showToast(translate('vaultPermissionRequired'));
    return false;
  }

  vaultHandle = handle;
  savedVaultHandle = handle;
  try {
    await handle.getDirectoryHandle(ARCHIVE_DIRECTORY_NAME, { create: true });
  } catch (error) {
    showToast(translate('archiveCreateError', { archiveName: ARCHIVE_DIRECTORY_NAME, details: error.message }));
  }
  currentProject = null;
  currentFolder = null;
  currentFolderParent = null;
  currentFolderPath = [];
  activeNote = null;
  activeNotePath = [];
  const lastProjectHint = document.querySelector('#lastProjectHint');
  if (lastProjectHint) lastProjectHint.hidden = true;
  document.querySelector('#vaultName').textContent = handle.name;
  document.querySelector('#vaultHint').textContent = translate('vaultConnectedHint');
  document.querySelector('#newProjectButton').disabled = false;
  await updateTrashButton();
  try {
    await saveVaultHandle(handle);
  } catch (error) {
    showToast(translate('vaultRememberError', { details: error.message }));
  }
  await refreshProjects();
  const lastProject = loadLastProject();
  const restoredProject = lastProject?.vaultName === handle.name
    ? projects.find((project) => project.name === lastProject.projectName)
    : null;
  if (restoredProject) {
    currentProject = restoredProject;
    currentFolder = restoredProject.handle;
    currentFolderParent = handle;
    currentFolderPath = [restoredProject.name];
    expandedPaths.add(pathKey(currentFolderPath));
    await renderTree();
    renderProject(restoredProject);
  } else if (projects.length === 0) renderEmptyWorkspace();
  updateControls();
  setSaveState('saved', 'saveReady');
  return true;
}

function openHandleDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VAULT_HANDLE_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(VAULT_HANDLE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveVaultHandle(handle) {
  const database = await openHandleDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(VAULT_HANDLE_STORE, 'readwrite');
      transaction.objectStore(VAULT_HANDLE_STORE).put(handle, SAVED_VAULT_HANDLE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function getSavedVaultHandle() {
  const database = await openHandleDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(VAULT_HANDLE_STORE, 'readonly');
      const request = transaction.objectStore(VAULT_HANDLE_STORE).get(SAVED_VAULT_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

function loadLastProject() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_PROJECT_STORAGE_KEY) || 'null');
    return saved && typeof saved.vaultName === 'string' && typeof saved.projectName === 'string' ? saved : null;
  } catch {
    return null;
  }
}

function renderLastProjectHint() {
  const hint = document.querySelector('#lastProjectHint');
  const saved = loadLastProject();
  if (!hint || !saved) return;
  hint.textContent = translate('lastProjectHint', { projectName: saved.projectName });
  hint.hidden = false;
}

function rememberLastProject(project) {
  if (!vaultHandle || !project) return;
  try {
    localStorage.setItem(LAST_PROJECT_STORAGE_KEY, JSON.stringify({ vaultName: vaultHandle.name, projectName: project.name }));
    const hint = document.querySelector('#lastProjectHint');
    if (hint) hint.hidden = true;
  } catch {
    showToast(translate('rememberProjectError'));
  }
}

function forgetLastProject(project) {
  const saved = loadLastProject();
  if (saved?.vaultName !== vaultHandle?.name || saved?.projectName !== project.name) return;
  try {
    localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
    const hint = document.querySelector('#lastProjectHint');
    if (hint) hint.hidden = true;
  } catch {
    // The deleted project will not be found on the next start, even if this preference remains
  }
}

async function refreshProjects() {
  projects = [];
  for await (const [name, handle] of vaultHandle.entries()) {
    if (handle.kind === 'directory' && !name.startsWith('.') && !HIDDEN_DIRECTORY_NAMES.has(name.toLocaleLowerCase('en-US'))) projects.push({ name, handle });
  }
  const storedOrder = await readProjectOrder();
  const orderIndex = new Map(storedOrder.map((name, index) => [name, index]));
  projects.sort((a, b) => {
    const aIndex = orderIndex.get(a.name);
    const bIndex = orderIndex.get(b.name);
    if (aIndex !== undefined || bIndex !== undefined) return (aIndex ?? Number.MAX_SAFE_INTEGER) - (bIndex ?? Number.MAX_SAFE_INTEGER);
    return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
  });
  await renderTree();
}

async function readProjectOrder() {
  try {
    const handle = await vaultHandle.getFileHandle(PROJECT_ORDER_FILENAME);
    const data = JSON.parse(await (await handle.getFile()).text());
    return Array.isArray(data.order) ? data.order.filter((name) => typeof name === 'string') : [];
  } catch (error) {
    if (error.name !== 'NotFoundError') console.warn(translate('projectOrderReadError'), error);
    return [];
  }
}

async function saveProjectOrder(order) {
  const handle = await vaultHandle.getFileHandle(PROJECT_ORDER_FILENAME, { create: true });
  await writeFile(handle, `${JSON.stringify({ version: 1, order }, null, 2)}\n`);
}

async function renderTree() {
  tree.replaceChildren();
  if (!vaultHandle) {
    tree.innerHTML = `<div class="tree-empty">${escapeHtml(translate('treeConnectPrompt'))}</div>`;
    return;
  }
  if (projects.length === 0) {
    tree.innerHTML = `<div class="tree-empty">${escapeHtml(translate('treeNoProjects'))}</div>`;
    return;
  }
  for (const project of projects) {
    const path = [project.name];
    const expanded = expandedPaths.has(pathKey(path));
    const childCount = await countVisibleEntries(project.handle);
    const row = makeTreeRow(project.name, 'project', path, expanded, currentProject?.name === project.name && !activeNote && pathKey(currentFolderPath) === pathKey(path), childCount);
    tree.append(row);
    row.addEventListener('click', async () => {
      currentProject = project;
      currentFolder = project.handle;
      currentFolderParent = vaultHandle;
      currentFolderPath = path;
      activeNote = null;
      activeNotePath = [];
      rememberLastProject(project);
      toggleExpanded(path);
      await renderTree();
      renderProject(project);
      updateControls();
    });
    attachDragSource(row, 'project', path);
    attachProjectDropTarget(row, project);
    if (expanded) {
      const children = document.createElement('div');
      children.className = 'tree-children';
      await appendDirectoryEntries(children, project.handle, path);
      tree.append(children);
    }
  }
}

async function countVisibleEntries(directoryHandle) {
  let count = 0;
  try {
    for await (const [name, handle] of directoryHandle.entries()) {
      if (handle.kind === 'directory') {
        if (!HIDDEN_DIRECTORY_NAMES.has(name.toLocaleLowerCase('en-US'))) count++;
      } else if (name.toLowerCase().endsWith('.md')) count++;
    }
    return count;
  } catch (error) {
    console.warn(translate('treeReadError'), error);
    return null;
  }
}

async function appendDirectoryEntries(parent, directoryHandle, parentPath) {
  const entries = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === 'directory' && !HIDDEN_DIRECTORY_NAMES.has(name.toLocaleLowerCase('en-US'))) entries.push({ name, handle, kind: 'folder' });
    else if (name.toLowerCase().endsWith('.md')) entries.push({ name, handle, kind: 'note' });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
  });
  for (const entry of entries) {
    const path = [...parentPath, entry.name];
    const expanded = entry.kind === 'folder' && expandedPaths.has(pathKey(path));
    const isActiveNote = entry.kind === 'note' && activeNotePath.length > 0 && pathKey(activeNotePath) === pathKey(path);
    const isActiveFolder = entry.kind === 'folder' && !activeNote && pathKey(currentFolderPath) === pathKey(path);
    const childCount = entry.kind === 'folder' ? await countVisibleEntries(entry.handle) : null;
    const row = makeTreeRow(entry.kind === 'note' ? entry.name.replace(/\.md$/i, '') : entry.name, entry.kind, path, expanded, isActiveNote || isActiveFolder, childCount);
    parent.append(row);
    row.addEventListener('click', async (event) => {
      event.stopPropagation();
      currentProject = projects.find((project) => project.name === parentPath[0]) ?? null;
      rememberLastProject(currentProject);
      if (entry.kind === 'folder') {
        currentFolder = entry.handle;
        currentFolderParent = directoryHandle;
        currentFolderPath = path;
        activeNote = null;
        activeNotePath = [];
        toggleExpanded(path);
        await renderTree();
        renderFolder(entry.name, path);
      } else {
        currentFolder = directoryHandle;
        currentFolderPath = parentPath;
        await openNote(entry.handle, path, directoryHandle);
        await renderTree();
      }
      updateControls();
    });
    if (entry.kind === 'folder') {
      attachDragSource(row, 'folder', path);
      attachDropTarget(row, 'folder', path);
    }
    else attachDragSource(row, 'note', path);
    if (expanded) {
      const nested = document.createElement('div');
      nested.className = 'tree-children';
      parent.append(nested);
      await appendDirectoryEntries(nested, entry.handle, path);
    }
  }
}

function makeTreeRow(label, kind, path, expanded, active, childCount = null) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `tree-item${kind === 'project' ? ' project-row' : ''}${kind === 'note' ? ' note-row' : ''}${active ? ' active' : ''}`;
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-expanded', String(expanded));
  row.style.paddingLeft = kind === 'project' ? '8px' : '7px';
  const arrow = document.createElement('span');
  arrow.className = 'tree-arrow';
  arrow.textContent = kind === 'note' ? '' : (expanded ? '▾' : '▸');
  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = kind === 'note' ? '◌' : (kind === 'project' ? '▰' : '▱');
  const text = document.createElement('span');
  text.className = 'tree-label';
  text.textContent = label;
  row.append(arrow, icon, text);
  if (childCount > 0) {
    const count = document.createElement('span');
    count.className = 'tree-count';
    count.textContent = `(${childCount})`;
    count.title = translate(childCount === 1 ? 'treeCountTooltipOne' : 'treeCountTooltipMany', { count: childCount });
    row.append(count);
  }
  return row;
}

function attachDragSource(row, kind, path) {
  row.draggable = true;
  row.title = translate('dragSourceTooltip');
  row.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('application/x-notizraum-entry', JSON.stringify({ kind, path }));
    event.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    tree.querySelectorAll('.drop-target').forEach((target) => target.classList.remove('drop-target'));
  });
}

function attachDropTarget(row, kind, path) {
  row.title = translate('dropFolderTooltip');
  row.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('application/x-notizraum-entry')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', (event) => {
    if (!row.contains(event.relatedTarget)) row.classList.remove('drop-target');
  });
  row.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    row.classList.remove('drop-target');
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/x-notizraum-entry'));
      void moveTreeEntry(payload, { kind, path });
    } catch (error) {
      showToast(translate('treeMoveError', { details: error.message }));
    }
  });
}

function attachProjectDropTarget(row, project) {
  row.title = translate('dropProjectTooltip');
  row.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('application/x-notizraum-entry')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = row.getBoundingClientRect();
    row.dataset.dropPosition = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
    row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', (event) => {
    if (!row.contains(event.relatedTarget)) {
      row.classList.remove('drop-target');
      delete row.dataset.dropPosition;
    }
  });
  row.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const position = row.dataset.dropPosition ?? 'after';
    row.classList.remove('drop-target');
    delete row.dataset.dropPosition;
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/x-notizraum-entry'));
      if (payload.kind === 'project') void reorderProject(payload.path?.[0], project.name, position);
      else void moveTreeEntry(payload, { kind: 'project', path: [project.name] });
    } catch (error) {
      showToast(translate('treeMoveError', { details: error.message }));
    }
  });
}

async function reorderProject(sourceName, targetName, position) {
  if (!sourceName || !targetName || sourceName === targetName) return;
  const order = projects.map((project) => project.name);
  const sourceIndex = order.indexOf(sourceName);
  const targetIndex = order.indexOf(targetName);
  if (sourceIndex < 0 || targetIndex < 0) return;

  order.splice(sourceIndex, 1);
  const adjustedTargetIndex = order.indexOf(targetName);
  order.splice(adjustedTargetIndex + (position === 'after' ? 1 : 0), 0, sourceName);
  if (order.every((name, index) => name === projects[index].name)) return;

  try {
    await saveProjectOrder(order);
    projects.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    await renderTree();
    showToast(translate('projectOrderSaved'));
  } catch (error) {
    showToast(translate('projectOrderSaveError', { details: error.message }));
  }
}

function toggleExpanded(path) {
  const key = pathKey(path);
  expandedPaths.has(key) ? expandedPaths.delete(key) : expandedPaths.add(key);
}

function pathKey(path) { return path.join('\u0000'); }

function openCreateDialog(mode) {
  if (!vaultHandle && mode === 'project') return chooseVault();
  if (mode !== 'project' && !currentProject) {
    showToast(translate('selectProjectFirst'));
    return;
  }
  createMode = mode;
  let settings;
  if (mode === 'project') {
    settings = { title: translate('createProjectTitle'), description: translate('createProjectDescription'), label: translate('projectNameLabel'), submit: translate('createProjectButton'), placeholder: translate('sampleProject'), hint: translate('projectCreateHint') };
  } else if (mode === 'folder') {
    const isSubfolder = currentFolderPath.length > 1;
    const path = currentFolderPath.slice(1).join(' / ') || currentProject.name;
    settings = {
      title: translate(isSubfolder ? 'createSubfolderTitle' : 'createFolderTitle'),
      description: translate('createFolderDescription'),
      label: translate(isSubfolder ? 'createSubfolderNameLabel' : 'createFolderNameLabel'),
      submit: translate(isSubfolder ? 'createSubfolderButton' : 'createFolderButton'),
      placeholder: translate('sampleFolder'), hint: translate('createFolderHint', { path })
    };
  } else {
    settings = { title: translate('createNoteTitle'), description: translate('createNoteDescription'), label: translate('createNoteNameLabel'), submit: translate('createNoteButton'), placeholder: translate('sampleNote'), hint: translate('createNoteHint') };
  }
  document.querySelector('#dialogEyebrow').textContent = translate(mode === 'note' ? 'createMarkdownEyebrow' : 'createEyebrow');
  document.querySelector('#dialogTitle').textContent = settings.title;
  document.querySelector('#dialogDescription').textContent = settings.description;
  document.querySelector('#nameLabel').textContent = settings.label;
  document.querySelector('#createSubmit').textContent = settings.submit;
  document.querySelector('#inputHint').textContent = settings.hint;
  nameInput.placeholder = settings.placeholder;
  nameInput.value = '';
  clearCreateError();
  createDialog.showModal();
  requestAnimationFrame(() => nameInput.focus());
}

function showCreateError(message) {
  const errorMessage = document.querySelector('#createError');
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  nameInput.setAttribute('aria-invalid', 'true');
  nameInput.focus();
}

function clearCreateError() {
  const errorMessage = document.querySelector('#createError');
  errorMessage.textContent = '';
  errorMessage.hidden = true;
  nameInput.removeAttribute('aria-invalid');
}

async function handleCreate(event) {
  event.preventDefault();
  clearCreateError();
  const name = sanitizeName(nameInput.value);
  if (!name) {
    showCreateError(translate('validNameRequired'));
    return;
  }
  try {
    if (createMode === 'project') {
      const projectNameExists = projects.some((project) => project.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'));
      if (projectNameExists || await entryExists(vaultHandle, name)) {
        showCreateError(translate('duplicateProject', { name }));
        return;
      }
      const handle = await vaultHandle.getDirectoryHandle(name, { create: true });
      await ensureFolderMetadata(handle);
      currentProject = { name, handle };
      currentFolder = handle;
      currentFolderParent = vaultHandle;
      currentFolderPath = [name];
      expandedPaths.add(pathKey([name]));
      activeNote = null;
      rememberLastProject(currentProject);
      await refreshProjects();
      renderProject(currentProject);
    } else if (createMode === 'folder') {
      const parentFolder = currentFolder;
      if (await entryExists(parentFolder, name)) {
        showCreateError(translate('duplicateFolderEntry', { name }));
        return;
      }
      const handle = await parentFolder.getDirectoryHandle(name, { create: true });
      await ensureFolderMetadata(handle);
      const path = [...selectedFolderPath(), name];
      expandedPaths.add(pathKey(path.slice(0, -1)));
      expandedPaths.add(pathKey(path));
      currentFolder = handle;
      currentFolderParent = parentFolder;
      currentFolderPath = path;
      activeNote = null;
      await refreshProjects();
      renderFolder(name, path);
    } else {
      const filename = name.toLowerCase().endsWith('.md') ? name : `${name}.md`;
      if (await entryExists(currentFolder, filename)) {
        showCreateError(translate('duplicateNote', { name: filename }));
        return;
      }
      const fileHandle = await currentFolder.getFileHandle(filename, { create: true });
      const relativePath = [...selectedFolderPath(), filename];
      await writeFile(fileHandle, '');
      const createdAt = new Date().toISOString();
      await setNoteMetadata(currentFolder, filename, createdAt, createdAt);
      expandedPaths.add(pathKey(relativePath.slice(0, -1)));
      await openNote(fileHandle, relativePath, currentFolder);
      await refreshProjects();
    }
    createDialog.close();
    updateControls();
    setSaveState('saved', 'saveSaved');
    showToast(translate(createMode === 'note' ? 'noteCreated' : createMode === 'folder' ? 'folderCreated' : 'projectCreated'));
  } catch (error) {
    showCreateError(translate('createFailed', { details: error.message }));
  }
}

function sanitizeName(value) {
  return value.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/[. ]+$/g, '').slice(0, 80);
}

function imageReferencesInMarkdown(markdown) {
  const references = new Map();
  const imagePattern = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const match of markdown.matchAll(imagePattern)) {
    const source = match[1];
    for (const directoryName of [IMAGE_DIRECTORY_NAME, ...LEGACY_IMAGE_DIRECTORY_NAMES]) {
      const prefix = `${directoryName}/`;
      if (!source.startsWith(prefix)) continue;
      const filename = source.slice(prefix.length);
      if (!filename || filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') continue;
      if (!references.has(directoryName)) references.set(directoryName, new Set());
      references.get(directoryName).add(filename);
    }
  }
  return references;
}

async function removeUnreferencedImages(directoryHandle) {
  const referencedImages = new Map();
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.md')) continue;
    const markdown = await (await handle.getFile()).text();
    for (const [directoryName, filenames] of imageReferencesInMarkdown(markdown)) {
      if (!referencedImages.has(directoryName)) referencedImages.set(directoryName, new Set());
      for (const filename of filenames) referencedImages.get(directoryName).add(filename);
    }
  }

  for (const directoryName of [IMAGE_DIRECTORY_NAME, ...LEGACY_IMAGE_DIRECTORY_NAMES]) {
    let imagesDirectory;
    try {
      imagesDirectory = await directoryHandle.getDirectoryHandle(directoryName);
    } catch (error) {
      if (error.name === 'NotFoundError') continue;
      throw error;
    }

    const usedFiles = referencedImages.get(directoryName) ?? new Set();
    for await (const [name, handle] of imagesDirectory.entries()) {
      if (handle.kind === 'file' && !usedFiles.has(name)) await imagesDirectory.removeEntry(name);
    }

    let isEmpty = true;
    for await (const _entry of imagesDirectory.entries()) {
      isEmpty = false;
      break;
    }
    if (isEmpty) await directoryHandle.removeEntry(directoryName);
  }
}

async function collectTrashEntries(directoryHandle, path = []) {
  const entries = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    if (name.toLocaleLowerCase('en-US') === '.ds_store') continue;
    const entryPath = [...path, name];
    entries.push({ name, path: entryPath, kind: handle.kind });
    if (handle.kind === 'directory') entries.push(...await collectTrashEntries(handle, entryPath));
  }
  return entries;
}

async function updateTrashButton() {
  const button = document.querySelector('#emptyTrashButton');
  if (!button) return;
  if (!vaultHandle) {
    button.disabled = true;
    button.textContent = translate('trashButtonEmpty');
    return;
  }
  try {
    const trash = await vaultHandle.getDirectoryHandle(ARCHIVE_DIRECTORY_NAME, { create: true });
    const entries = await collectTrashEntries(trash);
    button.disabled = entries.length === 0;
    button.textContent = translate('trashButtonCount', { count: entries.length });
    button.title = entries.length === 0
      ? translate('trashEmptyTooltip')
      : translate(entries.length === 1 ? 'trashTooltipOne' : 'trashTooltipMany', { count: entries.length });
  } catch (error) {
    button.disabled = true;
    button.textContent = translate('trashButtonEmpty');
    showToast(translate('trashReadError', { details: error.message }));
  }
}

async function emptyTrash() {
  if (!vaultHandle) return;
  try {
    const trash = await vaultHandle.getDirectoryHandle(ARCHIVE_DIRECTORY_NAME, { create: true });
    const entries = await collectTrashEntries(trash);
    if (entries.length === 0) {
      await updateTrashButton();
      return;
    }

    const listing = entries.map((entry) => `${entry.kind === 'directory' ? '📁' : '📄'} ${entry.path.join('/')}`).join('\n');
    const confirmation = translate('trashConfirmIntro', { listing })
      + translate(entries.length === 1 ? 'trashConfirmOne' : 'trashConfirmMany', { count: entries.length });
    const confirmed = window.confirm(confirmation);
    if (!confirmed) return;

    const topLevelEntries = [];
    for await (const [name, handle] of trash.entries()) topLevelEntries.push([name, handle.kind]);
    for (const [name, kind] of topLevelEntries) {
      await trash.removeEntry(name, { recursive: kind === 'directory' });
    }
    await updateTrashButton();
    showToast(translate(entries.length === 1 ? 'trashEmptiedOne' : 'trashEmptiedMany', { count: entries.length }));
  } catch (error) {
    showToast(translate('trashEmptyError', { details: error.message }));
    await updateTrashButton();
  }
}

function selectedFolderPath() {
  if (!currentProject) return [];
  if (!currentFolder || currentFolder === currentProject.handle) return [currentProject.name];
  return currentFolderPath.length ? currentFolderPath : [currentProject.name];
}

async function openNote(fileHandle, path, directoryHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  await ensureNoteMetadata(directoryHandle, path.at(-1), file.lastModified);
  const metadata = await readFolderMetadata(directoryHandle);
  const noteMetadata = metadata.files[path.at(-1)] ?? {};
  activeNote = {
    handle: fileHandle,
    directoryHandle,
    filename: path.at(-1),
    name: path.at(-1).replace(/\.md$/i, ''),
    createdAt: noteMetadata.createdAt,
    modifiedAt: noteMetadata.modifiedAt
  };
  activeNotePath = path;
  renderEditor(text);
  setBreadcrumb(path);
}

function renderProject(project) {
  content.innerHTML = `<div class="empty-note"><div class="welcome-icon" aria-hidden="true">▰</div><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(translate('projectReadyDescription'))}</p><div class="empty-actions"><button class="button button-primary" type="button" id="emptyNewNote">${escapeHtml(translate('emptyNewNote'))}</button><button class="button button-secondary" type="button" id="emptyNewFolder">${escapeHtml(translate('emptyNewSubfolder'))}</button></div></div>`;
  document.querySelector('#emptyNewNote').addEventListener('click', () => openCreateDialog('note'));
  document.querySelector('#emptyNewFolder').addEventListener('click', () => openCreateDialog('folder'));
  setBreadcrumb([project.name]);
}

function renderFolder(name, path) {
  content.innerHTML = `<div class="empty-note"><div class="welcome-icon" aria-hidden="true">▱</div><h2>${escapeHtml(name)}</h2><p>${escapeHtml(translate('folderReadyDescription'))}</p><div class="empty-actions"><button class="button button-primary" type="button" id="emptyNewNote">${escapeHtml(translate('emptyNewNote'))}</button><button class="button button-secondary" type="button" id="emptyNewFolder">${escapeHtml(translate('emptyNewSubfolder'))}</button></div></div>`;
  document.querySelector('#emptyNewNote').addEventListener('click', () => openCreateDialog('note'));
  document.querySelector('#emptyNewFolder').addEventListener('click', () => openCreateDialog('folder'));
  setBreadcrumb(path);
}

function renderEmptyWorkspace() {
  content.innerHTML = `<div class="empty-note"><div class="welcome-icon" aria-hidden="true">✳</div><h2>${escapeHtml(translate('emptyWorkspaceTitle'))}</h2><p>${escapeHtml(translate('emptyWorkspaceDescription'))}</p><button class="button button-primary" type="button" id="emptyNewProject">${escapeHtml(translate('emptyNewProject'))}</button></div>`;
  document.querySelector('#emptyNewProject').addEventListener('click', () => openCreateDialog('project'));
  document.querySelector('#breadcrumb').textContent = translate('breadcrumbWorkspace');
}

function renderEditor(markdown) {
  revokePreviewObjectUrls();
  content.innerHTML = `<div class="editor-shell"><div class="editor-heading"><div class="editor-title"><h1>${escapeHtml(activeNote.name)}</h1><p>${escapeHtml(translate('noteFileType'))}<span class="note-timestamps" id="noteTimestamps"></span></p></div><div class="view-toggle" role="tablist" aria-label="${escapeHtml(translate('viewTabsLabel'))}"><button type="button" role="tab" aria-selected="false" data-view="edit">${escapeHtml(translate('editTab'))}</button><button class="selected" role="tab" aria-selected="true" data-view="preview">${escapeHtml(translate('previewTab'))}</button></div></div><div class="editor-area"><textarea class="markdown-editor" aria-label="${escapeHtml(translate('markdownEditorLabel'))}" spellcheck="false" hidden></textarea><article class="markdown-preview"></article></div></div>`;
  const editor = content.querySelector('.markdown-editor');
  const preview = content.querySelector('.markdown-preview');
  const note = activeNote;
  renderNoteTimestamps(note);
  editor.value = markdown;
  void updateMarkdownPreview(preview, markdown, note);
  editor.addEventListener('input', () => {
    setSaveState('saving', 'saveUnsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNote(editor.value, note), 450);
  });
  preview.addEventListener('change', (event) => {
    const checkbox = event.target instanceof HTMLInputElement ? event.target : null;
    if (!checkbox?.matches('input[data-task-index]')) return;
    if (!preview.contains(checkbox)) return;
    const lines = editor.value.split(/\r?\n/);
    const lineIndex = Number(checkbox.dataset.taskIndex);
    const task = lines[lineIndex]?.match(/^(\s*[-*+]\s+\[)[ xX](\]\s+.*)$/);
    if (!task) return;
    lines[lineIndex] = `${task[1]}${checkbox.checked ? 'x' : ' '}${task[2]}`;
    editor.value = lines.join('\n');
    setSaveState('saving', 'saveUnsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNote(editor.value, note), 450);
  });
  editor.addEventListener('paste', (event) => handleImagePaste(event, editor, note));
  content.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    const isPreview = button.dataset.view === 'preview';
    content.querySelectorAll('[data-view]').forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle('selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    editor.hidden = isPreview;
    preview.hidden = !isPreview;
    if (isPreview) void updateMarkdownPreview(preview, editor.value, note);
  }));
}

async function saveNote(text, note = activeNote) {
  if (!note) return false;
  try {
    await writeFile(note.handle, text);
    note.modifiedAt = new Date().toISOString();
    await setNoteMetadata(note.directoryHandle, note.filename, undefined, note.modifiedAt);
    try {
      await removeUnreferencedImages(note.directoryHandle);
    } catch (error) {
      showToast(translate('unusedImageCleanupError', { details: error.message }));
    }
    if (activeNote === note) renderNoteTimestamps(note);
    setSaveState('saved', 'saveSaved');
    return true;
  } catch (error) {
    setSaveState('error', 'saveFailed');
    showToast(translate('saveFailedDetails', { details: error.message }));
    return false;
  }
}

function renderNoteTimestamps(note) {
  const timestamp = document.querySelector('#noteTimestamps');
  if (!timestamp || !note) return;
  const format = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? translate('unknownDate') : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };
  timestamp.textContent = ` · ${translate('timestampCreated', { date: format(note.createdAt) })} · ${translate('timestampModified', { date: format(note.modifiedAt) })}`;
}

async function writeFile(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function ensureFolderMetadata(directoryHandle, createdAt = new Date().toISOString()) {
  await updateFolderMetadata(directoryHandle, (metadata) => {
    if (!metadata.createdAt) metadata.createdAt = createdAt;
    return metadata;
  });
}

async function ensureNoteMetadata(directoryHandle, filename, fileLastModified) {
  const fallbackTimestamp = new Date(fileLastModified || Date.now()).toISOString();
  await updateFolderMetadata(directoryHandle, (metadata) => {
    const note = metadata.files[filename] && typeof metadata.files[filename] === 'object' ? metadata.files[filename] : null;
    if (!note) metadata.files[filename] = { createdAt: fallbackTimestamp, modifiedAt: fallbackTimestamp };
    return metadata;
  });
}

async function setNoteMetadata(directoryHandle, filename, createdAt, modifiedAt) {
  await updateFolderMetadata(directoryHandle, (metadata) => {
    const previous = metadata.files[filename] && typeof metadata.files[filename] === 'object' ? metadata.files[filename] : {};
    metadata.files[filename] = {
      createdAt: previous.createdAt || createdAt || new Date().toISOString(),
      modifiedAt: modifiedAt || previous.modifiedAt || createdAt || new Date().toISOString()
    };
    return metadata;
  });
}

async function readFolderMetadata(directoryHandle) {
  let fileHandle;
  try {
    fileHandle = await directoryHandle.getFileHandle(FOLDER_METADATA_FILENAME);
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
    return { version: 1, createdAt: null, files: {} };
  }
  try {
    const contents = await (await fileHandle.getFile()).text();
    const metadata = JSON.parse(contents);
    return {
      version: 1,
      createdAt: typeof metadata.createdAt === 'string' ? metadata.createdAt : null,
      files: metadata.files && typeof metadata.files === 'object' && !Array.isArray(metadata.files) ? metadata.files : {}
    };
  } catch {
    return { version: 1, createdAt: null, files: {} };
  }
}

function updateFolderMetadata(directoryHandle, update) {
  const previousWrite = folderMetadataWrites.get(directoryHandle) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => {}).then(async () => {
    const metadata = await readFolderMetadata(directoryHandle);
    const updated = update(metadata);
    const fileHandle = await directoryHandle.getFileHandle(FOLDER_METADATA_FILENAME, { create: true });
    await writeFile(fileHandle, `${JSON.stringify(updated, null, 2)}\n`);
  });
  folderMetadataWrites.set(directoryHandle, nextWrite);
  return nextWrite;
}

async function removeNoteMetadata(directoryHandle, filename) {
  await updateFolderMetadata(directoryHandle, (metadata) => {
    delete metadata.files[filename];
    return metadata;
  });
}

async function entryExists(directory, name) {
  for await (const [entryName] of directory.entries()) {
    if (entryName.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')) return true;
  }
  return false;
}

async function entryExistsExcept(directory, name, excludedName) {
  for await (const [entryName] of directory.entries()) {
    if (entryName !== excludedName && entryName.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')) return true;
  }
  return false;
}

async function temporaryEntryName(parent) {
  let name;
  do {
    name = `__notizraum_rename_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  } while (await entryExists(parent, name));
  return name;
}

function setSaveState(state, label) {
  saveState.className = `save-state ${state}`;
  saveState.dataset.messageKey = label;
  if (state === 'saved' && label === 'saveReady') {
    saveState.hidden = true;
    saveState.textContent = '';
    return;
  }
  saveState.hidden = false;
  saveState.textContent = translate(label);
}

function setBreadcrumb(path) {
  const breadcrumb = document.querySelector('#breadcrumb');
  breadcrumb.replaceChildren();
  const isCurrentNotePath = activeNote && pathKey(activeNotePath) === pathKey(path);
  path.forEach((part, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'crumb-separator';
      separator.textContent = '/';
      breadcrumb.append(separator);
    }
    const isCurrent = index === path.length - 1;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `breadcrumb-link${isCurrent ? ' current' : ''}`;
    if (isCurrent) item.setAttribute('aria-current', 'page');
    item.addEventListener('click', () => { void navigateToPath(path, index, isCurrentNotePath); });
    item.textContent = part.replace(/\.md$/i, '');
    breadcrumb.append(item);
  });
}

async function navigateToPath(path, index, isNotePath) {
  const project = projects.find((entry) => entry.name === path[0]);
  if (!project) return;
  currentProject = project;
  activeNote = null;
  activeNotePath = [];

  if (index === 0) {
    currentFolder = project.handle;
    currentFolderParent = vaultHandle;
    currentFolderPath = [project.name];
    expandedPaths.add(pathKey(currentFolderPath));
    renderProject(project);
  } else if (isNotePath && index === path.length - 1) {
    const notePath = path.slice(0, index + 1);
    const noteParentPath = notePath.slice(0, -1);
    const directory = await resolveDirectoryPath(project.handle, noteParentPath.slice(1));
    currentFolder = directory;
    currentFolderPath = noteParentPath;
    currentFolderParent = noteParentPath.length > 1
      ? await resolveDirectoryPath(project.handle, noteParentPath.slice(1, -1))
      : vaultHandle;
    for (let depth = 1; depth <= noteParentPath.length; depth++) expandedPaths.add(pathKey(noteParentPath.slice(0, depth)));
    const fileHandle = await directory.getFileHandle(notePath.at(-1));
    await openNote(fileHandle, notePath, directory);
  } else {
    const folderPath = path.slice(0, index + 1);
    currentFolder = await resolveDirectoryPath(project.handle, folderPath.slice(1));
    currentFolderParent = folderPath.length > 1
      ? await resolveDirectoryPath(project.handle, folderPath.slice(1, -1))
      : vaultHandle;
    currentFolderPath = folderPath;
    for (let depth = 1; depth <= folderPath.length; depth++) expandedPaths.add(pathKey(folderPath.slice(0, depth)));
    renderFolder(folderPath.at(-1), folderPath);
  }

  await renderTree();
  updateControls();
}

function updateControls() {
  const folderButton = document.querySelector('#newFolderButton');
  folderButton.disabled = !currentProject;
  document.querySelector('#newFolderLabel').textContent = translate(currentFolderPath.length > 1 ? 'newSubfolderButton' : 'newFolderButton');
  document.querySelector('#newNoteButton').disabled = !currentProject;
  const deleteButton = document.querySelector('#deleteItemButton');
  deleteButton.disabled = !currentProject || (!activeNote && currentFolderPath.length === 0);
  deleteButton.textContent = translate(activeNote
    ? 'deleteNoteButton'
    : currentFolderPath.length > 1 ? 'deleteFolderButton' : currentProject ? 'deleteProjectButton' : 'deleteButton');
  document.querySelector('#renameItemButton').disabled = !currentProject || (!activeNote && currentFolderPath.length === 0);
}

function translateItemType(kind) {
  const key = kind === 'note' ? 'itemTypeNote' : kind === 'folder' ? 'itemTypeFolder' : 'itemTypeProject';
  return translate(key);
}

async function renameSelectedItem() {
  const note = activeNote;
  const kind = note ? 'note' : currentFolderPath.length > 1 ? 'folder' : currentProject ? 'project' : null;
  if (!kind) return;

  let parent;
  let oldName;
  let newName;
  if (note) {
    parent = note.directoryHandle;
    oldName = note.filename;
    const inputName = window.prompt(translate('renameNotePrompt'), note.name);
    if (inputName === null) return;
    const sanitized = sanitizeName(inputName);
    if (!sanitized) return showToast(translate('validNameRequired'));
    newName = sanitized.toLowerCase().endsWith('.md') ? sanitized : `${sanitized}.md`;
  } else if (kind === 'project') {
    parent = vaultHandle;
    oldName = currentProject.name;
    newName = sanitizeName(window.prompt(translate('renameProjectPrompt'), oldName) ?? '');
  } else {
    parent = currentFolderParent;
    oldName = currentFolderPath.at(-1);
    newName = sanitizeName(window.prompt(translate('renameFolderPrompt'), oldName) ?? '');
  }

  if (!newName) return;
  if (newName === oldName) return;
  if (kind === 'folder' && HIDDEN_DIRECTORY_NAMES.has(newName.toLocaleLowerCase('en-US'))) {
    showToast(translate('reservedFolderName'));
    return;
  }
  if (await entryExistsExcept(parent, newName, oldName)) {
    showToast(translate('duplicateEntry', { name: newName }));
    return;
  }

  try {
    if (note && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const editor = content.querySelector('.markdown-editor');
      if (!await saveNote(editor?.value ?? '', note)) throw new Error(translate('unsavedChangesError'));
    }
    const oldPath = note ? activeNotePath : [...currentFolderPath];
    const newPath = [...oldPath.slice(0, -1), newName];
    if (note) {
      const handle = await parent.getFileHandle(oldName);
      await renameFileEntry(parent, handle, oldName, newName);
      await renameNoteMetadata(parent, oldName, newName, note.createdAt, note.modifiedAt);
    } else {
      const handle = await parent.getDirectoryHandle(oldName);
      await renameDirectoryEntry(parent, handle, oldName, newName);
      if (kind === 'project') {
        try {
          const order = await readProjectOrder();
          const renamedIndex = order.indexOf(oldName);
          if (renamedIndex >= 0) {
            order[renamedIndex] = newName;
            await saveProjectOrder(order);
          }
        } catch (error) {
          showToast(translate('projectOrderRenameWarning', { details: error.message }));
        }
      }
      updateExpandedPaths(oldPath, newPath);
      for (let depth = 1; depth <= newPath.length; depth++) expandedPaths.add(pathKey(newPath.slice(0, depth)));
    }

    await refreshProjects();
    currentProject = projects.find((project) => project.name === (kind === 'project' ? newName : newPath[0])) ?? null;
    if (!currentProject) throw new Error(translate('renamedProjectMissing'));

    if (note) {
      const noteParentPath = newPath.slice(0, -1);
      currentFolder = await resolveDirectoryPath(currentProject.handle, noteParentPath.slice(1));
      currentFolderParent = noteParentPath.length > 1
        ? await resolveDirectoryPath(currentProject.handle, noteParentPath.slice(1, -1))
        : vaultHandle;
      currentFolderPath = noteParentPath;
      const fileHandle = await currentFolder.getFileHandle(newName);
      await openNote(fileHandle, newPath, currentFolder);
    } else {
      currentFolderPath = newPath;
      currentFolder = newPath.length > 1
        ? await resolveDirectoryPath(currentProject.handle, newPath.slice(1))
        : currentProject.handle;
      currentFolderParent = newPath.length > 1
        ? await resolveDirectoryPath(currentProject.handle, newPath.slice(1, -1))
        : vaultHandle;
      activeNote = null;
      activeNotePath = [];
      if (kind === 'project') rememberLastProject(currentProject);
      if (kind === 'project') renderProject(currentProject);
      else renderFolder(newName, newPath);
    }

    await renderTree();
    updateControls();
    showToast(translate('renamedItem', { itemType: translateItemType(kind) }));
  } catch (error) {
    showToast(translate('renameItemError', { itemType: translateItemType(kind), details: error.message }));
  }
}

async function renameFileEntry(parent, handle, oldName, newName) {
  if (oldName !== newName && oldName.toLocaleLowerCase('de') === newName.toLocaleLowerCase('de')) {
    const temporaryName = await temporaryEntryName(parent);
    const originalFile = await handle.getFile();
    let originalRemoved = false;
    let destinationCreated = false;
    try {
      const temporaryHandle = await parent.getFileHandle(temporaryName, { create: true });
      await writeFile(temporaryHandle, originalFile);
      await parent.removeEntry(oldName);
      originalRemoved = true;
      const destinationHandle = await parent.getFileHandle(newName, { create: true });
      destinationCreated = true;
      await writeFile(destinationHandle, originalFile);
      await parent.removeEntry(temporaryName);
      return;
    } catch (error) {
      if (originalRemoved) {
        try {
          if (destinationCreated) await parent.removeEntry(newName);
          const restoredHandle = await parent.getFileHandle(oldName, { create: true });
          const temporaryHandle = await parent.getFileHandle(temporaryName);
          await writeFile(restoredHandle, await temporaryHandle.getFile());
          await parent.removeEntry(temporaryName);
        } catch {}
      } else {
        try { await parent.removeEntry(temporaryName); } catch {}
      }
      throw error;
    }
  }

  const file = await handle.getFile();
  const newHandle = await parent.getFileHandle(newName, { create: true });
  try {
    await writeFile(newHandle, file);
    await parent.removeEntry(oldName);
  } catch (error) {
    if (newName !== oldName) {
      try { await parent.removeEntry(newName); } catch {}
    }
    throw error;
  }
}

async function moveFileEntry(sourceParent, destinationParent, handle, name) {
  const file = await handle.getFile();
  const destinationHandle = await destinationParent.getFileHandle(name, { create: true });
  try {
    await writeFile(destinationHandle, file);
    await sourceParent.removeEntry(name);
  } catch (error) {
    try { await destinationParent.removeEntry(name); } catch {}
    throw error;
  }
}

async function renameDirectoryEntry(parent, handle, oldName, newName) {
  if (oldName !== newName && oldName.toLocaleLowerCase('de') === newName.toLocaleLowerCase('de')) {
    const temporaryName = await temporaryEntryName(parent);
    let originalRemoved = false;
    let destinationCreated = false;
    try {
      const temporaryDirectory = await parent.getDirectoryHandle(temporaryName, { create: true });
      await copyDirectoryContents(handle, temporaryDirectory);
      await parent.removeEntry(oldName, { recursive: true });
      originalRemoved = true;
      const destination = await parent.getDirectoryHandle(newName, { create: true });
      destinationCreated = true;
      const stagedDirectory = await parent.getDirectoryHandle(temporaryName);
      await copyDirectoryContents(stagedDirectory, destination);
      await parent.removeEntry(temporaryName, { recursive: true });
      return;
    } catch (error) {
      if (originalRemoved) {
        try {
          if (destinationCreated) await parent.removeEntry(newName, { recursive: true });
          const restoredDirectory = await parent.getDirectoryHandle(oldName, { create: true });
          const stagedDirectory = await parent.getDirectoryHandle(temporaryName);
          await copyDirectoryContents(stagedDirectory, restoredDirectory);
          await parent.removeEntry(temporaryName, { recursive: true });
        } catch {}
      } else {
        try { await parent.removeEntry(temporaryName, { recursive: true }); } catch {}
      }
      throw error;
    }
  }

  const destination = await parent.getDirectoryHandle(newName, { create: true });
  try {
    await copyDirectoryContents(handle, destination);
    await parent.removeEntry(oldName, { recursive: true });
  } catch (error) {
    try { await parent.removeEntry(newName, { recursive: true }); } catch {}
    throw error;
  }
}

async function moveDirectoryEntry(sourceParent, destinationParent, handle, name) {
  const destination = await destinationParent.getDirectoryHandle(name, { create: true });
  try {
    await copyDirectoryContents(handle, destination);
    await sourceParent.removeEntry(name, { recursive: true });
  } catch (error) {
    try { await destinationParent.removeEntry(name, { recursive: true }); } catch {}
    throw error;
  }
}

async function copyDirectoryContentsExcludingMetadata(source, destination) {
  for await (const [name, handle] of source.entries()) {
    if (name === FOLDER_METADATA_FILENAME) continue;
    if (handle.kind === 'directory') {
      const child = await destination.getDirectoryHandle(name, { create: true });
      await copyDirectoryContentsExcludingMetadata(handle, child);
    } else {
      const file = await handle.getFile();
      const copy = await destination.getFileHandle(name, { create: true });
      await writeFile(copy, file);
    }
  }
}

async function moveFolderToTrash(sourceParent, trash, sourceHandle, name) {
  const destination = await trash.getDirectoryHandle(name, { create: true });
  try {
    await copyDirectoryContentsExcludingMetadata(sourceHandle, destination);
    await sourceParent.removeEntry(name, { recursive: true });
  } catch (error) {
    try { await trash.removeEntry(name, { recursive: true }); } catch {}
    throw error;
  }
}

async function copyDirectoryContents(source, destination) {
  for await (const [name, handle] of source.entries()) {
    if (handle.kind === 'directory') {
      const child = await destination.getDirectoryHandle(name, { create: true });
      await copyDirectoryContents(handle, child);
    } else {
      const file = await handle.getFile();
      const copy = await destination.getFileHandle(name, { create: true });
      await writeFile(copy, file);
    }
  }
}

async function moveTreeEntry(source, destination) {
  if (!source || !['folder', 'note'].includes(source.kind) || !Array.isArray(source.path) || source.path.length < 2) return;
  if (!destination || !['project', 'folder'].includes(destination.kind) || !Array.isArray(destination.path)) return;
  if (pathKey(source.path) === pathKey(destination.path)) return;
  if (source.kind === 'folder' && isPathPrefix(source.path, destination.path)) {
    showToast(translate('moveFolderIntoItself'));
    return;
  }

  const sourceProject = projects.find((project) => project.name === source.path[0]);
  const destinationProject = projects.find((project) => project.name === destination.path[0]);
  if (!sourceProject || !destinationProject) return;
  const sourceParentPath = source.path.slice(0, -1);
  if (pathKey(sourceParentPath) === pathKey(destination.path)) return;

  let metadataWarning = null;
  try {
    const sourceParent = await resolveDirectoryPath(sourceProject.handle, sourceParentPath.slice(1));
    const destinationDirectory = destination.kind === 'project'
      ? destinationProject.handle
      : await resolveDirectoryPath(destinationProject.handle, destination.path.slice(1));
    const name = source.path.at(-1);
    if (await entryExists(destinationDirectory, name)) {
      showToast(translate('duplicateTargetEntry', { name }));
      return;
    }

    const isNote = source.kind === 'note';
    const sourceHandle = isNote
      ? await sourceParent.getFileHandle(name)
      : await sourceParent.getDirectoryHandle(name);
    const wasActiveNote = activeNote && pathKey(activeNotePath) === pathKey(source.path);
    const activeNoteWasInside = activeNote && source.kind === 'folder' && isPathPrefix(source.path, activeNotePath);
    const selectedFolderWasInside = !activeNote && source.kind === 'folder' && isPathPrefix(source.path, currentFolderPath);

    if ((wasActiveNote || activeNoteWasInside) && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const editor = content.querySelector('.markdown-editor');
      if (!await saveNote(editor?.value ?? '', activeNote)) throw new Error(translate('unsavedChangesError'));
    }

    let noteMetadata = null;
    let noteFile = null;
    if (isNote) {
      noteFile = await sourceHandle.getFile();
      await ensureNoteMetadata(parent, name, noteFile.lastModified);
      noteMetadata = (await readFolderMetadata(sourceParent)).files[name] ?? {};
      const targetHandle = await destinationDirectory.getFileHandle(name, { create: true });
      try {
        await writeFile(targetHandle, noteFile);
        await sourceParent.removeEntry(name);
      } catch (error) {
        try { await destinationDirectory.removeEntry(name); } catch {}
        throw error;
      }
      try {
        await setNoteMetadata(destinationDirectory, name, noteMetadata.createdAt, noteMetadata.modifiedAt);
        await removeNoteMetadata(sourceParent, name);
      } catch (error) {
        metadataWarning = translate('noteMetadataMoveWarning', { details: error.message });
      }
    } else {
      const targetHandle = await destinationDirectory.getDirectoryHandle(name, { create: true });
      try {
        await copyDirectoryContents(sourceHandle, targetHandle);
        await sourceParent.removeEntry(name, { recursive: true });
      } catch (error) {
        try { await destinationDirectory.removeEntry(name, { recursive: true }); } catch {}
        throw error;
      }
    }

    const newEntryPath = [...destination.path, name];
    if (!isNote) updateExpandedPaths(source.path, newEntryPath);
    for (let depth = 1; depth <= destination.path.length; depth++) expandedPaths.add(pathKey(destination.path.slice(0, depth)));
    await refreshProjects();

    if (wasActiveNote || activeNoteWasInside) {
      const nextNotePath = replacePathPrefix(activeNoteWasInside ? activeNotePath : source.path, source.path, newEntryPath);
      currentProject = projects.find((project) => project.name === nextNotePath[0]) ?? destinationProject;
      currentFolderPath = nextNotePath.slice(0, -1);
      currentFolder = await resolveDirectoryPath(currentProject.handle, currentFolderPath.slice(1));
      currentFolderParent = currentFolderPath.length > 1
        ? await resolveDirectoryPath(currentProject.handle, currentFolderPath.slice(1, -1))
        : vaultHandle;
      const noteHandle = await currentFolder.getFileHandle(nextNotePath.at(-1));
      await openNote(noteHandle, nextNotePath, currentFolder);
    } else if (selectedFolderWasInside) {
      const nextFolderPath = replacePathPrefix(currentFolderPath, source.path, newEntryPath);
      currentProject = projects.find((project) => project.name === nextFolderPath[0]) ?? destinationProject;
      currentFolderPath = nextFolderPath;
      currentFolder = await resolveDirectoryPath(currentProject.handle, nextFolderPath.slice(1));
      currentFolderParent = await resolveDirectoryPath(currentProject.handle, nextFolderPath.slice(1, -1));
      activeNote = null;
      activeNotePath = [];
      renderFolder(nextFolderPath.at(-1), nextFolderPath);
    } else {
      if (currentProject) currentProject = projects.find((project) => project.name === currentProject.name) ?? null;
      await renderTree();
    }
    updateControls();
    showToast(metadataWarning ?? translate(isNote ? 'movedNote' : 'movedFolder'));
  } catch (error) {
    showToast(translate('treeMoveError', { details: error.message }));
  }
}

function isPathPrefix(prefix, path) {
  return prefix.length <= path.length && prefix.every((part, index) => part === path[index]);
}

function replacePathPrefix(path, oldPrefix, newPrefix) {
  return [...newPrefix, ...path.slice(oldPrefix.length)];
}

async function resolveDirectoryPath(root, path) {
  let directory = root;
  for (const part of path) directory = await directory.getDirectoryHandle(part);
  return directory;
}

function updateExpandedPaths(oldPath, newPath) {
  const oldPrefix = pathKey(oldPath);
  const newPrefix = pathKey(newPath);
  const matchingPaths = [...expandedPaths].filter((expandedPath) => expandedPath === oldPrefix || expandedPath.startsWith(`${oldPrefix}\u0000`));
  for (const expandedPath of matchingPaths) expandedPaths.delete(expandedPath);
  for (const expandedPath of matchingPaths) {
    expandedPaths.add(expandedPath === oldPrefix ? newPrefix : `${newPrefix}${expandedPath.slice(oldPrefix.length)}`);
  }
}

async function renameNoteMetadata(directoryHandle, oldName, newName, createdAt, modifiedAt) {
  await updateFolderMetadata(directoryHandle, (metadata) => {
    const previous = metadata.files[oldName] && typeof metadata.files[oldName] === 'object'
      ? metadata.files[oldName]
      : { createdAt, modifiedAt };
    delete metadata.files[oldName];
    metadata.files[newName] = previous;
    return metadata;
  });
}

async function deleteSelectedItem() {
  let parent;
  let name;
  let kind;
  let path;
  if (activeNote) {
    parent = activeNote.directoryHandle;
    name = activeNotePath.at(-1);
    kind = 'note';
    path = activeNotePath;
  } else if (currentProject && currentFolderPath.length === 1) {
    parent = vaultHandle;
    name = currentProject.name;
    kind = 'project';
    path = [currentProject.name];
  } else if (currentProject && currentFolderPath.length > 1) {
    parent = currentFolderParent;
    name = currentFolderPath.at(-1);
    kind = 'folder';
    path = currentFolderPath;
  } else return;

  if (!parent || !name) {
    showToast(translate('selectedEntryMissing'));
    return;
  }

  const confirmKey = kind === 'note' ? 'deleteNoteConfirm' : kind === 'folder' ? 'deleteFolderConfirm' : 'deleteProjectConfirm';
  const contentsWarning = kind === 'note' ? '' : `\n\n${translate('deleteContentsWarning')}`;
  const trashNotice = `\n\n${translate('trashNotice')}`;
  let archiveNotice = '';
  const confirmation = `${translate(confirmKey, { name: name.replace(/\.md$/i, '') })}${contentsWarning}${trashNotice}`;
  if (!window.confirm(confirmation)) return;

  try {
    if (activeNote && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const editor = content.querySelector('.markdown-editor');
      if (!await saveNote(editor?.value ?? '', activeNote)) throw new Error(translate('unsavedChangesError'));
    }
    const archiveDirectory = await vaultHandle.getDirectoryHandle(ARCHIVE_DIRECTORY_NAME, { create: true });
    if (await entryExists(archiveDirectory, name)) {
      throw new Error(translate('archiveNameCollision', { name }));
    }
    if (kind === 'note') {
      const sourceHandle = await parent.getFileHandle(name);
      const sourceFile = await sourceHandle.getFile();
      await ensureNoteMetadata(parent, name, sourceFile.lastModified);
      await moveFileEntry(parent, archiveDirectory, sourceHandle, name);
      await removeNoteMetadata(parent, name);
      try {
        await removeUnreferencedImages(parent);
      } catch (error) {
        archiveNotice = translate('noteArchiveImageWarning', { details: error.message });
      }
    } else {
      const sourceHandle = await parent.getDirectoryHandle(name);
      await moveFolderToTrash(parent, archiveDirectory, sourceHandle, name);
    }
    activeNote = null;
    activeNotePath = [];

    if (kind === 'project') {
      forgetLastProject(currentProject);
      try {
        const order = (await readProjectOrder()).filter((projectName) => projectName !== name);
        await saveProjectOrder(order);
      } catch (error) {
        archiveNotice = translate('projectArchiveOrderWarning', { details: error.message });
      }
      for (const expandedPath of expandedPaths) {
        if (expandedPath === pathKey(path) || expandedPath.startsWith(`${pathKey(path)}\u0000`)) expandedPaths.delete(expandedPath);
      }
      currentProject = null;
      currentFolder = null;
      currentFolderParent = null;
      currentFolderPath = [];
      await refreshProjects();
      renderEmptyWorkspace();
    } else if (kind === 'folder') {
      for (const expandedPath of expandedPaths) {
        if (expandedPath === pathKey(path) || expandedPath.startsWith(`${pathKey(path)}\u0000`)) expandedPaths.delete(expandedPath);
      }
      currentFolder = currentProject.handle;
      currentFolderParent = vaultHandle;
      currentFolderPath = [currentProject.name];
      await refreshProjects();
      renderProject(currentProject);
    } else {
      await refreshProjects();
      try {
        await removeNoteMetadata(parent, name);
      } catch (error) {
        showToast(translate('noteMetadataDeleteWarning', { details: error.message }));
      }
      const parentPath = path.slice(0, -1);
      if (parentPath.length > 1) renderFolder(parentPath.at(-1), parentPath);
      else renderProject(currentProject);
    }
    updateControls();
    await updateTrashButton();
    showToast(archiveNotice || translate('archivedItem', { itemType: translateItemType(kind) }));
  } catch (error) {
    showToast(translate('deleteItemError', { itemType: translateItemType(kind), details: error.message }));
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const output = [];
  const splitTableRow = (line) => {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|')) row = row.slice(0, -1);
    const cells = [];
    let cell = '';
    let escaped = false;
    for (const character of row) {
      if (escaped) {
        cell += character === '|' ? '|' : `\\${character}`;
        escaped = false;
      } else if (character === '\\') escaped = true;
      else if (character === '|') {
        cells.push(cell.trim());
        cell = '';
      } else cell += character;
    }
    if (escaped) cell += '\\';
    cells.push(cell.trim());
    return cells;
  };
  const tableAlignment = (cell) => {
    if (!/^:?-{3,}:?$/.test(cell)) return null;
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    if (cell.endsWith(':')) return 'right';
    if (cell.startsWith(':')) return 'left';
    return '';
  };
  const isTableStart = (lineIndex) => {
    if (lineIndex + 1 >= lines.length || !lines[lineIndex].includes('|')) return false;
    const headers = splitTableRow(lines[lineIndex]);
    const separators = splitTableRow(lines[lineIndex + 1]);
    return headers.length > 0 && headers.length === separators.length && separators.every((cell) => tableAlignment(cell) !== null);
  };
  const isBlockStart = (line, lineIndex) => isTableStart(lineIndex) || /^(?:\s*```|#{1,6}\s+|\s*[-*_]{3,}\s*$|\s*[-*+]\s+|\s*\d+[.)]\s+|>\s?)/.test(line);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    if (/^\s*```/.test(line)) {
      const codeLines = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index++;
      output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    if (isTableStart(index)) {
      const headers = splitTableRow(line);
      const alignments = splitTableRow(lines[index + 1]).map(tableAlignment);
      const renderCell = (tag, value, alignment) => {
        const style = alignment ? ` style="text-align:${alignment}"` : '';
        return `<${tag}${style}>${inlineMarkdown(value)}</${tag}>`;
      };
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        const cells = splitTableRow(lines[index]);
        rows.push(`<tr>${headers.map((_header, column) => renderCell('td', cells[column] ?? '', alignments[column])).join('')}</tr>`);
        index++;
      }
      output.push(`<div class="markdown-table-wrap"><table><thead><tr>${headers.map((header, column) => renderCell('th', header, alignments[column])).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      output.push('<hr>');
      index++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quoteLines.push(lines[index++].replace(/^>\s?/, ''));
      output.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    const firstListItem = line.match(/^\s*([-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (firstListItem) {
      const ordered = /^\d/.test(firstListItem[1]);
      const type = ordered ? 'ol' : 'ul';
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*([-*+]\s+|\d+[.)]\s+)(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        const task = item[2].match(/^\[([ xX])\]\s+(.+)$/);
        if (task && !ordered) {
          items.push(`<li class="task-list-item"><label><input type="checkbox" data-task-index="${index}" aria-label="${escapeHtml(task[2])}"${task[1].toLowerCase() === 'x' ? ' checked' : ''}><span>${inlineMarkdown(task[2])}</span></label></li>`);
        } else {
          items.push(`<li>${inlineMarkdown(item[2])}</li>`);
        }
        index++;
      }
      output.push(`<${type}>${items.join('')}</${type}>`);
      continue;
    }

    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index], index)) paragraph.push(lines[index++].trim());
    output.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  }
  return output.join('\n') || '<p></p>';
}

function inlineMarkdown(text) {
  let safe = escapeHtml(text);
  const inlineTokens = [];
  const protect = (html) => {
    const marker = `\u0000TOKEN${inlineTokens.length}\u0000`;
    inlineTokens.push(html);
    return marker;
  };
  safe = safe.replace(/`([^`]+)`/g, (_match, code) => {
    return protect(`<code>${code}</code>`);
  });
  safe = safe.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt, source) => {
    if (/^https?:\/\//i.test(source)) return protect(`<img src="${source}" alt="${alt}">`);
    if (source.startsWith('/') || source.includes('\\') || source.split('/').some((part) => part === '..' || part === '.')) return alt;
    return protect(`<img data-local-path="${source}" alt="${alt}">`);
  });
  safe = safe.replace(/~~(.+?)~~/g, '<del>$1</del>');
  safe = safe.replace(/==(.+?)==/g, '<mark>$1</mark>');
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>');
  safe = safe.replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/_(.+?)_/g, '<em>$1</em>');
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  safe = safe.replace(/\u0000TOKEN(\d+)\u0000/g, (_match, index) => inlineTokens[Number(index)]);
  return safe;
}

async function handleImagePaste(event, editor, note) {
  const items = Array.from(event.clipboardData?.items ?? []);
  const images = items
    .filter((item) => item.kind === 'file' && /^image\/(png|jpeg|gif|webp|bmp|avif)$/i.test(item.type))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (images.length === 0) return;

  event.preventDefault();
  if (!note?.directoryHandle) {
    showToast(translate('noteStorageUnavailable'));
    return;
  }

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  try {
    const markdown = [];
    for (const image of images) {
      const path = await storePastedImage(image, note);
      const alt = sanitizeName((image.name || translate('defaultImageAlt')).replace(/\.[^.]+$/, '')) || translate('defaultImageAlt');
      markdown.push(`![${alt}](${path})`);
    }
    const before = editor.value.slice(0, start);
    const after = editor.value.slice(end);
    const insertion = `${before && !before.endsWith('\n') ? '\n' : ''}${markdown.join('\n')}${after && !after.startsWith('\n') ? '\n' : ''}`;
    editor.setRangeText(insertion, start, end, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    showToast(translate(images.length === 1 ? 'imageSavedOne' : 'imageSavedMany', { count: images.length, directory: IMAGE_DIRECTORY_NAME }));
  } catch (error) {
    showToast(translate('imageSaveError', { details: error.message }));
  }
}

async function storePastedImage(image, note) {
  const extensionByType = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/avif': 'avif'
  };
  const extension = extensionByType[image.type.toLowerCase()] || 'png';
  const imagesDirectory = await note.directoryHandle.getDirectoryHandle(IMAGE_DIRECTORY_NAME, { create: true });
  let timestamp = Math.floor(Date.now() / 1000);
  let filename = `images-${timestamp}.${extension}`;
  while (await entryExists(imagesDirectory, filename)) filename = `images-${++timestamp}.${extension}`;
  const fileHandle = await imagesDirectory.getFileHandle(filename, { create: true });
  await writeFile(fileHandle, image);
  return `${IMAGE_DIRECTORY_NAME}/${filename}`;
}

async function updateMarkdownPreview(preview, markdown, note) {
  revokePreviewObjectUrls();
  preview.replaceChildren();
  preview.innerHTML = renderMarkdown(markdown);
  const images = Array.from(preview.querySelectorAll('img[data-local-path]'));
  for (const image of images) {
    try {
      let directory = note.directoryHandle;
      const parts = image.dataset.localPath.split('/');
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      const handle = await directory.getFileHandle(parts.at(-1));
      const objectUrl = URL.createObjectURL(await handle.getFile());
      previewObjectUrls.push(objectUrl);
      image.src = objectUrl;
      image.removeAttribute('data-local-path');
    } catch {
      image.alt = `${image.alt}${translate('missingImageSuffix')}`;
    }
  }
}

function revokePreviewObjectUrls() {
  for (const objectUrl of previewObjectUrls) URL.revokeObjectURL(objectUrl);
  previewObjectUrls = [];
}
