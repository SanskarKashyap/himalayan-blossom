(function () {
  'use strict';

  const storage = window.localStorage;
  const PREFILL_KEY = 'hb_preorder_prefill_v1';
  const PRODUCT_ASSETS_KEY = 'hb_product_assets_v1';
  const DEFAULT_PRODUCT_ASSETS = {
    'Van Amrit — Wild Honey': { img: 'assets/img/menu/menu-item-1.png' },
    'Shila Madhu — Honey Dew': { img: 'assets/img/menu/menu-item-2.png' },
    'Him Kanti — White Honey': { img: 'assets/img/menu/menu-item-3.png' },
    'Kashtha Bal — Chestnut Honey': { img: 'assets/img/menu/menu-item-4.png' },
    'Him Saans — Thyme Honey': { img: 'assets/img/menu/menu-item-5.png' },
    'Pachan Amrit — Ajwain Honey': { img: 'assets/img/menu/menu-item-6.png' },
    'Gahana Madhu — Malty Honey': { img: 'assets/img/menu/menu-item-7.png' },
    'Sarson Tejas — Mustard Honey': { img: 'assets/img/menu/menu-item-8.png' },
    'Kshudhra Madhu — Stingless Bee Honey': { img: 'assets/img/menu/menu-item-9.png' },
  };

  const state = {
    language: storage.getItem('language') || 'en',
    theme: storage.getItem('theme') || 'light',
    productAssets: { ...DEFAULT_PRODUCT_ASSETS },
  };

  try {
    const storedAssets = storage.getItem(PRODUCT_ASSETS_KEY);
    if (storedAssets) {
      state.productAssets = { ...DEFAULT_PRODUCT_ASSETS, ...(JSON.parse(storedAssets) || {}) };
    }
  } catch (error) {
    state.productAssets = { ...DEFAULT_PRODUCT_ASSETS };
  }

  function qs(selector, context) {
    return (context || document).querySelector(selector);
  }

  function qsa(selector, context) {
    return Array.from((context || document).querySelectorAll(selector));
  }

  function registerProductAsset(item) {
    if (!item) return;
    const title = item.getAttribute('data-title');
    if (!title) return;
    const existing = state.productAssets[title] || {};
    state.productAssets[title] = {
      img: item.getAttribute('data-img') || existing.img || '',
      titleHi: item.getAttribute('data-title-hi') || existing.titleHi || '',
    };
    try {
      storage.setItem(PRODUCT_ASSETS_KEY, JSON.stringify(state.productAssets));
    } catch (error) {
      /* ignore quota issues */
    }
  }

  function collectProductAssets() {
    qsa('.menu-item').forEach(registerProductAsset);
  }

  function updateLanguage(lang) {
    state.language = lang;
    storage.setItem('language', lang);

    qsa('[data-en][data-hi]').forEach((el) => {
      const value = lang === 'hi' ? el.getAttribute('data-hi') : el.getAttribute('data-en');
      if (value !== null && value !== undefined) {
        el.textContent = value;
      }
    });

    qsa('[data-placeholder-en][data-placeholder-hi]').forEach((el) => {
      el.placeholder = lang === 'hi'
        ? el.getAttribute('data-placeholder-hi')
        : el.getAttribute('data-placeholder-en');
    });

    qsa('[data-value-en][data-value-hi]').forEach((el) => {
      el.value = lang === 'hi'
        ? el.getAttribute('data-value-hi')
        : el.getAttribute('data-value-en');
    });

    qsa('[data-title-en][data-title-hi]').forEach((el) => {
      el.title = lang === 'hi'
        ? el.getAttribute('data-title-hi')
        : el.getAttribute('data-title-en');
    });

    qsa('[data-alt-en][data-alt-hi]').forEach((el) => {
      el.alt = lang === 'hi'
        ? el.getAttribute('data-alt-hi')
        : el.getAttribute('data-alt-en');
    });

    const desktopToggle = qs('#lang-toggle');
    if (desktopToggle) {
      const label = desktopToggle.querySelector('span');
      if (label) {
        label.textContent = lang === 'en' ? 'हिं' : 'EN';
      }
    }

    const mobileToggle = qs('#mobile-lang-toggle');
    if (mobileToggle) {
      const label = mobileToggle.querySelector('span');
      if (label) {
        label.textContent = lang === 'en' ? 'हिं' : 'EN';
      }
    }
  }

  function initLanguageToggle() {
    const toggle = qs('#lang-toggle');
    if (!toggle) {
      updateLanguage(state.language);
      return;
    }

    updateLanguage(state.language);

    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      const nextLang = state.language === 'en' ? 'hi' : 'en';
      updateLanguage(nextLang);
    });

    const mobileToggle = qs('#mobile-lang-toggle');
    if (mobileToggle) {
      mobileToggle.addEventListener('click', (event) => {
        event.preventDefault();
        toggle.dispatchEvent(new Event('click', { bubbles: false, cancelable: true }));
      });
    }
  }

  function updateModalThemes() {
    const shouldUseDark = document.body.classList.contains('dark-theme');
    [qs('#productModal'), qs('#preorderSelectionModal')].forEach((modal) => {
      if (!modal) return;
      modal.classList.toggle('dark-theme', shouldUseDark);
    });
  }

  function applyTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    storage.setItem('theme', state.theme);

    const body = document.body;
    const toggle = qs('#theme-toggle');
    const icon = toggle ? toggle.querySelector('i') : null;

    if (state.theme === 'dark') {
      body.classList.add('dark-theme');
      if (icon) {
        icon.classList.remove('bi-sun');
        icon.classList.add('bi-moon');
      }
    } else {
      body.classList.remove('dark-theme');
      if (icon) {
        icon.classList.add('bi-sun');
        icon.classList.remove('bi-moon');
      }
    }

    updateModalThemes();
  }

  function initThemeToggle() {
    applyTheme(state.theme);

    const toggle = qs('#theme-toggle');
    if (toggle) {
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
        applyTheme(nextTheme);
      });
    }

    const mobileToggle = qs('#mobile-theme-toggle');
    if (mobileToggle && toggle) {
      mobileToggle.addEventListener('click', (event) => {
        event.preventDefault();
        toggle.dispatchEvent(new Event('click', { bubbles: false, cancelable: true }));
      });
    }
  }

  function initMobileNav() {
    const toggle = qs('.mobile-nav-toggle');
    const mobileNav = qs('.mobile-nav');
    if (!toggle || !mobileNav) return;

    const icon = toggle.querySelector('i');

    toggle.addEventListener('click', () => {
      const isActive = mobileNav.classList.toggle('active');
      document.body.classList.toggle('mobile-nav-active', isActive);
      if (icon) {
        icon.classList.toggle('bi-list', !isActive);
        icon.classList.toggle('bi-x', isActive);
      }
    });

    qsa('.mobile-nav-menu a').forEach((link) => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('active');
        document.body.classList.remove('mobile-nav-active');
        if (icon) {
          icon.classList.add('bi-list');
          icon.classList.remove('bi-x');
        }
      });
    });
  }

  function closeModal(modal, overlay) {
    if (overlay) overlay.style.display = 'none';
    if (modal) modal.style.display = 'none';
  }

  function initProductModal() {
    const modal = qs('#productModal');
    const overlay = qs('#modalOverlay');
    const modalImg = qs('#modalImg');
    const modalTitle = qs('#modalTitle');
    const descContainer = qs('#modalDesc');

    if (!modal || !overlay) return;

    qsa('.menu-item').forEach((item) => {
      registerProductAsset(item);
      item.addEventListener('click', (event) => {
        if (event.target.closest('a[href="#preorder"]')) {
          return;
        }

        const clickedLink = event.target.closest('a');
        if (clickedLink) {
          event.preventDefault();
        }

        const titleEn = item.getAttribute('data-title') || '';
        const titleHi = item.getAttribute('data-title-hi') || titleEn;
        const descEnRaw = item.getAttribute('data-desc') || '';
        const descHiRaw = item.getAttribute('data-desc-hi') || '';
        const imageSrc = item.getAttribute('data-img') || '';
        const productImgEl = item.querySelector('img');
        const altEn = productImgEl
          ? productImgEl.getAttribute('data-alt-en') || productImgEl.getAttribute('alt') || titleEn
          : titleEn;
        const altHi = productImgEl
          ? productImgEl.getAttribute('data-alt-hi') || titleHi
          : titleHi;
        const isHindi = state.language === 'hi';

        if (modalImg) {
          modalImg.src = imageSrc;
          modalImg.setAttribute('data-alt-en', altEn);
          modalImg.setAttribute('data-alt-hi', altHi);
          modalImg.alt = isHindi && altHi ? altHi : altEn;
        }

        if (modalTitle) {
          modalTitle.setAttribute('data-en', titleEn);
          modalTitle.setAttribute('data-hi', titleHi);
          modalTitle.textContent = isHindi && titleHi ? titleHi : titleEn;
        }

        if (descContainer) {
          descContainer.innerHTML = '';
          const descPartsEn = descEnRaw.split('<br>');
          const descPartsHi = descHiRaw.split('<br>');
          const tileCount = Math.max(descPartsEn.length, descPartsHi.length);

          for (let index = 0; index < tileCount; index += 1) {
            const cleanEn = (descPartsEn[index] || '').trim();
            const cleanHi = (descPartsHi[index] || '').trim();
            if (!cleanEn && !cleanHi) continue;

            const tile = document.createElement('div');
            tile.className = 'desc-tile';
            tile.setAttribute('data-en', cleanEn);
            tile.setAttribute('data-hi', cleanHi || cleanEn);
            tile.textContent = isHindi && (cleanHi || cleanEn)
              ? (cleanHi || cleanEn)
              : cleanEn;
            descContainer.appendChild(tile);
          }
        }

        overlay.style.display = 'block';
        modal.style.display = 'flex';
        updateModalThemes();
      });
    });

    const closeBtn = qs('#productModal .modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closeModal(modal, overlay));
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeModal(modal, overlay);
      }
    });

    window.addEventListener('keyup', (event) => {
      if (event.key === 'Escape' && overlay.style.display === 'block') {
        closeModal(modal, overlay);
      }
    });
  }

  function initPreorderModal() {
    const overlay = qs('#preorderModalOverlay');
    const modal = qs('#preorderSelectionModal');
    const modalImg = qs('#preorderModalImg');
    const modalTitle = qs('#preorderModalTitle');
    const confirmBtn = qs('#preorderModalConfirm');
    const cancelBtn = qs('#preorderModalCancel');
    const closeBtn = qs('#preorderModalClose');
    const sizeInputs = qsa('input[name="preorderSize"]', modal || undefined);

    if (!overlay || !modal || !confirmBtn) return;

    let activeItem = null;

    function resetModal() {
      activeItem = null;
      confirmBtn.disabled = true;
      sizeInputs.forEach((input) => {
        input.checked = false;
      });
    }

    qsa('.menu-item a[href="#preorder"]').forEach((button) => {
      registerProductAsset(button.closest('.menu-item'));
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const menuItem = button.closest('.menu-item');
        if (!menuItem) return;
        activeItem = menuItem;

        const titleEn = menuItem.getAttribute('data-title') || '';
        const titleHi = menuItem.getAttribute('data-title-hi') || titleEn;
        const imageSrc = menuItem.getAttribute('data-img') || '';
        const productImgEl = menuItem.querySelector('img');
        const altEn = productImgEl
          ? productImgEl.getAttribute('data-alt-en') || productImgEl.getAttribute('alt') || titleEn
          : titleEn;
        const altHi = productImgEl
          ? productImgEl.getAttribute('data-alt-hi') || titleHi
          : titleHi;
        const isHindi = state.language === 'hi';

        if (modalImg) {
          modalImg.src = imageSrc;
          modalImg.setAttribute('data-alt-en', altEn);
          modalImg.setAttribute('data-alt-hi', altHi);
          modalImg.alt = isHindi && altHi ? altHi : altEn;
        }

        if (modalTitle) {
          modalTitle.setAttribute('data-en', titleEn);
          modalTitle.setAttribute('data-hi', titleHi);
          modalTitle.textContent = isHindi && titleHi ? titleHi : titleEn;
        }

        resetModal();
        overlay.style.display = 'block';
        modal.style.display = 'flex';
        updateModalThemes();
      });
    });

    sizeInputs.forEach((input) => {
      input.addEventListener('change', () => {
        confirmBtn.disabled = !sizeInputs.some((radio) => radio.checked);
      });
    });

    confirmBtn.addEventListener('click', () => {
      const selected = sizeInputs.find((radio) => radio.checked);
      if (!selected || !activeItem) return;

      const productTitle = activeItem.getAttribute('data-title') || '';
      const productTitleHi = activeItem.getAttribute('data-title-hi') || '';
      const productImg = activeItem.getAttribute('data-img') || '';
      const payload = {
        product: productTitle,
        productHi: productTitleHi,
        size: selected.value,
        img: productImg,
      };

      try {
        storage.setItem(PREFILL_KEY, JSON.stringify(payload));
      } catch (error) {
        /* ignore */
      }

      const params = new URLSearchParams();
      if (productTitle) params.set('product', productTitle);
      if (selected.value) params.set('size', selected.value);
      window.location.href = `preorder.html?${params.toString()}`;
    });

    function hideModal() {
      overlay.style.display = 'none';
      modal.style.display = 'none';
      resetModal();
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', hideModal);
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', hideModal);
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        hideModal();
      }
    });

    window.addEventListener('keyup', (event) => {
      if (event.key === 'Escape' && overlay.style.display === 'block') {
        hideModal();
      }
    });
  }

  function loadPreorderSeed() {
    try {
      const raw = storage.getItem(PREFILL_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function updateReservationImage(reservationImg, productName, fallback) {
    if (!reservationImg) return;
    let imageSrc = fallback || 'assets/img/reservation.jpg';

    if (productName && state.productAssets[productName] && state.productAssets[productName].img) {
      imageSrc = state.productAssets[productName].img;
    } else {
      const seed = loadPreorderSeed();
      if (seed && seed.product === productName && seed.img) {
        imageSrc = seed.img;
      }
    }

    reservationImg.style.backgroundImage = `url(${imageSrc})`;
  }

  function initPreorderForm() {
    const preorderSection = qs('#preorder');
    if (!preorderSection) return;

    const productSelect = qs('select[name="product"]', preorderSection);
    const sizeSelect = qs('select[name="size"]', preorderSection);
    const reservationImg = qs('.reservation-img', preorderSection);
    const params = new URLSearchParams(window.location.search);
    const seed = loadPreorderSeed();

    const initialProduct = params.get('product') || (seed && seed.product) || '';
    const initialSize = params.get('size') || (seed && seed.size) || '';

    if (productSelect && initialProduct) {
      const option = qsa('option', productSelect).find((opt) => opt.value === initialProduct);
      if (option) {
        productSelect.value = initialProduct;
      }
    }

    if (sizeSelect && initialSize) {
      const option = qsa('option', sizeSelect).find((opt) => opt.value === initialSize);
      if (option) {
        sizeSelect.value = initialSize;
      }
    }

    updateReservationImage(reservationImg, productSelect ? productSelect.value : initialProduct);

    if (productSelect) {
      productSelect.addEventListener('change', () => {
        updateReservationImage(reservationImg, productSelect.value);
      });
    }
  }

  function initContactForm() {
    const form = qs('.contact-form');
    if (!form) return;

    window.sendToWhatsApp = function sendToWhatsApp() {
      const name = (qs('#name') || { value: '' }).value.trim();
      const email = (qs('#email') || { value: '' }).value.trim();
      const subject = (qs('#subject') || { value: '' }).value.trim();
      const message = (qs('#message') || { value: '' }).value.trim();
      const phone = '919876543210';
      const text = `Hello Himalayan Blossom, my name is ${name}.\nEmail: ${email}\nSubject: ${subject}\nMessage: ${message}`;
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    };
  }

  function init() {
    collectProductAssets();
    initLanguageToggle();
    initThemeToggle();
    initMobileNav();
    initProductModal();
    initPreorderModal();
    initPreorderForm();
    initContactForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
