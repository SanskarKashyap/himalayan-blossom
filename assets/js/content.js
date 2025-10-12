(function () {
  'use strict';

  const DATA_BASE_PATH = 'data/';
  const cache = new Map();
  let refreshHandle = null;

  function scheduleRefresh() {
    if (refreshHandle !== null) {
      return;
    }
    refreshHandle = requestAnimationFrame(() => {
      refreshHandle = null;
      if (window.HBSite && typeof window.HBSite.refreshPage === 'function') {
        window.HBSite.refreshPage();
      }
      if (window.HBPage && typeof window.HBPage.refresh === 'function') {
        window.HBPage.refresh();
      }
    });
  }

  function setLocaleText(element, texts) {
    if (!element || !texts) return;

    const en = typeof texts.en === 'string' ? texts.en : '';
    const hi = typeof texts.hi === 'string' && texts.hi.length ? texts.hi : en;

    element.setAttribute('data-en', en);
    element.setAttribute('data-hi', hi);
    element.textContent = en;
  }

  async function loadData(name) {
    if (!cache.has(name)) {
      const url = `${DATA_BASE_PATH}${name}.json`;
      cache.set(
        name,
        fetch(url, { cache: 'no-cache' })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Failed to load ${url}: ${response.status}`);
            }
            return response.json();
          })
          .catch((error) => {
            console.error('[content] Unable to load data file', url, error);
            cache.delete(name);
            throw error;
          })
      );
    }
    return cache.get(name);
  }

  function renderHighlights(container, data) {
    const template = document.getElementById('highlight-card-template');
    if (!template || !data || !Array.isArray(data.cards)) return;

    container.innerHTML = '';

    data.cards.forEach((card, index) => {
      const fragment = template.content.cloneNode(true);
      const column = fragment.querySelector('[data-aos="fade-up"]');
      const icon = fragment.querySelector('i');
      const title = fragment.querySelector('h3');
      const description = fragment.querySelector('p');
      const link = fragment.querySelector('a');

      if (column) {
        const delay = card.aosDelay != null ? card.aosDelay : (index + 1) * 100;
        column.setAttribute('data-aos-delay', String(delay));
      }

      if (icon && typeof card.icon === 'string') {
        icon.classList.add(card.icon);
      }

      setLocaleText(title, card.title || {});
      setLocaleText(description, card.description || {});

      if (link && card.link) {
        link.href = card.link.href || '#';
        setLocaleText(link, card.link.text || {});
      }

      container.appendChild(fragment);
    });

    scheduleRefresh();
  }

  function renderJournal(container, data) {
    const template = document.getElementById('journal-card-template');
    if (!template || !data || !Array.isArray(data.articles)) return;

    container.innerHTML = '';

    data.articles.forEach((article, index) => {
      const fragment = template.content.cloneNode(true);
      const column = fragment.querySelector('[data-aos="fade-up"]');
      const heading = fragment.querySelector('h3');
      const summary = fragment.querySelector('p');
      const link = fragment.querySelector('a');

      if (column) {
        column.setAttribute('data-aos-delay', String((index + 1) * 100));
      }

      setLocaleText(heading, article.title || {});
      setLocaleText(summary, article.summary || {});

      if (link && article.link) {
        link.href = article.link.href || '#';
        setLocaleText(link, article.link.text || {});
      }

      container.appendChild(fragment);
    });

    scheduleRefresh();
  }

  function renderMenu(container, data) {
    const template = document.getElementById('menu-item-template');
    if (!template || !data || !Array.isArray(data.products)) return;

    container.innerHTML = '';

    data.products.forEach((product, index) => {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector('.menu-item');
      const image = fragment.querySelector('img');
      const heading = fragment.querySelector('h4');
      const tagline = fragment.querySelector('p.ingredients');

      if (!card) return;

      const titleEn = (product.title && product.title.en) || '';
      const titleHi = (product.title && product.title.hi) || titleEn;
      const detailsEn = Array.isArray(product.details && product.details.en)
        ? product.details.en
        : [];
      const detailsHi = Array.isArray(product.details && product.details.hi)
        ? product.details.hi
        : detailsEn;
      const descEn = detailsEn.join('<br>');
      const descHi = detailsHi.join('<br>');

      card.setAttribute('data-title', titleEn);
      card.setAttribute('data-title-hi', titleHi);
      card.setAttribute('data-img', product.image ? product.image.src || '' : '');
      card.setAttribute('data-desc', descEn);
      card.setAttribute('data-desc-hi', descHi);
      card.setAttribute('data-aos-delay', String((index % 3) * 100 + 100));

      if (image && product.image) {
        image.src = product.image.src || '';
        const altEn = (product.image.alt && product.image.alt.en) || '';
        const altHi = (product.image.alt && product.image.alt.hi) || altEn;
        image.alt = altEn;
        image.setAttribute('data-alt-en', altEn);
        image.setAttribute('data-alt-hi', altHi);
      }

      setLocaleText(heading, product.title || {});
      setLocaleText(tagline, product.tagline || {});

      container.appendChild(fragment);
    });

    scheduleRefresh();
  }

  function renderEvents(container, data) {
    const template = document.getElementById('event-slide-template');
    if (!template || !data || !Array.isArray(data.events)) return;

    container.innerHTML = '';

    data.events.forEach((event) => {
      const fragment = template.content.cloneNode(true);
      const slide = fragment.querySelector('.event-item');
      const title = fragment.querySelector('h3');
      const category = fragment.querySelector('.price');
      const description = fragment.querySelector('p.description');

      if (slide && event.image) {
        slide.style.backgroundImage = `url(${event.image})`;
      }

      setLocaleText(title, event.title || {});
      setLocaleText(category, event.category || {});
      setLocaleText(description, event.description || {});

      container.appendChild(fragment);
    });

    scheduleRefresh();
  }

  function renderTeam(container, data) {
    const template = document.getElementById('team-member-template');
    if (!template || !data || !Array.isArray(data.team)) return;

    container.innerHTML = '';

    data.team.forEach((member, index) => {
      const fragment = template.content.cloneNode(true);
      const column = fragment.querySelector('[data-aos="fade-up"]');
      const img = fragment.querySelector('img');
      const name = fragment.querySelector('.member-info h4');
      const role = fragment.querySelector('.member-info span');
      const bio = fragment.querySelector('.member-info p');
      const socials = fragment.querySelector('.social');

      if (column) {
        column.setAttribute('data-aos-delay', String((index + 1) * 100));
      }

      if (img && member.image) {
        img.src = member.image.src || '';
        const altEn = (member.image.alt && member.image.alt.en) || '';
        const altHi = (member.image.alt && member.image.alt.hi) || altEn;
        img.alt = altEn;
        img.setAttribute('data-alt-en', altEn);
        img.setAttribute('data-alt-hi', altHi);
      }

      setLocaleText(name, member.name || {});
      setLocaleText(role, member.role || {});
      setLocaleText(bio, member.bio || {});

      if (socials) {
        socials.innerHTML = '';
        const links = Array.isArray(member.social) ? member.social : [];
        links.forEach((entry) => {
          const a = document.createElement('a');
          a.href = entry.href || '#';
          a.setAttribute('aria-label', entry.icon || 'Social link');
          const icon = document.createElement('i');
          icon.className = entry.icon || '';
          a.appendChild(icon);
          socials.appendChild(a);
        });
      }

      container.appendChild(fragment);
    });

    scheduleRefresh();
  }

  function renderGallery(container, data) {
    const template = document.getElementById('gallery-slide-template');
    if (!template || !data || !Array.isArray(data.images)) return;

    container.innerHTML = '';

    data.images.forEach((imageData) => {
      const fragment = template.content.cloneNode(true);
      const slide = fragment.querySelector('.swiper-slide');
      const link = fragment.querySelector('a');
      const img = fragment.querySelector('img');

      if (link && imageData.src) {
        link.href = imageData.src;
      }

      if (img && imageData.src) {
        img.src = imageData.src;
        const altEn = (imageData.alt && imageData.alt.en) || '';
        const altHi = (imageData.alt && imageData.alt.hi) || altEn;
        img.alt = altEn;
        img.setAttribute('data-alt-en', altEn);
        img.setAttribute('data-alt-hi', altHi);
      }

      container.appendChild(fragment);
    });

    scheduleRefresh();
  }

  function renderRituals(container, data) {
    const template = document.getElementById('ritual-card-template');
    if (!template || !data || !Array.isArray(data.rituals)) return;

    container.innerHTML = '';

    data.rituals.forEach((ritual, index) => {
      const fragment = template.content.cloneNode(true);
      const column = fragment.querySelector('[data-aos="fade-up"]');
      const heading = fragment.querySelector('h3');
      const description = fragment.querySelector('p');
      const list = fragment.querySelector('ul');

      if (column) {
        column.setAttribute('data-aos-delay', String((index + 1) * 100));
      }

      setLocaleText(heading, ritual.title || {});
      setLocaleText(description, ritual.description || {});

      if (list) {
        list.innerHTML = '';
        const steps = Array.isArray(ritual.steps) ? ritual.steps : [];
        steps.forEach((step) => {
          const li = document.createElement('li');
          setLocaleText(li, step || {});
          list.appendChild(li);
        });
      }

      container.appendChild(fragment);
    });

    scheduleRefresh();
  }

  const renderers = [
    { selector: '[data-content="highlights"]', dataFile: 'highlights', render: renderHighlights },
    { selector: '[data-content="journal"]', dataFile: 'journal', render: renderJournal },
    { selector: '[data-content="menu"]', dataFile: 'menu', render: renderMenu },
    { selector: '[data-content="events"]', dataFile: 'events', render: renderEvents },
    { selector: '[data-content="team"]', dataFile: 'team', render: renderTeam },
    { selector: '[data-content="gallery"]', dataFile: 'gallery', render: renderGallery },
    { selector: '[data-content="rituals"]', dataFile: 'wellness', render: renderRituals }
  ];

  async function renderSections() {
    await Promise.all(
      renderers.map(async (config) => {
        const targets = Array.from(document.querySelectorAll(config.selector));
        if (!targets.length) return;
        let data;
        try {
          data = await loadData(config.dataFile);
        } catch (error) {
          return;
        }
        targets.forEach((target) => {
          if (!target || target.dataset.hbRendered === 'true') return;
          try {
            config.render(target, data);
            target.dataset.hbRendered = 'true';
          } catch (error) {
            console.error('[content] Failed to render section', config.selector, error);
          }
        });
      })
    );
  }

  function init() {
    renderSections();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('hb:spa:pagechange', () => {
    renderSections();
  });
})();
