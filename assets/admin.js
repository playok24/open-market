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
  var TOKEN_KEY = 'om_github_token';

  var $ = function (s) { return document.querySelector(s); };
  var scriptDir = new URL('.', document.currentScript.src);
  var dataDir = new URL('../data/', scriptDir).href;
  var siteBase = new URL('../', scriptDir).href;

  var defaults = {
    siteName: 'Open Market',
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
    $('#draft-status').textContent = hasDraft
      ? 'Tenés cambios sin publicar en este navegador.'
      : (state.pubs.length + ' publicaciones · ' + (state.user ? 'Conectado a GitHub' : 'Modo edición local'));
  }

  function markDirty() {
    localStorage.setItem(DRAFT_PUBS, JSON.stringify(state.pubs));
    localStorage.setItem(DRAFT_CONFIG, JSON.stringify(state.config));
    setDraftStatus();
  }

  function clearDrafts(which) {
    if (which !== 'config') localStorage.removeItem(DRAFT_PUBS);
    if (which !== 'pubs') localStorage.removeItem(DRAFT_CONFIG);
    setDraftStatus();
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
    ['pubs', 'config', 'help'].forEach(function (t) {
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
        if (draftPubs) { try { state.pubs = JSON.parse(draftPubs); } catch (e) {} }
        if (draftConfig) { try { state.config = Object.assign({}, defaults, JSON.parse(draftConfig)); } catch (e) {} }

        renderList();
        renderConfig();
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

    Array.prototype.forEach.call(document.querySelectorAll('#side-nav button'), function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
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
