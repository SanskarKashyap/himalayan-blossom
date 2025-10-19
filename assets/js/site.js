(function () {
  'use strict';

  const HBSite = window.HBSite || (window.HBSite = {});

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

  let globalsInitialized = false;

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

  function ensureProductModalStructure() {
    let overlay = qs('#modalOverlay');
    let modal = qs('#productModal');

    if (overlay && modal) {
      return { overlay, modal };
    }

    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (modal) {
      modal.remove();
      modal = null;
    }

    const template = document.createElement('template');
    template.innerHTML = `
      <div id="modalOverlay" class="modal-overlay"></div>
      <div id="productModal" class="modal product-modal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content">
            <span class="modal-close">&times;</span>
            <div class="row g-0">
              <div class="col-md-6">
                <img
                  id="modalImg"
                  src=""
                  alt=""
                  class="img-fluid rounded-start"
                />
              </div>
              <div class="col-md-6 d-flex flex-column justify-content-center">
                <div class="modal-body-right">
                  <h4 id="modalTitle"></h4>
                  <div id="modalDesc"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `.trim();

    document.body.appendChild(template.content);
    return {
      overlay: qs('#modalOverlay'),
      modal: qs('#productModal'),
    };
  }

  function ensurePreorderModalStructure() {
    let overlay = qs('#preorderModalOverlay');
    let modal = qs('#preorderSelectionModal');

    if (overlay && modal) {
      return { overlay, modal };
    }

    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (modal) {
      modal.remove();
      modal = null;
    }

    const template = document.createElement('template');
    template.innerHTML = `
      <div
        id="preorderModalOverlay"
        class="modal-overlay"
      ></div>
      <div
        id="preorderSelectionModal"
        class="modal preorder-modal"
        tabindex="-1"
      >
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content">
            <button
              type="button"
              class="modal-close"
              id="preorderModalClose"
              aria-label="Close"
            >
              &times;
            </button>
            <div class="row g-0">
              <div class="col-md-5">
                <img
                  id="preorderModalImg"
                  src=""
                  alt=""
                  class="img-fluid rounded-start"
                />
              </div>
              <div class="col-md-7 d-flex flex-column justify-content-center">
                <div class="modal-body-right">
                  <h4 id="preorderModalTitle"></h4>
                  <p
                    id="preorderModalSubtitle"
                    data-en="Select your preferred jar size to continue."
                    data-hi="जारी रखने के लिए अपना पसंदीदा जार आकार चुनें।"
                  >
                    Select your preferred jar size to continue.
                  </p>
                  <div class="size-options" id="preorderSizeOptions">
                    <label class="size-option" for="preorder-size-250">
                      <input
                        type="radio"
                        name="preorderSize"
                        id="preorder-size-250"
                        value="250 gram"
                      />
                      <span data-en="250 gram" data-hi="250 ग्राम">250 gram</span>
                    </label>
                    <label class="size-option" for="preorder-size-500">
                      <input
                        type="radio"
                        name="preorderSize"
                        id="preorder-size-500"
                        value="500 gram"
                      />
                      <span data-en="500 gram" data-hi="500 ग्राम">500 gram</span>
                    </label>
                    <label class="size-option" for="preorder-size-1000">
                      <input
                        type="radio"
                        name="preorderSize"
                        id="preorder-size-1000"
                        value="1000 gram"
                      />
                      <span data-en="1000 gram" data-hi="1000 ग्राम">1000 gram</span>
                    </label>
                  </div>
                  <div class="modal-actions">
                    <button
                      type="button"
                      class="modal-action-btn ghost"
                      id="preorderModalCancel"
                      data-en="Cancel"
                      data-hi="रद्द करें"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="modal-action-btn primary"
                      id="preorderModalConfirm"
                      data-en="Continue to Pre-order"
                      data-hi="प्री-ऑर्डर पर जाएँ"
                      disabled
                    >
                      Continue to Pre-order
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `.trim();

    document.body.appendChild(template.content);
    return {
      overlay: qs('#preorderModalOverlay'),
      modal: qs('#preorderSelectionModal'),
    };
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
    updateLanguage(state.language);

    const toggle = qs('#lang-toggle');
    if (toggle && !toggle.dataset.hbBound) {
      toggle.dataset.hbBound = 'true';
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        const nextLang = state.language === 'en' ? 'hi' : 'en';
        updateLanguage(nextLang);
      });
    }

    const mobileToggle = qs('#mobile-lang-toggle');
    if (mobileToggle && !mobileToggle.dataset.hbBound) {
      mobileToggle.dataset.hbBound = 'true';
      mobileToggle.addEventListener('click', (event) => {
        event.preventDefault();
        if (toggle) {
          toggle.dispatchEvent(new Event('click', { bubbles: false, cancelable: true }));
        } else {
          const nextLang = state.language === 'en' ? 'hi' : 'en';
          updateLanguage(nextLang);
        }
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
    if (toggle && !toggle.dataset.hbBound) {
      toggle.dataset.hbBound = 'true';
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
        applyTheme(nextTheme);
      });
    }

    const mobileToggle = qs('#mobile-theme-toggle');
    if (mobileToggle && !mobileToggle.dataset.hbBound) {
      mobileToggle.dataset.hbBound = 'true';
      mobileToggle.addEventListener('click', (event) => {
        event.preventDefault();
        if (toggle) {
          toggle.dispatchEvent(new Event('click', { bubbles: false, cancelable: true }));
        } else {
          const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
          applyTheme(nextTheme);
        }
      });
    }
  }

  function initMobileNav() {
    const toggle = qs('.mobile-nav-toggle');
    const mobileNav = qs('.mobile-nav');
    if (!toggle || !mobileNav) return;

    const icon = toggle.querySelector('i');

    const setState = (isActive) => {
      const hbToggle = window.HBPage && typeof window.HBPage.toggleMobileNav === 'function'
        ? window.HBPage.toggleMobileNav
        : null;

      if (hbToggle) {
        hbToggle(isActive);
        return isActive;
      }

      document.body.classList.toggle('mobile-nav-active', isActive);
      mobileNav.classList.toggle('active', isActive);
      mobileNav.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      toggle.setAttribute('aria-expanded', isActive ? 'true' : 'false');
      if (icon) {
        icon.classList.toggle('bi-list', !isActive);
        icon.classList.toggle('bi-x', isActive);
      }

      return isActive;
    };

    const toggleNav = (forceState) => {
      const nextState = typeof forceState === 'boolean'
        ? forceState
        : !mobileNav.classList.contains('active');
      return setState(nextState);
    };

    if (!toggle.dataset.hbBound) {
      toggle.dataset.hbBound = 'true';
      toggle.addEventListener('click', (event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        toggleNav();
      });
    }

    toggleNav(false);
    HBSite.toggleMobileNav = toggleNav;

    qsa('.mobile-nav-menu a').forEach((link) => {
      if (link.dataset.hbBound) return;
      link.dataset.hbBound = 'true';
      link.addEventListener('click', () => {
        toggleNav(false);
      });
    });
  }

  function closeModal(modal, overlay) {
    if (overlay && overlay._hbEscapeHandler) {
      window.removeEventListener('keyup', overlay._hbEscapeHandler);
      delete overlay._hbEscapeHandler;
    }
    if (overlay) overlay.style.display = 'none';
    if (modal) modal.style.display = 'none';
  }

  function initProductModal() {
    const { modal, overlay } = ensureProductModalStructure();
    const modalImg = qs('#modalImg');
    const modalTitle = qs('#modalTitle');
    const descContainer = qs('#modalDesc');

    if (!modal || !overlay) return;

    qsa('.menu-item').forEach((item) => {
      if (item.dataset.hbModalBound) return;
      item.dataset.hbModalBound = 'true';
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
        if (overlay._hbEscapeHandler) {
          window.removeEventListener('keyup', overlay._hbEscapeHandler);
        }
        const escapeHandler = (event) => {
          if (event.key === 'Escape') {
            closeModal(modal, overlay);
          }
        };
        overlay._hbEscapeHandler = escapeHandler;
        window.addEventListener('keyup', escapeHandler);
        updateModalThemes();
      });
    });

    const closeBtn = qs('#productModal .modal-close');
    if (closeBtn && !closeBtn.dataset.hbBound) {
      closeBtn.dataset.hbBound = 'true';
      closeBtn.addEventListener('click', () => closeModal(modal, overlay));
    }

    if (!overlay.dataset.hbBound) {
      overlay.dataset.hbBound = 'true';
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          closeModal(modal, overlay);
        }
      });
    }
  }

  function initPreorderModal() {
    console.log('[hb debug] initPreorderModal: Initializing preorder modal.');

    const { overlay, modal } = ensurePreorderModalStructure();
    const modalImg = qs('#preorderModalImg');
    const modalTitle = qs('#preorderModalTitle');
    const confirmBtn = qs('#preorderModalConfirm');
    const cancelBtn = qs('#preorderModalCancel');
    const closeBtn = qs('#preorderModalClose');
    const sizeInputs = qsa('input[name="preorderSize"]', modal || undefined);

    console.log('[hb debug] initPreorderModal: DOM elements selection:', {
      overlay: !!overlay,
      modal: !!modal,
      modalImg: !!modalImg,
      modalTitle: !!modalTitle,
      confirmBtn: !!confirmBtn,
      cancelBtn: !!cancelBtn,
      closeBtn: !!closeBtn,
      sizeInputs: sizeInputs.length
    });

    if (!overlay || !modal || !confirmBtn) {
      console.error('[hb debug] initPreorderModal: Critical elements missing. Aborting initialization.');
      return;
    }

    let activeItem = null;

    function setActiveItem(item) {
      activeItem = item || null;
      if (modal) {
        modal._hbActiveItem = activeItem;
      }
    }

    function getActiveItem() {
      if (modal && modal._hbActiveItem) {
        return modal._hbActiveItem;
      }
      return activeItem;
    }

    function resetModal(options = {}) {
      const { preserveActive = false } = options;
      console.log('[hb debug] resetModal: Resetting modal state.', { preserveActive });
      if (!preserveActive) {
        setActiveItem(null);
      }
      confirmBtn.disabled = true;
      sizeInputs.forEach((input) => {
        input.checked = false;
      });
    }

    const preorderButtons = qsa('.menu-item a[href="#preorder"]');
    console.log(`[hb debug] initPreorderModal: Found ${preorderButtons.length} preorder buttons.`);

    preorderButtons.forEach((button, index) => {
      if (button.dataset.hbPreorderBound) {
        console.log(`[hb debug] initPreorderModal: Button ${index} already bound.`);
        return;
      }
      button.dataset.hbPreorderBound = 'true';
      console.log(`[hb debug] initPreorderModal: Binding click event to preorder button ${index}.`);
      registerProductAsset(button.closest('.menu-item'));

      button.addEventListener('click', (event) => {
        event.preventDefault();
        console.log(`[hb debug] Preorder button ${index} clicked.`);
        const menuItem = button.closest('.menu-item');
        if (!menuItem) {
          console.error('[hb debug] Click handler: Could not find parent .menu-item.');
          return;
        }
        setActiveItem(menuItem);
        console.log('[hb debug] Click handler: Active item set.', getActiveItem());

        const titleEn = menuItem.getAttribute('data-title') || '';
        const imageSrc = menuItem.getAttribute('data-img') || '';
        console.log(`[hb debug] Click handler: Extracted data: title='${titleEn}', image='${imageSrc}'`);

        if (modalImg) {
          modalImg.src = imageSrc;
        }
        if (modalTitle) {
          modalTitle.textContent = titleEn; // Simplified for debugging
        }

        resetModal({ preserveActive: true });
        overlay.style.display = 'block';
        modal.style.display = 'flex';
        console.log('[hb debug] Click handler: Modal displayed.');

        if (overlay._hbEscapeHandler) {
          window.removeEventListener('keyup', overlay._hbEscapeHandler);
        }
        const escapeHandler = (event) => {
          if (event.key === 'Escape') {
            hideModal();
          }
        };
        overlay._hbEscapeHandler = escapeHandler;
        window.addEventListener('keyup', escapeHandler);
        updateModalThemes();
      });
    });

    console.log(`[hb debug] initPreorderModal: Found ${sizeInputs.length} size inputs.`);
    sizeInputs.forEach((input, index) => {
      if (input.dataset.hbBound) {
        console.log(`[hb debug] initPreorderModal: Size input ${index} already bound.`);
        return;
      }
      input.dataset.hbBound = 'true';
      console.log(`[hb debug] initPreorderModal: Binding change event to size input ${index}.`);
      input.addEventListener('change', () => {
        const isAnyChecked = sizeInputs.some((radio) => radio.checked);
        console.log(`[hb debug] Size input change: Any size checked? ${isAnyChecked}`);
        confirmBtn.disabled = !isAnyChecked;
        console.log(`[hb debug] Size input change: Confirm button disabled state: ${confirmBtn.disabled}`);
      });
    });

    if (confirmBtn.dataset.hbBound) {
      console.log('[hb debug] initPreorderModal: Confirm button already bound.');
      return;
    }
    confirmBtn.dataset.hbBound = 'true';
    console.log('[hb debug] initPreorderModal: Binding click event to confirm button.');
    confirmBtn.addEventListener('click', () => {
      console.log('[hb debug] Confirm button clicked.');
      const selected = sizeInputs.find((radio) => radio.checked);
      const currentItem = getActiveItem();
      if (!selected || !currentItem) {
        console.error('[hb debug] Confirm click: Missing selected size or active item.', {
          hasSelected: !!selected,
          hasActiveItem: !!currentItem
        });
        return;
      }

      const productTitle = currentItem.getAttribute('data-title') || '';
      const productTitleHi = currentItem.getAttribute('data-title-hi') || '';
      const productImg = currentItem.getAttribute('data-img') || '';
      const payload = {
        product: productTitle,
        productHi: productTitleHi,
        size: selected.value,
        img: productImg,
      };

      console.log('[hb debug] Confirm click: Created payload:', payload);

      try {
        storage.setItem(PREFILL_KEY, JSON.stringify(payload));
        console.log('[hb debug] Confirm click: Payload saved to localStorage.');
      } catch (error) {
        console.error('[hb debug] Confirm click: Error saving to localStorage.', error);
      }

      const params = new URLSearchParams();
      if (productTitle) params.set('product', productTitle);
      if (productTitleHi) params.set('productHi', productTitleHi);
      if (selected.value) params.set('size', selected.value);
      const targetUrl = `preorder.html?${params.toString()}`;
      console.log(`[hb debug] Confirm click: Generated target URL: ${targetUrl}`);

      hideModal();

      if (window.HBRouter && typeof window.HBRouter.navigate === 'function') {
        console.log('[hb debug] Confirm click: Navigating via HBRouter.');
        window.HBRouter.navigate(targetUrl);
      } else {
        console.log('[hb debug] Confirm click: Navigating via window.location.href.');
        window.location.href = targetUrl;
      }
    });

    function hideModal() {
      console.log('[hb debug] hideModal: Hiding modal.');
      if (overlay && overlay._hbEscapeHandler) {
        window.removeEventListener('keyup', overlay._hbEscapeHandler);
        delete overlay._hbEscapeHandler;
      }
      if(overlay) overlay.style.display = 'none';
      if(modal) modal.style.display = 'none';
      resetModal();
    }

    if (cancelBtn && !cancelBtn.dataset.hbBound) {
      cancelBtn.dataset.hbBound = 'true';
      cancelBtn.addEventListener('click', hideModal);
    }
    if (closeBtn && !closeBtn.dataset.hbBound) {
      closeBtn.dataset.hbBound = 'true';
      closeBtn.addEventListener('click', hideModal);
    }

    if (overlay && !overlay.dataset.hbBound) {
      overlay.dataset.hbBound = 'true';
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          hideModal();
        }
      });
    }
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
    const initialProductHi = params.get('productHi') || (seed && seed.productHi) || '';
    const initialSize = params.get('size') || (seed && seed.size) || '';

    const normalizeForMatch = (value) => (value || '')
      .toString()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/—/g, '-')
      .toLowerCase();

    const findMatchingOption = (selectEl, candidates) => {
      if (!selectEl) return null;
      const normalizedCandidates = candidates
        .filter((candidate) => candidate && candidate.toString().trim().length)
        .map((candidate) => normalizeForMatch(candidate));
      if (!normalizedCandidates.length) return null;
      const options = qsa('option', selectEl).filter((option) => option.value.trim().length);
      return options.find((option) => {
        const valuesToCheck = [
          option.value,
          option.textContent,
          option.getAttribute('data-en'),
          option.getAttribute('data-hi'),
        ]
          .filter((value) => value != null)
          .map((value) => normalizeForMatch(value));
        return normalizedCandidates.some((candidate) => valuesToCheck.includes(candidate));
      }) || null;
    };

    let resolvedProduct = initialProduct || initialProductHi;
    const matchedProductOption = findMatchingOption(productSelect, [
      initialProduct,
      initialProductHi,
      seed && seed.product,
      seed && seed.productHi,
    ]);
    if (productSelect && matchedProductOption) {
      productSelect.value = matchedProductOption.value;
      resolvedProduct = matchedProductOption.value;
      productSelect.dataset.hbPrefilled = 'true';
    }

    const matchedSizeOption = findMatchingOption(sizeSelect, [
      initialSize,
      seed && seed.size,
    ]);
    if (sizeSelect && matchedSizeOption) {
      sizeSelect.value = matchedSizeOption.value;
      sizeSelect.dataset.hbPrefilled = 'true';
    }

    const productForImage = (productSelect && productSelect.value)
      || resolvedProduct
      || (seed && seed.product)
      || initialProduct
      || initialProductHi;
    updateReservationImage(reservationImg, productForImage);

    if ((matchedProductOption || matchedSizeOption) && !preorderSection.classList.contains('hb-prefilled')) {
      preorderSection.classList.add('hb-prefilled');
    }

    if (productSelect && !productSelect.dataset.hbBound) {
      productSelect.dataset.hbBound = 'true';
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
      const phone = '919930815228';
      const text = `Hello Himalayan Blossom, my name is ${name}.\nEmail: ${email}\nSubject: ${subject}\nMessage: ${message}`;
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    };
  }

  function initGlobals() {
    if (globalsInitialized) return;
    initLanguageToggle();
    initThemeToggle();
    initMobileNav();
    globalsInitialized = true;
  }

  function refreshPageFeatures() {
    collectProductAssets();
    updateLanguage(state.language);
    applyTheme(state.theme);
    initProductModal();
    initPreorderModal();
    initPreorderForm();
    initContactForm();
  }

  function init() {
    initGlobals();
    refreshPageFeatures();
  }

  HBSite.refreshPage = refreshPageFeatures;
  document.addEventListener('hb:spa:pagechange', refreshPageFeatures);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
