(function () {
  'use strict';

  const contentSelector = 'main.main';
  const supported =
    typeof window.fetch === 'function' &&
    typeof window.history !== 'undefined' &&
    typeof window.history.pushState === 'function' &&
    document.querySelector(contentSelector);

  if (!supported) {
    return;
  }

  let isNavigating = false;
  const preservedBodyClasses = new Set(['dark-theme']);

  function normalizePathname(url) {
    const normalized = url.pathname.endsWith('/')
      ? url.pathname.slice(0, -1) || '/'
      : url.pathname;
    return normalized.toLowerCase();
  }

  function shouldHandleLink(event, anchor) {
    if (!anchor) return false;
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return false;
    if (anchor.hasAttribute('download')) return false;
    if (anchor.target && anchor.target.toLowerCase() !== '_self') return false;
    if (anchor.dataset.noSpa === 'true') return false;

    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return false;
    if (url.protocol !== window.location.protocol) return false;
    if (url.hash && normalizePathname(url) === normalizePathname(window.location)) {
      return false;
    }

    const extMatch = url.pathname.split('.').pop();
    if (extMatch && extMatch !== url.pathname && !/html?$/i.test(extMatch)) {
      return false;
    }

    return true;
  }

  function syncDocumentMeta(sourceDocument) {
    if (!sourceDocument) return;
    const newDescription = sourceDocument.querySelector('meta[name="description"]');
    if (newDescription) {
      let currentDescription = document.querySelector('meta[name="description"]');
      if (!currentDescription) {
        currentDescription = document.createElement('meta');
        currentDescription.setAttribute('name', 'description');
        document.head.appendChild(currentDescription);
      }
      currentDescription.setAttribute('content', newDescription.getAttribute('content') || '');
    }
  }

  function syncBodyAttributes(newBody) {
    if (!newBody) return;
    const newClasses = new Set(
      newBody.className.split(/\s+/).filter((cls) => cls && cls.trim().length)
    );

    preservedBodyClasses.forEach((cls) => {
      if (document.body.classList.contains(cls)) {
        newClasses.add(cls);
      }
    });

    newClasses.delete('mobile-nav-active');
    document.body.className = Array.from(newClasses).join(' ');
  }

  function closeMobileNav() {
    const toggler =
      (window.HBPage && typeof window.HBPage.toggleMobileNav === 'function' && window.HBPage.toggleMobileNav)
      || (window.HBSite && typeof window.HBSite.toggleMobileNav === 'function' && window.HBSite.toggleMobileNav);

    if (toggler) {
      toggler(false);
      return;
    }

    const mobileNav = document.querySelector('.mobile-nav');
    const toggle = document.querySelector('.mobile-nav-toggle');
    const icon = toggle ? toggle.querySelector('i') : null;

    if (mobileNav) {
      mobileNav.classList.remove('active');
    }
    document.body.classList.remove('mobile-nav-active');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
    }
    if (mobileNav) {
      mobileNav.setAttribute('aria-hidden', 'true');
    }
    if (icon) {
      icon.classList.add('bi-list');
      icon.classList.remove('bi-x');
    }
  }

  function updateActiveNavigation(pathname) {
    const allLinks = document.querySelectorAll('#navmenu a, .mobile-nav-menu a');
    allLinks.forEach((link) => {
      const linkUrl = new URL(link.href, window.location.href);
      const isActive = normalizePathname(linkUrl) === pathname;
      if (isActive) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  function dispatchPageChange(url) {
    document.dispatchEvent(new CustomEvent('hb:spa:pagechange', { detail: { url } }));
    if (window.HBPage && typeof window.HBPage.refresh === 'function') {
      window.HBPage.refresh();
    }
    if (window.HBSite && typeof window.HBSite.refreshPage === 'function') {
      window.HBSite.refreshPage();
    }
  }

  async function fetchPage(url) {
    const response = await fetch(url, {
      headers: {
        'X-Requested-With': 'hb-spa',
      },
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`);
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const newMain = doc.querySelector(contentSelector);
    if (!newMain) {
      throw new Error(`Content selector ${contentSelector} not found in ${url}`);
    }

    return {
      document: doc,
      main: document.importNode(newMain, true),
    };
  }

  async function renderPage(targetUrl, options) {
    if (isNavigating) return;
    isNavigating = true;
    document.body.classList.add('spa-loading');

    try {
      const { document: nextDoc, main } = await fetchPage(targetUrl.href);
      const currentMain = document.querySelector(contentSelector);
      if (!currentMain) {
        throw new Error(`Current content selector ${contentSelector} not found`);
      }

      currentMain.replaceWith(main);

      document.title = nextDoc.title || document.title;
      syncDocumentMeta(nextDoc);
      syncBodyAttributes(nextDoc.body);
      document.documentElement.lang = nextDoc.documentElement.lang || document.documentElement.lang;

      if (options.replaceState) {
        window.history.replaceState({ url: targetUrl.href }, '', targetUrl.href);
      } else if (!options.skipPushState) {
        window.history.pushState({ url: targetUrl.href }, '', targetUrl.href);
      }

      updateActiveNavigation(normalizePathname(targetUrl));
      closeMobileNav();
      window.scrollTo({ top: 0, behavior: 'auto' });

      dispatchPageChange(targetUrl.href);
    } catch (error) {
      console.error('SPA navigation error:', error);
      window.location.href = targetUrl.href;
    } finally {
      document.body.classList.remove('spa-loading');
      isNavigating = false;
    }
  }

  function navigate(url, options = {}) {
    const target = new URL(url, window.location.href);
    const current = normalizePathname(window.location);
    const destination = normalizePathname(target);

    if (target.href === window.location.href && !target.hash) {
      return;
    }

    if (destination === current && target.search === window.location.search && !options.force) {
      return;
    }

    renderPage(target, options);
  }

  window.HBRouter = {
    navigate,
  };

  if (!window.history.state || !window.history.state.url) {
    window.history.replaceState({ url: window.location.href }, '', window.location.href);
  }

  updateActiveNavigation(normalizePathname(window.location));

  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a');
    if (!shouldHandleLink(event, anchor)) {
      return;
    }

    const targetUrl = new URL(anchor.href, window.location.href);
    navigate(targetUrl.href);
    event.preventDefault();
  });

  window.addEventListener('popstate', (event) => {
    const url = (event.state && event.state.url) ? event.state.url : window.location.href;
    renderPage(new URL(url, window.location.href), { replaceState: true, skipPushState: true, force: true });
  });
})();
