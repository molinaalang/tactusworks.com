var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
var EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

// Swap text with a short roll: old value slides up and out, new one rises in.
function rollText(el, text) {
  if (el.textContent === text) return;
  if (reduceMotion || !el.animate) { el.textContent = text; return; }
  var out = el.animate(
    [{ opacity: 1, transform: 'none', filter: 'blur(0)' },
     { opacity: 0, transform: 'translateY(-16%)', filter: 'blur(2px)' }],
    { duration: 140, easing: EASE_OUT });
  out.onfinish = function () {
    el.textContent = text;
    el.animate(
      [{ opacity: 0, transform: 'translateY(16%)', filter: 'blur(2px)' },
       { opacity: 1, transform: 'none', filter: 'blur(0)' }],
      { duration: 260, easing: EASE_OUT });
  };
}

// Hero phone mock acts out a session: play two bars, go quiet, count down, step up
// with a color flash, and stop at the target. The dots pulse in time with the tempo.
(function () {
  var phone = document.querySelector('[data-hero-mock]');
  if (!phone || !window.Promise) return;
  var num = phone.querySelector('.num');
  var status = phone.querySelector('.status');
  var dots = phone.querySelectorAll('.dots i');
  var tempos = [120, 125, 130, 135, 140];
  var flash = ['green', 'coral', 'sky', 'lilac'];

  // Pause while the phone is off screen or the tab is hidden.
  var onScreen = true, waiters = [];
  function awake() { return onScreen && !document.hidden; }
  function release() { if (awake()) { waiters.splice(0).forEach(function (f) { f(); }); } }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { onScreen = e[0].isIntersecting; release(); }).observe(phone);
  }
  document.addEventListener('visibilitychange', release);
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); }).then(function () {
      return awake() ? null : new Promise(function (r) { waiters.push(r); });
    });
  }

  function pulse(b) {
    if (reduceMotion || !dots[b].animate) return;
    dots[b].animate(
      [{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }],
      { duration: 280, easing: EASE_OUT });
  }
  function bars(tempo, n) {
    var beat = 60000 / tempo, b = 0, p = Promise.resolve();
    for (var k = 0; k < n * dots.length; k++) {
      p = p.then(function () { pulse(b++ % dots.length); return sleep(beat); });
    }
    return p;
  }
  function flashTo(color) {
    phone.setAttribute('data-theme', color);
    setTimeout(function () { phone.setAttribute('data-theme', 'yellow'); }, 1000);
  }

  function session(i) {
    var t = tempos[i];
    return bars(t, 2).then(function () {
      if (i === tempos.length - 1) {
        rollText(status, 'target reached.');
        flashTo('coral');
        return sleep(3000).then(function () {
          rollText(num, String(tempos[0]));
          rollText(status, 'hearing you.');
          return sleep(800).then(function () { return session(0); });
        });
      }
      var next = tempos[i + 1];
      rollText(status, 'next, ' + next + ' in 2 seconds.');
      return sleep(1000).then(function () {
        rollText(status, 'next, ' + next + ' in 1 second.');
        return sleep(1000);
      }).then(function () {
        flashTo(flash[i % flash.length]);
        rollText(num, String(next));
        rollText(status, 'hearing you.');
        return session(i + 1);
      });
    });
  }
  sleep(600).then(function () { return session(0); });
})();

// Homepage cards: content below the fold fades up once as it scrolls in.
(function () {
  if (!('IntersectionObserver' in window)) return;
  var sections = document.querySelectorAll('main > section.card:not(:first-child) > .in');
  if (!sections.length) return;
  var targets = [];
  sections.forEach(function (inner) {
    Array.prototype.forEach.call(inner.children, function (child, n) {
      var list = child.matches('.steps, .modes, .features') ? child.children : null;
      if (list) {
        Array.prototype.forEach.call(list, function (li, m) { targets.push([li, Math.min(n, 3) * 60 + m * 70]); });
      } else {
        targets.push([child, Math.min(n, 4) * 60]);
      }
    });
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target;
      el.classList.remove('pre');
      io.unobserve(el);
      // Drop the reveal class afterwards so it never slows other transitions (e.g. button press).
      setTimeout(function () { el.classList.remove('reveal'); el.style.removeProperty('--d'); }, 1200);
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  targets.forEach(function (t) {
    var el = t[0];
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already in view: leave alone
    el.style.setProperty('--d', t[1] + 'ms');
    el.classList.add('reveal', 'pre');
    io.observe(el);
  });
})();

// Press kit: copy buttons.
(function () {
  var buttons = document.querySelectorAll('[data-copy-btn]');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var src = btn.parentNode.querySelector('[data-copy]');
      if (!src || !navigator.clipboard) return;
      navigator.clipboard.writeText(src.textContent.trim()).then(function () {
        var old = btn.textContent;
        btn.textContent = 'copied';
        setTimeout(function () { btn.textContent = old; }, 1500);
      }).catch(function () {});
    });
  });
})();

// Hero screen recording: hold on the poster frame for people who ask for less motion.
(function () {
  var v = document.querySelector('[data-shot="hero"] video');
  if (v && reduceMotion) { v.removeAttribute('autoplay'); v.pause(); }
})();
