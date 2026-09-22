/*
 * Canvas Module Progress Bar (v2)
 * Host this file on any HTTPS server and load it from your Canvas theme JavaScript.
 * It shows "Module X Progress: Step N of M (P%)" above pages, assignments,
 * discussions, and quizzes that belong to a module.
 *
 * Troubleshooting: set window.CMPB_DEBUG = true before loading this script
 * (or add ?cmpb_debug=1 to the page address) to show a status box on the page.
 */
(function () {
  'use strict';

  // ---- Settings ----------------------------------------------------------
  var CONFIG = {
    fill: '#2d6a4f',        // bar color
    track: '#e0e0e0',       // background of the bar
    cacheMinutes: 5,        // how long to reuse module data between page loads
    containerSelector: '#content' // where the bar is inserted (at the top)
  };
  // ------------------------------------------------------------------------

  var DEBUG = window.CMPB_DEBUG === true || /[?&]cmpb_debug=1/.test(window.location.search);
  var debugLines = [];

  function log(msg) {
    if (!DEBUG) return;
    debugLines.push(msg);
    var box = document.getElementById('cmpb-debug');
    var container = document.querySelector(CONFIG.containerSelector) || document.body;
    if (!box) {
      box = document.createElement('pre');
      box.id = 'cmpb-debug';
      box.style.cssText = 'background:#fff3cd;border:2px solid #d4a017;padding:12px;white-space:pre-wrap;font-size:13px;';
      container.insertBefore(box, container.firstChild);
    }
    box.textContent = 'Progress bar debug:\n' + debugLines.join('\n');
  }

  log('1. Script started (v2)');

  var path = window.location.pathname;
  var courseMatch = path.match(/^\/courses\/(\d+)/);
  if (!courseMatch) { log('Stopped: not inside a course'); return; }
  var courseId = courseMatch[1];

  // Work out which item the student is looking at.
  function currentTarget() {
    var params = new URLSearchParams(window.location.search);
    var moduleItemId = params.get('module_item_id');
    if (moduleItemId) return { moduleItemId: moduleItemId };

    var m;
    if ((m = path.match(/\/modules\/items\/(\d+)/))) return { moduleItemId: m[1] };
    if ((m = path.match(/\/pages\/([^\/?#]+)/))) return { type: 'Page', pageUrl: decodeURIComponent(m[1]) };
    if ((m = path.match(/\/assignments\/(\d+)/))) return { type: 'Assignment', contentId: m[1] };
    if ((m = path.match(/\/discussion_topics\/(\d+)/))) return { type: 'Discussion', contentId: m[1] };
    if ((m = path.match(/\/quizzes\/(\d+)/))) return { type: 'Quiz', contentId: m[1] };
    return null;
  }

  // Canvas sometimes prefixes JSON with "while(1);" as a security measure.
  function parseCanvasJson(text) {
    return JSON.parse(text.replace(/^while\(1\);/, ''));
  }

  // Fetch every page of a paginated Canvas API endpoint.
  function fetchAll(url) {
    var results = [];
    function next(u) {
      return fetch(u, { credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('Canvas API returned status ' + res.status);
          var link = res.headers.get('Link') || '';
          var nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
          return res.text().then(function (text) {
            results = results.concat(parseCanvasJson(text));
            return nextMatch ? next(nextMatch[1]) : results;
          });
        });
    }
    return next(url);
  }

  function loadModules() {
    var cacheKey = 'cmpb-modules-' + courseId;
    try {
      var cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (cached && Date.now() - cached.time < CONFIG.cacheMinutes * 60000) {
        log('3. Using cached module data');
        return Promise.resolve(cached.modules);
      }
    } catch (e) { /* ignore storage errors */ }

    log('3. Fetching modules from Canvas...');
    return fetchAll('/api/v1/courses/' + courseId + '/modules?include[]=items&per_page=100')
      .then(function (modules) {
        // Canvas leaves out "items" on large modules; fetch those separately.
        return Promise.all(modules.map(function (mod) {
          if (mod.items) return mod;
          return fetchAll('/api/v1/courses/' + courseId + '/modules/' + mod.id + '/items?per_page=100')
            .then(function (items) { mod.items = items; return mod; });
        }));
      })
      .then(function (modules) {
        log('4. Loaded ' + modules.length + ' modules');
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), modules: modules }));
        } catch (e) { log('   (could not cache: ' + e.message + ')'); }
        return modules;
      });
  }

  function matches(item, target) {
    if (target.moduleItemId) return String(item.id) === String(target.moduleItemId);
    if (item.type !== target.type) return false;
    if (target.type === 'Page') return item.page_url === target.pageUrl;
    return String(item.content_id) === String(target.contentId);
  }

  function findPosition(modules, target) {
    for (var i = 0; i < modules.length; i++) {
      // Text headers are labels, not steps.
      var steps = (modules[i].items || []).filter(function (it) { return it.type !== 'SubHeader'; });
      for (var j = 0; j < steps.length; j++) {
        if (matches(steps[j], target)) {
          return { module: modules[i], step: j + 1, total: steps.length };
        }
      }
    }
    return null;
  }

  function moduleLabel(name) {
    var m = name.match(/^\s*((?:module|week|unit|lesson|chapter|part)\s*\d+)/i);
    return m ? m[1] : name;
  }

  function injectStyles() {
    if (document.getElementById('cmpb-styles')) return;
    var css =
      '#cmpb-progress{margin:0 0 1.25em;font-family:inherit;}' +
      '#cmpb-progress .cmpb-label{font-size:.9em;font-weight:600;margin-bottom:.35em;}' +
      '#cmpb-progress .cmpb-track{background:' + CONFIG.track + ';border-radius:6px;height:12px;overflow:hidden;}' +
      '#cmpb-progress .cmpb-fill{background:' + CONFIG.fill + ';height:100%;border-radius:6px;transition:width .4s ease;}';
    var style = document.createElement('style');
    style.id = 'cmpb-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildBar(pos) {
    var pct = Math.round((pos.step / pos.total) * 100);
    var label = moduleLabel(pos.module.name) + ' Progress: Step ' + pos.step + ' of ' + pos.total + ' (' + pct + '%)';

    var wrap = document.createElement('div');
    wrap.id = 'cmpb-progress';

    var text = document.createElement('div');
    text.className = 'cmpb-label';
    text.id = 'cmpb-label';
    text.textContent = label;

    var track = document.createElement('div');
    track.className = 'cmpb-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-labelledby', 'cmpb-label');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(pos.total));
    track.setAttribute('aria-valuenow', String(pos.step));

    var fill = document.createElement('div');
    fill.className = 'cmpb-fill';
    fill.style.width = pct + '%';

    track.appendChild(fill);
    wrap.appendChild(text);
    wrap.appendChild(track);
    return wrap;
  }

  function insertBar(bar) {
    if (document.getElementById('cmpb-progress')) return true;
    var container = document.querySelector(CONFIG.containerSelector);
    if (!container) return false;
    var debugBox = document.getElementById('cmpb-debug');
    var anchor = debugBox && debugBox.parentNode === container ? debugBox.nextSibling : container.firstChild;
    container.insertBefore(bar, anchor);
    return true;
  }

  function render(pos) {
    injectStyles();
    var bar = buildBar(pos);
    if (!insertBar(bar)) {
      log('Stopped: could not find ' + CONFIG.containerSelector + ' on the page');
      return;
    }
    log('6. Bar added: Step ' + pos.step + ' of ' + pos.total + ' in "' + pos.module.name + '"');

    // Canvas sometimes redraws the page after load; put the bar back if it disappears.
    var checks = 0;
    var timer = setInterval(function () {
      checks++;
      if (!document.getElementById('cmpb-progress')) {
        insertBar(bar);
        log('   (bar was removed by Canvas and re-added)');
      }
      if (checks >= 20) clearInterval(timer);
    }, 500);
  }

  function run() {
    var target = currentTarget();
    if (!target) { log('Stopped: this page type is not tracked (' + path + ')'); return; }
    log('2. Looking for: ' + JSON.stringify(target));

    loadModules()
      .then(function (modules) {
        var pos = findPosition(modules, target);
        if (!pos) { log('Stopped: this item was not found in any module'); return; }
        log('5. Found in "' + pos.module.name + '", step ' + pos.step + ' of ' + pos.total);
        render(pos);
      })
      .catch(function (err) {
        log('ERROR: ' + (err && err.message ? err.message : err));
        if (window.console) console.warn('[progress-bar]', err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
