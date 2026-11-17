/* Open Market — sitio público. Lee data/config.json y data/publications.json */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var scriptDir = new URL('.', document.currentScript.src);
  var dataDir = new URL('../data/', scriptDir);
  var placeholderDir = new URL('./placeholders/', scriptDir).href;

  var state = { config: {}, pubs: [], category: 'Todos', query: '' };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function norm(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function digits(phone) { return String(phone || '').replace(/\D/g, ''); }

  function waNumber(phone) {
    var d = digits(phone);
    if (d.length > 10 && d.indexOf('54') === 0) return d;
    if (d.length >= 10) return '54' + d;
    return d;
  }

  function formatPhone(phone) {
    var raw = String(phone || '').trim();
    var d = digits(phone);
    var local = (d.length > 10 && d.indexOf('54') === 0) ? d.slice(2) : d;
    if (local.length === 10) return '(' + local.slice(0, 4) + ') ' + local.slice(4, 7) + '-' + local.slice(7);
    if (local.length === 7) return local.slice(0, 3) + '-' + local.slice(3);
    return raw || 'Consultar';
  }

  function waLink(pub) {
    var number = waNumber(pub.phone || state.config.contactPhone);
    var message = 'Hola! Vi "' + pub.title + '" en Open Market Valle de Punilla y quiero consultar.';
    var base = number ? 'https://wa.me/' + number : 'https://wa.me/';
    return base + '?text=' + encodeURIComponent(message);
  }

  function contactWa(message) {
    var number = waNumber(state.config.contactPhone);
    return 'https://wa.me/' + number + '?text=' + encodeURIComponent(message);
  }

  function fetchJson(file) {
    return fetch(file + '?v=' + Date.now()).then(function (res) {
      if (!res.ok) throw new Error('No se pudo cargar ' + file + ' (' + res.status + ')');
      return res.json();
    });
  }

  function fallbackImage(category) {
    var map = {
      'Gastronomía': 'gastronomia.svg',
      'Alojamientos': 'alojamientos.svg',
      'Actividades y turismo': 'actividades.svg',
      'Comercio y servicios': 'comercio.svg'
    };
    return placeholderDir + (map[category] || 'comercio.svg');
  }

  function paintConfig() {
    var c = state.config;
    if (c.siteName) document.title = c.siteName + ' · ' + (c.region || 'Valle de Punilla');
    if (c.heroRegion || c.region) $('#hero-region').textContent = c.heroRegion || c.region;
    if (c.heroTitle) $('#hero-title').innerHTML = c.heroTitle.replace(/Valle de Punilla/g, '<em>Valle de Punilla</em>');
    if (c.heroText) $('#hero-text').textContent = c.heroText;
    if (c.tagline) $('#hero-text').textContent = c.heroText || c.tagline;
    if (c.contactTitle || c.contactLabel) $('#contact-title').textContent = c.contactTitle || c.contactLabel;
    if (c.contactText) $('#contact-text').textContent = c.contactText;
    if (c.footerText) $('#footer-text').textContent = c.footerText;
    if (c.region) {
      $('#footer-region').textContent = c.region;
      $('#hero-region').textContent = c.region;
    }
    var contact = contactWa('Hola! Quiero publicar mi negocio en Open Market.');
    $('#contact-link').href = contact;
    $('#fab-wa').href = contact;
  }

  function paintStats() {
    var locals = {};
    state.pubs.forEach(function (p) { if (p.location) locals[p.location.trim()] = true; });
    var nLocals = Object.keys(locals).length;
    $('#stat-count').textContent = state.pubs.length;
    $('#stat-hero-count').textContent = state.pubs.length;
    $('#stat-localities').textContent = nLocals;
    $('#stat-hero-localities').textContent = nLocals;
  }

  function categories() {
    var configured = state.config.categories || [];
    var fromPubs = state.pubs.map(function (p) { return p.category; }).filter(Boolean);
    var all = [];
    configured.concat(fromPubs).forEach(function (c) { if (all.indexOf(c) === -1) all.push(c); });
    return all;
  }

  function paintChips() {
    var all = categories();
    var counts = {};
    state.pubs.forEach(function (p) { counts[p.category] = (counts[p.category] || 0) + 1; });
    var html = '<button class="chip' + (state.category === 'Todos' ? ' is-active' : '') + '" data-cat="Todos">Todos <b>' + state.pubs.length + '</b></button>';
    all.forEach(function (cat) {
      if (!counts[cat]) return;
      html += '<button class="chip' + (state.category === cat ? ' is-active' : '') + '" data-cat="' + esc(cat) + '">' + esc(cat) + ' <b>' + counts[cat] + '</b></button>';
    });
    $('#chips').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (btn) {
      btn.addEventListener('click', function () {
        state.category = btn.getAttribute('data-cat');
        paintChips();
        paintGrid();
        document.getElementById('publicaciones').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function cardHtml(pub) {
    var href = waLink(pub);
    var tags = (pub.tags || []).filter(Boolean).slice(0, 3).map(function (t) {
      return '<span class="tag">' + esc(t) + '</span>';
    }).join('');
    return '' +
      '<article class="card">' +
        '<a class="card__photo" href="' + href + '" target="_blank" rel="noopener" aria-label="Consultar ' + esc(pub.title) + ' por WhatsApp">' +
          '<img src="' + esc(pub.image || fallbackImage(pub.category)) + '" alt="' + esc(pub.title) + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + fallbackImage(pub.category) + '\'">' +
          '<div class="card__badges">' +
            '<span class="badge badge--cat">' + esc(pub.category || 'General') + '</span>' +
            (pub.featured ? '<span class="badge badge--star"><svg width="11" height="11" style="vertical-align:-1px" aria-hidden="true"><use href="#i-star"/></svg> Destacado</span>' : '') +
          '</div>' +
          '<span class="card__hint"><svg aria-hidden="true"><use href="#i-wa"/></svg> Tocá la foto y escribinos</span>' +
        '</a>' +
        '<div class="card__body">' +
          (pub.location ? '<div class="card__loc"><svg width="11" height="11" style="vertical-align:-1px" aria-hidden="true"><use href="#i-pin"/></svg> ' + esc(pub.location) + '</div>' : '') +
          '<h3>' + esc(pub.title) + '</h3>' +
          '<p>' + esc(pub.description) + '</p>' +
          (tags ? '<div class="tags">' + tags + '</div>' : '') +
          '<div class="card__contact">' +
            '<div class="phone">' +
              '<span class="phone__icon"><svg width="17" height="17" aria-hidden="true"><use href="#i-phone"/></svg></span>' +
              '<span><small>Teléfono / WhatsApp</small><b>' + esc(formatPhone(pub.phone)) + '</b></span>' +
            '</div>' +
            '<a class="card__wa" href="' + href + '" target="_blank" rel="noopener"><svg aria-hidden="true"><use href="#i-wa"/></svg> Abrir</a>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function paintGrid() {
    var q = norm(state.query).trim();
    var list = state.pubs.filter(function (p) {
      var inCat = state.category === 'Todos' || p.category === state.category;
      var haystack = norm([p.title, p.description, p.location, p.category, (p.tags || []).join(' ')].join(' '));
      return inCat && (!q || haystack.indexOf(q) !== -1);
    });
    list.sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0); });
    if (!list.length) {
      $('#grid').innerHTML = '<div class="empty"><svg width="38" height="38" style="color:#b7c4ba" aria-hidden="true"><use href="#i-search"/></svg><h3>No encontramos publicaciones</h3><p>Probá con otra búsqueda o elegí otro rubro.</p></div>';
      return;
    }
    $('#grid').innerHTML = list.map(cardHtml).join('');
  }

  function init() {
    Promise.all([fetchJson(new URL('config.json', dataDir).href), fetchJson(new URL('publications.json', dataDir).href)])
      .then(function (results) {
        state.config = results[0] || {};
        state.pubs = (results[1] && results[1].publications) || [];
        paintConfig();
        paintStats();
        paintChips();
        paintGrid();
      })
      .catch(function (err) {
        console.error(err);
        $('#grid').innerHTML = '<div class="empty"><h3>No se pudieron cargar las publicaciones</h3><p>' + esc(err.message) + '</p><p>Si estás abriendo el archivo directamente, usá la URL publicada en GitHub Pages.</p></div>';
      });

    $('#search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      state.query = $('#search-input').value;
      paintGrid();
    });
    $('#search-input').addEventListener('input', function (e) {
      state.query = e.target.value;
      paintGrid();
    });
  }

  init();
})();
