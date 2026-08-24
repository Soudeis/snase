// ============================================================
// ETAT DE L'APPLICATION
// ============================================================

const state = {
  user: null,          // { id, username, name, role }
  employee: null,      // employé identifié par le QR code
  photoBlob: null,      // photo capturée (Blob)
  coords: null,          // { lat, lng }
};

let qrScanner = null;
let cameraStream = null;

// ============================================================
// UTILITAIRES
// ============================================================

function $(selector) { return document.querySelector(selector); }
function $all(selector) { return Array.from(document.querySelectorAll(selector)); }

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, options);
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      const body = await res.json();
      message = body.message || body.error || message;
    } catch (_) {}
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}
function hideError(el) {
  el.hidden = true;
}

// ============================================================
// CONNEXION
// ============================================================

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = $('#login-error');
  hideError(errorEl);

  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;

  try {
    const user = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    state.user = user;
    sessionStorage.setItem('pointage_user', JSON.stringify(user));
    enterApp();
  } catch (err) {
    showError(errorEl, err.status === 401 ? 'Identifiant ou mot de passe incorrect' : err.message);
  }
});

$('#logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('pointage_user');
  state.user = null;
  stopQrScanner();
  stopCamera();
  $('#screen-app').classList.remove('is-active');
  $('#screen-login').classList.add('is-active');
});

function enterApp() {
  $('#current-user-name').textContent = state.user.name;
  $('#screen-login').classList.remove('is-active');
  $('#screen-app').classList.add('is-active');
  goToStep(1);
}

// Reprise de session (kiosque rechargé sans se déconnecter)
(function restoreSession() {
  const saved = sessionStorage.getItem('pointage_user');
  if (saved) {
    state.user = JSON.parse(saved);
    enterApp();
  }
})();

// ============================================================
// ONGLETS
// ============================================================

$all('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $all('.tab').forEach((t) => t.classList.remove('is-active'));
    $all('.tab-panel').forEach((p) => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    $(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('is-active');

    if (tab.dataset.tab === 'scan') {
      startQrScanner();
    } else {
      stopQrScanner();
      stopCamera();
      loadHistory();
    }
  });
});

// ============================================================
// STEPPER — ETAPE 1 : SCAN QR
// ============================================================

function goToStep(step) {
  $all('.stepper__step').forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('is-active', n === step);
    el.classList.toggle('is-done', n < step);
  });
  $all('.step').forEach((el) => {
    el.classList.toggle('is-active', Number(el.dataset.stepPanel) === step);
  });

  if (step === 1) {
    resetScanStep();
    startQrScanner();
    stopCamera();
  } else if (step === 2) {
    stopQrScanner();
    resetPhotoStep();
    startCamera();
  } else if (step === 3) {
    stopCamera();
    fillConfirmStep();
  }
}

function resetScanStep() {
  state.employee = null;
  $('#employee-preview').hidden = true;
  hideError($('#scan-error'));
}

function startQrScanner() {
  if (qrScanner || $('.tab-panel[data-panel="scan"]').classList.contains('is-active') === false) return;
  if (state.employee) return; // déjà identifié, pas besoin de rescanner

  qrScanner = new Html5Qrcode('qr-reader');
  qrScanner
    .start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      onQrCodeDetected,
      () => {} // erreurs de frame ignorées (normal entre deux scans)
    )
    .catch((err) => {
      showError($('#scan-error'), "Impossible d'accéder à la caméra pour le scan : " + err);
    });
}

function stopQrScanner() {
  if (qrScanner) {
    qrScanner.stop().catch(() => {}).finally(() => {
      qrScanner.clear();
      qrScanner = null;
    });
  }
}

let isProcessingScan = false;

async function onQrCodeDetected(decodedText) {
  if (state.employee || isProcessingScan) return; // évite les doubles déclenchements
  isProcessingScan = true;
  stopQrScanner();

  try {
    const employee = await api(`/api/employees/by-code?code=${encodeURIComponent(decodedText)}`);
    state.employee = employee;

    $('#employee-avatar').textContent = employee.name.trim().charAt(0).toUpperCase();
    $('#employee-name').textContent = employee.name;
    $('#employee-meta').textContent = `${employee.employee_code} · ${employee.position || employee.service || ''}`;
    $('#employee-preview').hidden = false;
    hideError($('#scan-error'));
  } catch (err) {
    showError($('#scan-error'), err.message);
    startQrScanner(); // on relance le scan pour réessayer
  } finally {
    isProcessingScan = false;
  }
}

$('#scan-continue-btn').addEventListener('click', () => goToStep(2));

// ============================================================
// STEPPER — ETAPE 2 : PHOTO
// ============================================================

$('#back-to-scan-btn').addEventListener('click', () => goToStep(1));

function resetPhotoStep() {
  state.photoBlob = null;
  $('#camera-video').hidden = false;
  $('#photo-preview-img').hidden = true;
  $('#capture-photo-btn').hidden = false;
  $('#retake-photo-btn').hidden = true;
  $('#photo-continue-btn').hidden = true;
  hideError($('#photo-error'));
}

async function startCamera() {
  try {
    // Caméra arrière : l'opérateur photographie l'employé en face de lui
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    $('#camera-video').srcObject = cameraStream;
  } catch (err) {
    showError($('#photo-error'), "Impossible d'accéder à la caméra : " + err.message);
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
}

$('#capture-photo-btn').addEventListener('click', () => {
  const video = $('#camera-video');
  const canvas = $('#photo-canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    state.photoBlob = blob;
    $('#photo-preview-img').src = URL.createObjectURL(blob);
    $('#photo-preview-img').hidden = false;
    $('#camera-video').hidden = true;
    $('#capture-photo-btn').hidden = true;
    $('#retake-photo-btn').hidden = false;
    $('#photo-continue-btn').hidden = false;
  }, 'image/jpeg', 0.9);
});

$('#retake-photo-btn').addEventListener('click', () => {
  resetPhotoStep();
});

$('#photo-continue-btn').addEventListener('click', () => goToStep(3));

// ============================================================
// STEPPER — ETAPE 3 : CONFIRMATION
// ============================================================

$('#back-to-photo-btn').addEventListener('click', () => goToStep(2));

function fillConfirmStep() {
  if (!state.employee || !state.photoBlob) {
    // Sécurité : il manque des données (ex: rechargement de page en cours de route),
    // on ne plante pas, on renvoie proprement à l'étape 1.
    showError($('#scan-error'), 'Session de pointage perdue, merci de rescanner le QR code.');
    goToStep(1);
    return;
  }

  hideError($('#confirm-error'));
  $('#confirm-success').hidden = true;
  $('#confirm-submit-btn').disabled = false;

  $('#confirm-photo').src = URL.createObjectURL(state.photoBlob);
  $('#confirm-name').textContent = state.employee.name;
  $('#confirm-code').textContent = state.employee.employee_code;
  $('#confirm-date').textContent = new Date().toLocaleDateString('fr-FR');
  $('#confirm-location').textContent = 'Localisation en cours…';

  state.coords = null;

  if (!navigator.geolocation) {
    $('#confirm-location').textContent = 'Géolocalisation non disponible';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $('#confirm-location').textContent = `${state.coords.lat.toFixed(5)}, ${state.coords.lng.toFixed(5)}`;
    },
    () => {
      $('#confirm-location').textContent = 'Localisation refusée par l\'utilisateur';
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

$('#confirm-submit-btn').addEventListener('click', async () => {
  if (!state.employee || !state.photoBlob) {
    goToStep(1);
    return;
  }

  const errorEl = $('#confirm-error');
  const successEl = $('#confirm-success');
  hideError(errorEl);
  successEl.hidden = true;

  const btn = $('#confirm-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Envoi en cours…';

  const form = new FormData();
  form.append('employee_id', state.employee.id);
  form.append('recorded_by', state.user.id);
  form.append('latitude', state.coords ? state.coords.lat : '');
  form.append('longitude', state.coords ? state.coords.lng : '');
  form.append(
    'location_label',
    state.coords ? `${state.coords.lat.toFixed(5)}, ${state.coords.lng.toFixed(5)}` : ''
  );
  form.append('photo', state.photoBlob, 'pointage.jpg');

  try {
    const res = await fetch(API_BASE + '/api/attendance', { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));

    if (res.status === 201) {
      successEl.textContent = body.message || 'Pointage enregistré avec succès';
      successEl.hidden = false;
      setTimeout(() => goToStep(1), 1800);
    } else if (res.status === 409) {
      showError(errorEl, body.message || 'Cet employé a déjà été pointé aujourd\'hui.');
    } else {
      showError(errorEl, body.message || body.error || `Erreur ${res.status}`);
    }
  } catch (err) {
    showError(errorEl, 'Erreur réseau : ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmer le pointage';
  }
});

// ============================================================
// HISTORIQUE (filtré sur l'utilisateur connecté)
// ============================================================

let historyDebounce = null;

$('#history-search').addEventListener('input', () => {
  clearTimeout(historyDebounce);
  historyDebounce = setTimeout(loadHistory, 300);
});

async function loadHistory() {
  if (!state.user) return;

  const search = $('#history-search').value.trim();
  const params = new URLSearchParams({ recorded_by: state.user.id });
  if (search) params.set('search', search);

  try {
    const records = await api(`/api/attendance-history?${params.toString()}`);
    renderHistory(records);
  } catch (err) {
    $('#history-list').innerHTML = '';
    $('#history-empty').hidden = false;
    $('#history-empty').textContent = 'Erreur de chargement : ' + err.message;
  }
}

function renderHistory(records) {
  const list = $('#history-list');
  const empty = $('#history-empty');

  list.innerHTML = '';

  if (!records.length) {
    empty.hidden = false;
    empty.textContent = 'Aucun pointage pour le moment.';
    return;
  }
  empty.hidden = true;

  records.forEach((rec) => {
    const li = document.createElement('li');
    li.className = 'history-item';

    const photoUrl = rec.id ? `${API_BASE}/api/attendance-photo/${rec.id}` : '';

    li.innerHTML = `
      ${photoUrl ? `<img class="history-item__photo" src="${photoUrl}" alt="" />` : `<div class="history-item__photo"></div>`}
      <div class="history-item__info">
        <p class="history-item__name">${escapeHtml(rec.employee_name)}</p>
        <p class="history-item__meta">${escapeHtml(rec.employee_code)} · ${rec.attendance_date}${rec.location_label ? ' · ' + escapeHtml(rec.location_label) : ''}</p>
      </div>
    `;
    list.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}