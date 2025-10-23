(function () {
  'use strict';

  const Layout = window.HBLayout || (window.HBLayout = {});

  function loadFragment(element) {
    if (!element) return;
    const src = element.getAttribute('data-include');
    if (!src) return;

    try {
      const request = new XMLHttpRequest();
      request.open('GET', src, false);
      request.send(null);

      if (request.status >= 200 && request.status < 300) {
        element.outerHTML = request.responseText;
      } else {
        console.warn('HBLayout: Failed to load fragment', src, request.status);
      }
    } catch (error) {
      console.warn('HBLayout: Fragment load error', src, error);
    }
  }

  function highlightActiveNav() {
    const pageId = (document.body && document.body.getAttribute('data-page-id')) || '';
    if (!pageId) {
      return;
    }

    const links = document.querySelectorAll('[data-page-target]');
    links.forEach((link) => {
      const target = link.getAttribute('data-page-target') || '';
      const segments = target.split(',').map((item) => item.trim()).filter(Boolean);
      link.classList.toggle('active', segments.includes(pageId));
    });
  }

  function init() {
    const hosts = document.querySelectorAll('[data-include]');
    hosts.forEach(loadFragment);

    highlightActiveNav();

    if (document.body) {
      document.body.setAttribute('data-hb-layout-ready', 'true');
    }

    window.dispatchEvent(new CustomEvent('hb:layout:ready'));
  }

  Layout.refresh = function refreshLayout() {
    highlightActiveNav();
  };

  init();
})();
