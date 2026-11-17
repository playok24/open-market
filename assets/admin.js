/* Open Market — panel de edición. Usa la API de GitHub para guardar JSON y fotos. */
(function () {
  'use strict';

  var REPO = 'playok24/open-market';
  var BRANCH = 'main';
  var API = 'https://api.github.com';
  var PATH_PUBS = 'data/publications.json';
  var PATH_CONFIG = 'data/config.json';
  var DRAFT_PUBS = 'om_draft_pubs';
  var DRAFT_CONFIG = 'om_draft_config';
  var PENDING_KEY = 'om_pending';
  var TOKEN_KEY = 'om_github_token';
  var PIN_KEY = 'om_admin_unlocked';

  var $ = function (s) { return document.querySelector(s); };
  var scriptDir = new URL('.', document.currentScript.src);
  var dataDir = new URL('../data/', scriptDir).href;
  var siteBase = new URL('../', scriptDir).href;

  var defaults = {
    siteName: 'Open Market',
    adminPin: '1978',
    region: 'Valle de Punilla · Córdoba',
    heroTitle: 'Descubrí lo mejor del Valle de Punilla',
    heroText: 'Gastronomía, alojamientos, experiencias y negocios de tu zona. Elegí una publicación y hablá directamente por WhatsApp.',
    contactTitle: '¿Querés publicar tu negocio?',
    contactPhone: '3541123456',
    contactText: 'Escribinos y lo agregamos a Open Market sin costo.',
    footerText: 'Hecho con cariño para quienes viven y visitan el Valle de Punilla.',
    categories: ['Gastronomía', 'Alojamientos', 'Actividades y turismo', 'Comercio y servicios']
  };

  var state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: null,
    pubs: [],
    pending: [],
    config: {},
    openId: null,
    tab: 'pubs'
  };

  /* ---------- utilidades ---------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function fromB64(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function slug(name) {
    return String(name).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'foto';
  }

  function resolveAsset(path) {
    if (!path) return siteBase + 'assets/placeholders/comercio.svg';
    if (/^(data:|https?:|\/\/|\/)/.test(path)) return path;
    return siteBase + path;
  }

  function findPub(id) {
    for (var i = 0; i < state.pubs.length; i++) if (state.pubs[i].id === id) return state.pubs[i];
    return null;
  }

  function status(msg, isError) {
    var bar = $('#statusbar');
    bar.textContent = msg;
    bar.classList.add('show');
    bar.classList.toggle('err', !!isError);
    if (!isError) {
      clearTimeout(status._t);
      status._t = setTimeout(function () { bar.classList.remove('show'); }, 4200);
    }
  }

  function alert(html, type) {
    $('#alert-zone').innerHTML = '<div class="alert alert--' + (type || 'info') + '">' + html + '</div>';
  }

  function setDraftStatus() {
    var hasDraft = localStorage.getItem(DRAFT_PUBS) || localStorage.getItem(DRAFT_CONFIG);
    var pendingText = state.pending.length ? ' · ' + state.pending.length + ' solicitudes pendientes' : '';
    $('#draft-status').textContent = (hasDraft
      ? 'Tenés cambios sin publicar en este navegador.'
      : (state.pubs.length + ' publicaciones · ' + (state.user ? 'Conectado a GitHub' : 'Modo edición local'))) + pendingText;
  }

  function markDirty() {
    localStorage.setItem(DRAFT_PUBS, JSON.stringify(state.pubs));
    localStorage.setItem(DRAFT_CONFIG, JSON.stringify(state.config));
    localStorage.setItem(PENDING_KEY, JSON.stringify(state.pending));
    setDraftStatus();
  }

  function clearDrafts(which) {
    if (which !== 'config') localStorage.removeItem(DRAFT_PUBS);
    if (which !== 'pubs') localStorage.removeItem(DRAFT_CONFIG);
    setDraftStatus();
  }

  /* ---------- PIN de acceso (barrera visual) ---------- */
  function isUnlocked() { return sessionStorage.getItem(PIN_KEY) === '1'; }

  function applyLock() {
    document.body.classList.toggle('locked', !isUnlocked());
    if (!isUnlocked()) {
      var input = $('#pin-input');
      if (input) { input.value = ''; input.focus(); }
      var error = $('#pin-error');
      if (error) error.textContent = '';
    }
  }

  function unlock() {
    sessionStorage.setItem(PIN_KEY, '1');
    applyLock();
  }

  function lock() {
    sessionStorage.removeItem(PIN_KEY);
    applyLock();
    switchTab('pubs');
    status('Panel bloqueado.');
  }

  function checkPin() {
    var expected = String(state.config.adminPin || defaults.adminPin);
    if ($('#pin-input').value.trim() === expected) {
      unlock();
    } else {
      $('#pin-error').textContent = 'PIN incorrecto. Intentá de nuevo.';
      $('#pin-input').value = '';
      $('#pin-input').focus();
    }
  }

  /* ---------- Solicitudes ---------- */
  function normKey(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function matchCategory(value) {
    var cats = state.config.categories || defaults.categories;
    var v = normKey(value).trim();
    for (var i = 0; i < cats.length; i++) if (normKey(cats[i]) === v) return cats[i];
    for (var j = 0; j < cats.length; j++) {
      var c = normKey(cats[j]);
      if (v && (v.indexOf(c) !== -1 || c.indexOf(v) !== -1)) return cats[j];
    }
    return cats[cats.length - 1] || 'Comercio y servicios';
  }

  function parseSubmission(text) {
    var out = {
      id: 'pend-' + Date.now(),
      sourceId: '',
      title: '',
      category: (state.config.categories || defaults.categories)[0],
      location: '',
      phone: '',
      description: '',
      image: '',
      tags: []
    };
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf(':');
      if (i < 0) return;
      var key = normKey(line.slice(0, i)).trim();
      var value = line.slice(i + 1).trim();
      if (/(^|\s)id$/.test(key)) out.sourceId = value;
      else if (key.indexOf('negocio') !== -1) out.title = value;
      else if (key.indexOf('rubro') !== -1) out.category = matchCategory(value);
      else if (key.indexOf('localidad') !== -1) out.location = value;
      else if (key.indexOf('telefono') !== -1 || key.indexOf('whatsapp') !== -1) out.phone = value;
      else if (key.indexOf('descripcion') !== -1) out.description = value;
      else if (key.indexOf('foto') !== -1) out.image = value;
    });
    return out;
  }

  function pendingHtml(p) {
    return '' +
      '<div class="edit-item" data-pending-id="' + esc(p.id) + '">' +
        '<div class="edit-item__head">' +
          '<div class="edit-item__title"><b>' + esc(p.title || 'Sin título') + '</b><small>' +
            (p.sourceId ? '<span class="pending-badge">' + esc(p.sourceId) + '</span> ' : '') +
            esc(p.category || '') + (p.location ? ' · ' + esc(p.location) : '') +
          '</small></div>' +
          '<div class="edit-item__tools">' +
            '<button class="btn btn--primary btn--sm" data-pact="approve">Aprobar</button>' +
            '<button class="icon-btn danger" data-pact="drop" title="Descartar">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="edit-item__body">' +
          '<div class="field-grid">' +
            '<div class="field"><label>Nombre del negocio</label><input data-pending-field="title" value="' + esc(p.title) + '"></div>' +
            '<div class="field"><label>Rubro</label><select data-pending-field="category">' + categoryOptions(p.category) + '</select></div>' +
            '<div class="field"><label>Localidad</label><input data-pending-field="location" value="' + esc(p.location) + '"></div>' +
            '<div class="field"><label>Teléfono / WhatsApp</label><input data-pending-field="phone" value="' + esc(p.phone) + '"></div>' +
            '<div class="field field--full"><label>Descripción</label><textarea data-pending-field="description">' + esc(p.description) + '</textarea></div>' +
            '<div class="field field--full"><label>URL de foto</label><input data-pending-field="image" value="' + esc(p.image) + '"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderPending() {
    var box = $('#pending-list');
    if (!box) return;
    box.innerHTML = state.pending.map(pendingHtml).join('') ||
      '<div class="empty"><h3>No hay solicitudes pendientes</h3><p>El formulario de la web pública genera mensajes para revisar acá.</p></div>';
    var badge = $('#pending-count');
    if (badge) {
      badge.style.display = state.pending.length ? '' : 'none';
      badge.textContent = state.pending.length;
    }
  }

  function findPending(id) {
    for (var i = 0; i < state.pending.length; i++) if (state.pending[i].id === id) return state.pending[i];
    return null;
  }

  function approvePending(id) {
    var idx = state.pending.findIndex(function (p) { return p.id === id; });
    if (idx < 0) return;
    var p = state.pending[idx];
    if (!p.title || !p.phone) {
      alert('La solicitud necesita al menos <b>nombre</b> y <b>teléfono</b> antes de aprobarla.', 'err');
      return;
    }
    state.pubs.push({
      id: 'pub-' + Date.now(),
      title: p.title,
      category: p.category || (state.config.categories || defaults.categories)[0],
      location: p.location || '',
      description: p.description || '',
      phone: p.phone,
      image: p.image || (siteBase + 'assets/placeholders/comercio.svg'),
      featured: false,
      tags: p.tags || []
    });
    state.pending.splice(idx, 1);
    renderPending();
    renderList();
    markDirty();
    alert('<b>Solicitud aprobada.</b> Ya está en Publicaciones. Tocá <b>Guardar en GitHub</b> para que se vea en la web.', 'ok');
    status('Solicitud aprobada. Falta guardar en GitHub.');
  }

  /* ---------- GitHub API ---------- */
  function api(path, options) {
    options = options || {};
    var headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    if (options.body) headers['Content-Type'] = 'application/json';
    return fetch(API + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body || null
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { message: text }; }
        if (!res.ok) throw new Error(data.message || ('Error ' + res.status));
        return data;
      });
    });
  }

  function getRepoFile(path) {
    return api('/repos/' + REPO + '/contents/' + path + '?ref=' + encodeURIComponent(BRANCH))
      .then(function (data) { return { content: fromB64(data.content || ''), sha: data.sha }; })
      .catch(function (err) {
        if (/Not Found/i.test(err.message)) return { content: null, sha: null };
        throw err;
      });
  }

  function putRepoFile(path, content, message) {
    var body = { message: message, content: toB64(content), branch: BRANCH };
    return getRepoFile(path).then(function (current) {
      if (current.sha) body.sha = current.sha;
      return api('/repos/' + REPO + '/contents/' + path, { method: 'PUT', body: JSON.stringify(body) });
    });
  }

  function saveToGithub(which) {
    if (!state.token) {
      alert('Para publicar los cambios necesitás conectar un token de GitHub con permiso <b>repo</b>. Mientras tanto podés usar <b>Descargar JSON</b>.', 'err');
      return;
    }
    var button = which === 'config' ? $('#save-config') : $('#save-github');
    if (button) { button.disabled = true; button.innerHTML = '<span class="spinner"></span> Guardando…'; }
    status('Guardando en GitHub…');

    var task;
    if (which === 'config') {
      task = putRepoFile(PATH_CONFIG, JSON.stringify(state.config, null, 2) + '\n', 'Open Market: actualizar configuración');
    } else {
      task = putRepoFile(PATH_PUBS, JSON.stringify({ publications: state.pubs }, null, 2) + '\n', 'Open Market: actualizar publicaciones');
    }

    task.then(function () {
      clearDrafts(which);
      alert('<b>¡Guardado!</b> Los cambios ya están en GitHub. En unos segundos se ven en la web pública. <a href="https://github.com/' + REPO + '/commits/' + BRANCH + '" target="_blank" rel="noopener">Ver commits →</a>', 'ok');
      status('Cambios publicados correctamente.');
    }).catch(function (err) {
      alert('<b>No se pudo guardar:</b> ' + esc(err.message) + '. Si el token es nuevo, esperá un minuto y volvé a intentar.', 'err');
      status('Error al guardar: ' + err.message, true);
    }).then(function () {
      if (button) {
        button.disabled = false;
        button.innerHTML = which === 'config' ? 'Guardar configuración en GitHub' : 'Guardar en GitHub';
      }
    });
  }

  /* ---------- fotos ---------- */
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('No se pudo leer la imagen')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Formato de imagen no válido')); };
        img.onload = function () {
          var max = 1400;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function handleFile(input, pub, item) {
    var file = input.files && input.files[0];
    if (!file) return;
    status('Procesando foto…');
    resizeImage(file).then(function (dataUrl) {
      if (!state.token) {
        pub.image = dataUrl;
        status('Foto incrustada en el borrador. Conectá el token para subirla como archivo.', true);
      } else {
        var path = 'assets/uploads/' + Date.now() + '-' + slug(file.name) + '.jpg';
        return api('/repos/' + REPO + '/contents/' + path, {
          method: 'PUT',
          body: JSON.stringify({ message: 'Open Market: subir foto', content: dataUrl.split(',')[1], branch: BRANCH })
        }).then(function () {
          pub.image = path;
          status('Foto subida a GitHub.');
        });
      }
    }).then(function () {
      var urlField = item.querySelector('[data-field="imageUrl"]');
      if (urlField) urlField.value = /^data:/.test(pub.image) ? '(imagen cargada)' : pub.image;
      var thumb = item.querySelector('.edit-item__thumb');
      if (thumb) thumb.src = resolveAsset(pub.image);
      markDirty();
    }).catch(function (err) {
      status('Error con la foto: ' + err.message, true);
    });
  }

  /* ---------- render ---------- */
  function itemHtml(pub, index) {
    var open = state.openId === pub.id;
    var tags = (pub.tags || []).join(', ');
    var thumbs = resolveAsset(pub.image);
    return '' +
      '<div class="edit-item' + (open ? ' is-open' : '') + '" data-id="' + esc(pub.id) + '">' +
        '<div class="edit-item__head">' +
          '<img class="edit-item__thumb" src="' + esc(thumbs) + '" alt="">' +
          '<div class="edit-item__title"><b>' + esc(pub.title || 'Sin título') + '</b><small>' + esc(pub.category || 'Sin rubro') + (pub.location ? ' · ' + esc(pub.location) : '') + (pub.featured ? ' · ★ Destacado' : '') + '</small></div>' +
          '<div class="edit-item__tools">' +
            '<button class="icon-btn" data-act="up" title="Subir" ' + (index === 0 ? 'disabled' : '') + '>↑</button>' +
            '<button class="icon-btn" data-act="down" title="Bajar" ' + (index === state.pubs.length - 1 ? 'disabled' : '') + '>↓</button>' +
            '<button class="icon-btn" data-act="copy" title="Duplicar">⧉</button>' +
            '<button class="icon-btn danger" data-act="del" title="Eliminar">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="edit-item__body">' +
          '<div class="field-grid">' +
            '<div class="field"><label>Título</label><input data-field="title" value="' + esc(pub.title) + '" placeholder="Nombre del negocio"></div>' +
            '<div class="field"><label>Rubro</label><select data-field="category">' + categoryOptions(pub.category) + '</select></div>' +
            '<div class="field"><label>Localidad</label><input data-field="location" value="' + esc(pub.location) + '" placeholder="Ej: Cosquín"></div>' +
            '<div class="field"><label>Teléfono / WhatsApp</label><input data-field="phone" value="' + esc(pub.phone) + '" placeholder="3541123456"><small>Este número se muestra debajo de la foto y es al que se abre WhatsApp.</small></div>' +
            '<div class="field field--full"><label>Descripción</label><textarea data-field="description">' + esc(pub.description) + '</textarea></div>' +
            '<div class="field field--full"><label>Etiquetas (separadas por coma)</label><input data-field="tags" value="' + esc(tags) + '" placeholder="Pileta, WiFi, Abierto sábados"></div>' +
            '<div class="field field--full"><label>Foto</label>' +
              '<img class="photo-preview" src="' + esc(thumbs) + '" alt="Vista previa">' +
              '<div class="dropzone"><label for="file-' + esc(pub.id) + '">Elegir foto desde mi computadora</label><input type="file" id="file-' + esc(pub.id) + '" accept="image/jpeg,image/png,image/webp" data-file="1"></div>' +
              '<small style="display:block;margin-top:8px">O pegá una URL de imagen:</small>' +
              '<input data-field="imageUrl" value="' + esc(/^data:/.test(pub.image) ? '' : pub.image) + '" placeholder="assets/uploads/mi-foto.jpg o https://…">' +
            '</div>' +
            '<div class="field field--full"><label class="checkline"><input type="checkbox" data-check="featured" ' + (pub.featured ? 'checked' : '') + '> Destacar esta publicación (aparece primero)</label></div>' +
          '</div>' +
          '<div class="edit-item__foot"><button class="btn btn--ghost btn--sm" data-act="close">Cerrar</button></div>' +
        '</div>' +
      '</div>';
  }

  function categoryOptions(current) {
    var cats = state.config.categories || defaults.categories;
    var all = cats.slice();
    if (current && all.indexOf(current) === -1) all.push(current);
    return all.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === current ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
  }

  function renderList() {
    $('#edit-list').innerHTML = state.pubs.map(itemHtml).join('') || '<div class="empty"><h3>No hay publicaciones</h3><p>Presioná "+ Nueva publicación" para agregar la primera.</p></div>';
  }

  function renderConfig() {
    Object.keys(state.config).forEach(function (key) {
      if (key === 'categories') return;
      var el = document.querySelector('[data-config="' + key + '"]');
      if (el) el.value = state.config[key] == null ? '' : state.config[key];
    });
    var catEl = $('[data-config="categoriesCsv"]');
    if (catEl) catEl.value = (state.config.categories || defaults.categories).join(', ');
  }

  function switchTab(tab) {
    state.tab = tab;
    ['pubs', 'pending', 'config', 'help'].forEach(function (t) {
      $('#tab-' + t).style.display = t === tab ? '' : 'none';
    });
    Array.prototype.forEach.call(document.querySelectorAll('#side-nav button'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === tab);
    });
  }

  /* ---------- carga ---------- */
  function loadLocal(file, fallback) {
    var url = dataDir + file + '?v=' + Date.now();
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('No se pudo cargar ' + file);
      return res.json();
    }).catch(function () { return fallback; });
  }

  function load() {
    Promise.all([loadLocal('config.json', defaults), loadLocal('publications.json', { publications: [] })])
      .then(function (res) {
        state.config = Object.assign({}, defaults, res[0] || {});
        state.pubs = (res[1] && res[1].publications) || [];

        var draftPubs = localStorage.getItem(DRAFT_PUBS);
        var draftConfig = localStorage.getItem(DRAFT_CONFIG);
        var savedPending = localStorage.getItem(PENDING_KEY);
        if (draftPubs) { try { state.pubs = JSON.parse(draftPubs); } catch (e) {} }
        if (draftConfig) { try { state.config = Object.assign({}, defaults, JSON.parse(draftConfig)); } catch (e) {} }
        if (savedPending) { try { state.pending = JSON.parse(savedPending); } catch (e) {} }

        renderList();
        renderPending();
        renderConfig();
        applyLock();
        setDraftStatus();
        if (draftPubs || draftConfig) {
          alert('Recuperamos un <b>borrador local</b> de este navegador. Revisalo y guardalo en GitHub cuando quieras.');
        }
      });
  }

  function refreshUser() {
    if (!state.token) {
      $('#token-state').innerHTML = '<span class="token-dot"></span> Sin conectar';
      $('#token-logout').style.display = 'none';
      $('#token-connect').style.display = '';
      return;
    }
    api('/user').then(function (user) {
      state.user = user;
      $('#token-state').innerHTML = '<span class="token-dot ok"></span> ' + esc(user.login);
      $('#token-logout').style.display = '';
      $('#token-connect').style.display = 'none';
      $('#token-input').value = '';
      setDraftStatus();
    }).catch(function () {
      state.user = null;
      $('#token-state').innerHTML = '<span class="token-dot"></span> Token inválido';
      $('#token-logout').style.display = '';
    });
  }

  function download(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------- eventos ---------- */
  function init() {
    $('#help-url').textContent = siteBase.replace(/\/$/, '').replace(/^https?:\/\//, '');
    $('#help-admin-url').textContent = siteBase.replace(/\/$/, '') + 'admin/';
    load();
    refreshUser();

    applyLock();
    $('#pin-enter').addEventListener('click', checkPin);
    $('#pin-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') checkPin(); });
    $('#lock-admin').addEventListener('click', lock);

    Array.prototype.forEach.call(document.querySelectorAll('#side-nav button'), function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });

    $('#parse-submission').addEventListener('click', function () {
      var text = $('#submission-text').value;
      if (!text.trim()) { alert('Pegá primero el mensaje recibido por WhatsApp.', 'err'); return; }
      var item = parseSubmission(text);
      if (!item.title && !item.phone) { alert('No se pudo leer el mensaje. Revisá que diga "Negocio:" y "Teléfono:".', 'err'); return; }
      state.pending.push(item);
      $('#submission-text').value = '';
      renderPending();
      markDirty();
      switchTab('pending');
      alert('<b>Solicitud cargada.</b> Revisá los datos y tocá <b>Aprobar</b> cuando esté todo bien.', 'ok');
    });

    var pendingBox = $('#pending-list');
    pendingBox.addEventListener('input', function (e) {
      var el = e.target;
      var key = el.getAttribute('data-pending-field');
      if (!key) return;
      var p = findPending(el.closest('[data-pending-id]').getAttribute('data-pending-id'));
      if (!p) return;
      p[key] = el.value;
      if (key === 'title') {
        var label = el.closest('.edit-item').querySelector('.edit-item__title b');
        if (label) label.textContent = p.title || 'Sin título';
      }
      markDirty();
    });
    pendingBox.addEventListener('change', function (e) {
      if (e.target.matches('[data-pending-field="category"]')) {
        var p = findPending(e.target.closest('[data-pending-id]').getAttribute('data-pending-id'));
        if (p) { p.category = e.target.value; markDirty(); }
      }
    });
    pendingBox.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-pact]');
      if (!btn) return;
      var item = e.target.closest('[data-pending-id]');
      if (!item) return;
      var id = item.getAttribute('data-pending-id');
      if (btn.getAttribute('data-pact') === 'approve') { approvePending(id); return; }
      if (confirm('¿Descartar esta solicitud?')) {
        state.pending = state.pending.filter(function (p) { return p.id !== id; });
        renderPending();
        markDirty();
      }
    });

    $('#token-connect').addEventListener('click', function () {
      var token = $('#token-input').value.trim();
      if (!token) { status('Pegá un token de GitHub primero.', true); return; }
      state.token = token;
      localStorage.setItem(TOKEN_KEY, token);
      status('Verificando token…');
      refreshUser();
    });

    $('#token-logout').addEventListener('click', function () {
      state.token = '';
      state.user = null;
      localStorage.removeItem(TOKEN_KEY);
      refreshUser();
      status('Token desconectado de este navegador.');
    });

    $('#add-pub').addEventListener('click', function () {
      var pub = {
        id: 'pub-' + Date.now(),
        title: 'Nueva publicación',
        category: (state.config.categories || defaults.categories)[0],
        location: '',
        description: '',
        phone: '',
        image: siteBase + 'assets/placeholders/comercio.svg',
        featured: false,
        tags: []
      };
      state.pubs.push(pub);
      state.openId = pub.id;
      renderList();
      markDirty();
      var node = document.querySelector('.edit-item[data-id="' + pub.id + '"]');
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    var list = $('#edit-list');
    list.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      var item = e.target.closest('.edit-item');
      if (!item) return;
      var id = item.getAttribute('data-id');
      var idx = state.pubs.findIndex(function (p) { return p.id === id; });
      if (idx < 0) return;

      if (!btn) {
        var head = e.target.closest('.edit-item__head');
        if (head) {
          state.openId = item.classList.contains('is-open') ? null : id;
          renderList();
        }
        return;
      }
      e.stopPropagation();
      var act = btn.getAttribute('data-act');
      if (act === 'close') { state.openId = null; renderList(); return; }
      if (act === 'del') {
        if (!confirm('¿Eliminar "' + state.pubs[idx].title + '"?')) return;
        state.pubs.splice(idx, 1);
        if (state.openId === id) state.openId = null;
        renderList(); markDirty(); return;
      }
      if (act === 'copy') {
        var copy = Object.assign({}, state.pubs[idx]);
        copy.id = 'pub-' + Date.now();
        copy.title = (copy.title || 'Publicación') + ' (copia)';
        state.pubs.splice(idx + 1, 0, copy);
        state.openId = copy.id;
        renderList(); markDirty(); return;
      }
      if (act === 'up' && idx > 0) {
        var a = state.pubs[idx - 1]; state.pubs[idx - 1] = state.pubs[idx]; state.pubs[idx] = a;
        renderList(); markDirty(); return;
      }
      if (act === 'down' && idx < state.pubs.length - 1) {
        var b = state.pubs[idx + 1]; state.pubs[idx + 1] = state.pubs[idx]; state.pubs[idx] = b;
        renderList(); markDirty();
      }
    });

    function updateFromField(el) {
      var item = el.closest('.edit-item');
      if (!item) return;
      var pub = findPub(item.getAttribute('data-id'));
      if (!pub) return;
      if (el.hasAttribute('data-file')) { handleFile(el, pub, item); return; }
      if (el.hasAttribute('data-check')) { pub[el.getAttribute('data-check')] = el.checked; }
      else {
        var key = el.getAttribute('data-field');
        if (key === 'imageUrl') {
          pub.image = el.value.trim();
          var thumb = item.querySelector('.edit-item__thumb');
          var preview = item.querySelector('.photo-preview');
          if (thumb) thumb.src = resolveAsset(pub.image);
          if (preview) preview.src = resolveAsset(pub.image);
        } else if (key === 'tags') {
          pub.tags = el.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
        } else {
          pub[key] = el.value;
        }
        if (key === 'title') {
          var label = item.querySelector('.edit-item__title b');
          if (label) label.textContent = pub.title || 'Sin título';
        }
      }
      markDirty();
    }

    list.addEventListener('input', function (e) {
      if (e.target.matches('[data-field]')) updateFromField(e.target);
    });
    list.addEventListener('change', function (e) {
      if (e.target.matches('[data-field], [data-check], [data-file]')) updateFromField(e.target);
    });

    $('#config-fields').addEventListener('input', function (e) {
      var el = e.target;
      var key = el.getAttribute('data-config');
      if (!key) return;
      if (key === 'categoriesCsv') {
        state.config.categories = el.value.split(',').map(function (c) { return c.trim(); }).filter(Boolean);
      } else {
        state.config[key] = el.value;
      }
      markDirty();
    });

    $('#save-github').addEventListener('click', function () { saveToGithub('pubs'); });
    $('#save-config').addEventListener('click', function () { saveToGithub('config'); });
    $('#download-json').addEventListener('click', function () { download('publications.json', { publications: state.pubs }); });
    $('#download-config').addEventListener('click', function () { download('config.json', state.config); });
    $('#alert-zone').addEventListener('click', function (e) { if (e.target.tagName === 'A' && !e.target.target) e.preventDefault(); });
  }

  init();
})();
