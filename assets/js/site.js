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
    'Sarson Tejas — Mustard Honey': { img: 'assets/img/menu/menu-item-8.png' }
  };

  const DEFAULT_PRICING = {
    '250 gram': 1199,
    '500 gram': 1999,
    '1000 gram': 3499,
  };

  const state = {
    language: storage.getItem('language') || 'en',
    theme: storage.getItem('theme') || 'light',
    productAssets: { ...DEFAULT_PRODUCT_ASSETS },
  };

  const HBCart = createCartManager();
  HBSite.cart = HBCart;
  window.HBCart = HBCart;

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

  function createCartManager() {
    async function ensureAuthenticated() {
      if (window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated()) {
        return window.Auth.getUser();
      }
      if (window.Auth && typeof window.Auth.signIn === 'function') {
        await window.Auth.signIn();
        if (window.Auth.isAuthenticated()) {
          return window.Auth.getUser();
        }
      }
      throw new Error('Please sign in to continue.');
    }

    async function addItem(rawItem, options) {
      const user = await ensureAuthenticated();
      const item = normalizeCartItem(rawItem);
      const token = window.Auth && typeof window.Auth.getIdToken === 'function'
        ? await window.Auth.getIdToken()
        : null;

      const payload = {
        action: (options && options.action) || 'add',
        item,
      };

      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const response = await fetch('/api/cart', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = 'Failed to update cart.';
        try {
          const data = await response.clone().json();
          if (data && typeof data.error === 'string') {
            message = data.error;
          } else if (data && typeof data.message === 'string') {
            message = data.message;
          }
        } catch (error) {
          try {
            const text = await response.clone().text();
            if (text) {
              message = text;
            }
          } catch (innerError) {
            /* ignore */
          }
        }
        throw new Error(message);
      }

      let result = null;
      try {
        result = await response.json();
      } catch (error) {
        result = null;
      }

      window.dispatchEvent(
        new CustomEvent('hb:cart:added', {
          detail: {
            user,
            item,
            response: result,
          },
        })
      );

      return result;
    }

    return {
      addItem,
    };
  }

  function normalizeCartItem(item) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid cart item.');
    }

    const name = (item.product || item.productName || item.name || '').toString().trim();
    const size = (item.size || '').toString().trim();
    const quantityNumber = Number(item.quantity);
    const quantity = Number.isFinite(quantityNumber) && quantityNumber > 0 ? Math.floor(quantityNumber) : 1;
    const fallbackId = name ? slugify(`${name}-${size || 'default'}`) : `product-${Date.now()}`;
    const priceValue = Number(item.price);

    return {
      productId: item.productId || fallbackId,
      product: name,
      size,
      quantity,
      price: Number.isFinite(priceValue) && priceValue > 0 ? priceValue : null,
      image: item.img || item.image || '',
      notes: item.notes || '',
      language: item.language || state.language,
      addedAt: item.addedAt || new Date().toISOString(),
      metadata: item.metadata || null,
    };
  }

  function slugify(value) {
    return value
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  function resolvePriceForSize(size) {
    if (!size) return null;
    const pricingConfig = typeof window.APP_PREORDER_PRICING === 'object' ? window.APP_PREORDER_PRICING : {};
    const direct = pricingConfig[size];
    if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) {
      return direct;
    }
    const normalized = pricingConfig[size] && typeof pricingConfig[size] === 'object'
      ? pricingConfig[size]
      : null;
    if (normalized && typeof normalized[size] === 'number') {
      return normalized[size];
    }
    const fallback = DEFAULT_PRICING[size];
    return typeof fallback === 'number' ? fallback : null;
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
    if (lang === 'en' || lang === 'hi') {
      document.documentElement.setAttribute('lang', lang);
    }

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
    const { overlay, modal } = ensurePreorderModalStructure();
    const modalImg = qs('#preorderModalImg');
    const modalTitle = qs('#preorderModalTitle');
    const confirmBtn = qs('#preorderModalConfirm');
    const cancelBtn = qs('#preorderModalCancel');
    const closeBtn = qs('#preorderModalClose');
    const sizeInputs = qsa('input[name="preorderSize"]', modal || undefined);

    if (!overlay || !modal || !confirmBtn) {
      return;
    }

    let activeItem = modal ? modal._hbActiveItem || null : null;

    const setActiveItem = (item) => {
      activeItem = item || null;
      if (modal) {
        modal._hbActiveItem = activeItem;
      }
    };

    const getActiveItem = () => {
      if (modal && modal._hbActiveItem) {
        return modal._hbActiveItem;
      }
      return activeItem;
    };

    const resetModal = ({ preserveActive = false } = {}) => {
      if (!preserveActive) {
        setActiveItem(null);
      }
      confirmBtn.disabled = true;
      sizeInputs.forEach((input) => {
        input.checked = false;
      });
    };

    function hideModal() {
      if (overlay && overlay._hbEscapeHandler) {
        window.removeEventListener('keyup', overlay._hbEscapeHandler);
        delete overlay._hbEscapeHandler;
      }
      if (overlay) overlay.style.display = 'none';
      if (modal) modal.style.display = 'none';
      resetModal();
    }

    const ensureEscapeHandler = () => {
      if (overlay._hbEscapeHandler) {
        window.removeEventListener('keyup', overlay._hbEscapeHandler);
      }
      overlay._hbEscapeHandler = (event) => {
        if (event.key === 'Escape') {
          hideModal();
        }
      };
      window.addEventListener('keyup', overlay._hbEscapeHandler);
    };

    resetModal();

    const preorderButtons = qsa('.menu-item a[href="#preorder"]');

    preorderButtons.forEach((button) => {
      if (button.dataset.hbPreorderBound) {
        return;
      }
      button.dataset.hbPreorderBound = 'true';
      registerProductAsset(button.closest('.menu-item'));

      button.addEventListener('click', (event) => {
        event.preventDefault();
        const menuItem = button.closest('.menu-item');
        if (!menuItem) {
          return;
        }
        setActiveItem(menuItem);

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

        resetModal({ preserveActive: true });
        overlay.style.display = 'block';
        modal.style.display = 'flex';
        ensureEscapeHandler();
        updateModalThemes();
      });
    });

    sizeInputs.forEach((input) => {
      if (input.dataset.hbBound) {
        return;
      }
      input.dataset.hbBound = 'true';
      input.addEventListener('change', () => {
        const isAnyChecked = sizeInputs.some((radio) => radio.checked);
        confirmBtn.disabled = !isAnyChecked;
      });
    });

    if (!confirmBtn.dataset.hbBound) {
      confirmBtn.dataset.hbBound = 'true';
      confirmBtn.addEventListener('click', async () => {
        const selected = sizeInputs.find((radio) => radio.checked);
        const currentItem = getActiveItem();
        if (!selected || !currentItem) {
          return;
        }

        const productTitle = currentItem.getAttribute('data-title') || '';
        const productTitleHi = currentItem.getAttribute('data-title-hi') || '';
        const productImg = currentItem.getAttribute('data-img') || '';
        const cartItem = {
          productId: currentItem.getAttribute('data-product-id') || slugify(`${productTitle}-${selected.value}`),
          product: productTitle,
          productHi: productTitleHi,
          size: selected.value,
          quantity: 1,
          img: productImg,
          price: resolvePriceForSize(selected.value),
          language: state.language,
        };
        const payload = {
          product: productTitle,
          productHi: productTitleHi,
          size: selected.value,
          img: productImg,
        };

        try {
          storage.setItem(PREFILL_KEY, JSON.stringify(payload));
        } catch (error) {
          /* ignore storage persistence errors */
        }

        const params = new URLSearchParams();
        if (productTitle) params.set('product', productTitle);
        if (productTitleHi) params.set('productHi', productTitleHi);
        if (selected.value) params.set('size', selected.value);
        const targetUrl = `preorder.html?${params.toString()}`;

        const originalEn = confirmBtn.getAttribute('data-en') || confirmBtn.textContent;
        const originalHi = confirmBtn.getAttribute('data-hi') || originalEn;
        const loadingText = state.language === 'hi' ? 'कार्ट में जोड़ रहा है...' : 'Adding to cart...';

        confirmBtn.setAttribute('data-en', loadingText);
        confirmBtn.setAttribute('data-hi', loadingText);
        confirmBtn.textContent = loadingText;
        confirmBtn.disabled = true;

        try {
          if (HBCart && typeof HBCart.addItem === 'function') {
            await HBCart.addItem(cartItem);
          }
          hideModal();
          if (window.HBRouter && typeof window.HBRouter.navigate === 'function') {
            window.HBRouter.navigate(targetUrl);
          } else {
            window.location.href = targetUrl;
          }
        } catch (error) {
          console.error('Failed to add item to cart', error);
          window.dispatchEvent(
            new CustomEvent('hb:cart:error', {
              detail: {
                error: error && error.message ? error.message : 'Unable to add item to cart.',
                item: cartItem,
              },
            })
          );
          window.alert(error && error.message ? error.message : 'Unable to add item to cart.');
        } finally {
          confirmBtn.setAttribute('data-en', originalEn);
          confirmBtn.setAttribute('data-hi', originalHi);
          confirmBtn.textContent = state.language === 'hi' ? originalHi : originalEn;
          confirmBtn.disabled = false;
        }
      });
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

  function initGlobals(options) {
    const force = Boolean(options && options.force);
    if (globalsInitialized && !force) {
      return;
    }
    initLanguageToggle();
    initThemeToggle();
    initMobileNav();
    globalsInitialized = true;
  }

  function refreshPageFeatures() {
    collectProductAssets();
    updateLanguage(state.language);
    applyTheme(state.theme);
    if (window.HBLayout && typeof window.HBLayout.refresh === 'function') {
      window.HBLayout.refresh();
    }
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
  window.addEventListener('hb:layout:ready', () => {
    initGlobals({ force: true });
    refreshPageFeatures();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
