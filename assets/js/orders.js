(function () {
  'use strict';

  const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 });
  const CART_PRICE_SCALE = 100;
  let ordersUnsubscribe = null;

  // --- MY ORDERS TAB LOGIC ---
  function initMyOrdersPage() {
    if (document.body.dataset.pageId !== 'my-orders') return;

    const STATUS_STEPS = ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];
    const STATUS_LABELS = {
      confirmed: 'Order Placed',
      processing: 'Packing',
      shipped: 'Shipped',
      out_for_delivery: 'Out for Delivery',
      delivered: 'Delivered',
    };
    const STATUS_ICONS = {
      confirmed: 'bi-check2',
      processing: 'bi-box-seam',
      shipped: 'bi-truck',
      out_for_delivery: 'bi-geo-alt',
      delivered: 'bi-house-check',
      cancelled: 'bi-x-circle',
      default: 'bi-clock',
    };

    function getStatusBadgeClass(status) {
      const known = ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];
      return known.includes(status) ? status : 'default';
    }

    function formatDate(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      } catch (e) { return iso || '—'; }
    }

    function buildProgressBar(currentStatus) {
      const currentIndex = STATUS_STEPS.indexOf(currentStatus);
      let html = '<div class="order-progress">';
      STATUS_STEPS.forEach((step, idx) => {
        const isDone = currentIndex > idx;
        const isActive = currentIndex === idx;
        const cls = isDone ? 'done' : isActive ? 'active' : '';
        const icon = STATUS_ICONS[step] || 'bi-circle';
        html += `
          <div class="progress-step ${cls}">
            <div class="dot"><i class="bi ${icon}"></i></div>
            <span class="label">${STATUS_LABELS[step] || step}</span>
          </div>
        `;
        if (idx < STATUS_STEPS.length - 1) {
          html += `<div class="progress-line ${isDone ? 'done' : ''}"></div>`;
        }
      });
      html += '</div>';
      return html;
    }

    function buildOrderCard(order) {
      const items = Array.isArray(order.items)
        ? order.items
        : (order.items && typeof order.items === 'object' ? Object.values(order.items) : []);

      const status = order.order_status || 'confirmed';
      const badgeCls = getStatusBadgeClass(status);
      const statusLabel = STATUS_LABELS[status] || status.charAt(0).toUpperCase() + status.slice(1);

      const itemsHtml = items.slice(0, 4).map((item) => {
        const img = item.image ? `<img src="${item.image}" alt="${item.name || item.product || ''}" />` : '';
        return `
          <div class="order-item-thumb">
            ${img}
            <div class="item-details">
              <div class="name">${item.name || item.product || 'Honey'}</div>
              <div class="meta">${item.size || ''} &times; ${item.qty || item.quantity || 1}</div>
            </div>
          </div>
        `;
      }).join('');

      const extraItems = items.length > 4 ? `<div class="order-item-thumb"><div class="item-details"><div class="name">+${items.length - 4} more</div></div></div>` : '';

      const address = order.shipping_address;
      const addressHtml = address && address.city
        ? `<span class="small" style="color:color-mix(in srgb, var(--default-color) 65%, transparent)"><i class="bi bi-geo-alt me-1"></i>${[address.addressLine1, address.city, address.state, address.pinCode].filter(Boolean).join(', ')}</span>`
        : '';

      const total = order.amount
        ? formatter.format(order.amount)
        : (order.amountPaise ? formatter.format(order.amountPaise / CART_PRICE_SCALE) : '—');

      const whatsappMsg = encodeURIComponent(`Hi! I'd like to track my Himalayan Blossom order: ${order.razorpay_order_id || order.id || ''}`);
      const trackingHtml = order.tracking_number
        ? `<a href="${order.tracking_url || '#'}" target="_blank" class="btn-track"><i class="bi bi-truck"></i> Track Shipment</a>`
        : `<a href="https://wa.me/919930815228?text=${whatsappMsg}" target="_blank" class="btn-whatsapp"><i class="bi bi-whatsapp"></i> Ask for Update</a>`;

      return `
        <div class="order-card" data-aos="fade-up">
          <div class="order-card-header">
            <span class="order-id">${order.razorpay_order_id || order.id || 'N/A'}</span>
            <span class="order-date">${formatDate(order.createdAt)}</span>
            <span class="status-badge ${badgeCls}"><i class="bi ${STATUS_ICONS[status] || 'bi-clock'}"></i> ${statusLabel}</span>
            <span class="order-total">${total}</span>
          </div>
          <div class="order-card-body">
            <div class="order-items-row">${itemsHtml}${extraItems}</div>
            ${addressHtml}
            ${buildProgressBar(status)}
          </div>
          <div class="order-card-footer">
            ${trackingHtml}
            <a href="order-confirmation.html?order_id=${encodeURIComponent(order.razorpay_order_id || '')}&payment_id=${encodeURIComponent(order.razorpay_payment_id || '')}" class="btn-track" style="background:transparent;border:1.5px solid var(--accent-color);color:var(--heading-color)">
              <i class="bi bi-receipt"></i> View Receipt
            </a>
          </div>
        </div>
      `;
    }

    function renderOrders(orders) {
      const listEl = document.getElementById('ordersList');
      const emptyEl = document.getElementById('ordersEmpty');
      const loadingEl = document.getElementById('ordersLoading');

      if (loadingEl) loadingEl.classList.add('d-none');

      if (!orders || orders.length === 0) {
        if (emptyEl) emptyEl.classList.remove('d-none');
        return;
      }

      if (emptyEl) emptyEl.classList.add('d-none');
      if (listEl) {
        listEl.innerHTML = orders.map(buildOrderCard).join('');
        // Re-trigger AOS for dynamically injected cards
        if (window.AOS) window.AOS.refresh();
      }
    }

    async function loadOrders(uid) {
      if (!window.Auth || typeof window.Auth.ensureFirebaseReady !== 'function') {
        renderOrders([]);
        return;
      }

      try {
        const { firestore } = await window.Auth.ensureFirebaseReady();
        if (!firestore) {
          renderOrders([]);
          return;
        }

        if (ordersUnsubscribe) {
          ordersUnsubscribe();
          ordersUnsubscribe = null;
        }

        ordersUnsubscribe = firestore
          .collection('users')
          .doc(uid)
          .collection('orders')
          .orderBy('createdAt', 'desc')
          .limit(50)
          .onSnapshot(
            (snap) => {
              const orders = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
              renderOrders(orders);
            },
            (err) => {
              console.error('[MyOrders] Failed to sync orders:', err);
              renderOrders([]);
            }
          );
      } catch (err) {
        console.error('[MyOrders] Failed to init order sync:', err);
        renderOrders([]);
      }
    }

    const signInPrompt = document.getElementById('ordersSignInPrompt');
    const ordersContent = document.getElementById('ordersContent');

    function onAuth(uid) {
      if (signInPrompt) signInPrompt.classList.add('d-none');
      if (ordersContent) ordersContent.classList.remove('d-none');
      loadOrders(uid);
    }

    function onGuest() {
      if (signInPrompt) signInPrompt.classList.remove('d-none');
      if (ordersContent) ordersContent.classList.add('d-none');
      if (ordersUnsubscribe) {
        ordersUnsubscribe();
        ordersUnsubscribe = null;
      }
    }

    // Check current auth state
    const authReady = () => {
      if (window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated()) {
        const user = window.Auth.getUser ? window.Auth.getUser() : null;
        if (user && user.uid) onAuth(user.uid);
        else onGuest();
      } else {
        onGuest();
      }
    };

    window.addEventListener('hb:auth:signed-in', (e) => {
      if (document.body.dataset.pageId !== 'my-orders') return;
      const user = e && e.detail && e.detail.user;
      if (user && user.uid) onAuth(user.uid);
    });

    window.addEventListener('hb:auth:signed-out', () => {
      if (document.body.dataset.pageId === 'my-orders') onGuest();
    });

    // Sign in button
    const signInBtn = document.getElementById('ordersSignInBtn');
    if (signInBtn && !signInBtn.dataset.hbBound) {
      signInBtn.dataset.hbBound = 'true';
      signInBtn.addEventListener('click', () => {
        if (window.Auth && typeof window.Auth.signIn === 'function') {
          window.Auth.signIn({ redirectTo: window.location.href }).catch(() => {
            const url = new URL('login.html', window.location.origin);
            url.searchParams.set('redirect', window.location.href);
            window.location.assign(url.pathname + url.search);
          });
        } else {
          const url = new URL('login.html', window.location.origin);
          url.searchParams.set('redirect', window.location.href);
          window.location.assign(url.pathname + url.search);
        }
      });
    }

    // Auth may already be resolved
    if (window.Auth && typeof window.Auth.isAuthenticated === 'function') {
      authReady();
    } else {
      window.addEventListener('hb:auth:ready', authReady, { once: true });
      setTimeout(authReady, 2500);
    }
  }


  // --- ORDER CONFIRMATION TAB LOGIC ---
  function initOrderConfirmationPage() {
    if (document.body.dataset.pageId !== 'order-confirmation') return;

    const CONFETTI_COLORS = ['#D4AF37', '#28a745', '#f5a623', '#c0392b', '#3498db', '#9b59b6'];

    function launchConfetti() {
      const count = 60;
      for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'confetti-particle';
        particle.style.left = Math.random() * 100 + 'vw';
        particle.style.top = '-20px';
        particle.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        particle.style.width = (Math.random() * 8 + 5) + 'px';
        particle.style.height = (Math.random() * 8 + 5) + 'px';
        particle.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        particle.style.animationDuration = (Math.random() * 2.5 + 2) + 's';
        particle.style.animationDelay = (Math.random() * 1.5) + 's';
        document.body.appendChild(particle);
        setTimeout(() => particle.remove(), 5000);
      }
    }

    function showSection(id) {
      ['confirmationLoading', 'confirmationContent', 'confirmationNotFound'].forEach((sId) => {
        const el = document.getElementById(sId);
        if (el) el.style.display = sId === id ? 'block' : 'none';
      });
    }

    function copyText(text) {
      try {
        navigator.clipboard.writeText(text);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    }

    function renderAddress(address) {
      const container = document.getElementById('confirmationAddress');
      if (!container) return;
      if (!address || !address.fullName) {
        container.innerHTML = '<p class="text-muted small">Address not available</p>';
        return;
      }
      const parts = [
        address.addressLine1,
        address.addressLine2,
        address.landmark,
        [address.city, address.pinCode].filter(Boolean).join(' — '),
        address.state,
      ].filter(Boolean);
      container.innerHTML = `
        <div class="address-block">
          <div class="name">${address.fullName}</div>
          <div class="phone"><i class="bi bi-telephone me-1"></i>${address.phone || '—'}</div>
          <div class="addr">${parts.join(', ')}</div>
        </div>
      `;
    }

    function renderItems(items) {
      const container = document.getElementById('confirmationItems');
      const totalEl = document.getElementById('confirmationTotal');
      if (!container) return;

      if (!items || !items.length) {
        container.innerHTML = '<p class="text-muted small">No items found.</p>';
        return;
      }

      let totalPaise = 0;
      container.innerHTML = '';
      items.forEach((item) => {
        const pricePaise = Number(item.priceSnapshot || item.pricePaise || 0);
        const qty = Number(item.qty || item.quantity || 1);
        const linePaise = pricePaise * qty;
        totalPaise += linePaise;

        const div = document.createElement('div');
        div.className = 'order-item';
        div.innerHTML = `
          ${item.image ? `<img src="${item.image}" alt="${item.name || item.product || ''}" />` : ''}
          <div class="item-info">
            <div class="item-name">${item.name || item.product || 'Honey'}</div>
            <div class="item-meta">${item.size || ''} &times; ${qty}</div>
          </div>
          <div class="item-price">${formatter.format(linePaise / CART_PRICE_SCALE)}</div>
        `;
        container.appendChild(div);
      });

      if (totalEl) totalEl.textContent = formatter.format(totalPaise / CART_PRICE_SCALE);
    }

    function loadOrderFromURL() {
      const params = new URLSearchParams(window.location.search);
      const orderId = params.get('order_id') || params.get('razorpay_order_id');
      const paymentId = params.get('payment_id') || params.get('razorpay_payment_id');

      let address = null;
      try { address = JSON.parse(sessionStorage.getItem('hb_checkout_address') || 'null'); } catch (e) { /* ignore */ }

      let items = null;
      try { items = JSON.parse(sessionStorage.getItem('hb_last_order_items') || 'null'); } catch (e) { /* ignore */ }

      if (orderId) {
        const el = document.getElementById('displayOrderId');
        if (el) el.textContent = orderId;
        const copyBtn = document.getElementById('copyOrderIdBtn');
        if (copyBtn && !copyBtn.dataset.hbBound) {
          copyBtn.dataset.hbBound = 'true';
          copyBtn.addEventListener('click', () => {
            copyText(orderId);
            copyBtn.innerHTML = '<i class="bi bi-clipboard-check"></i>';
            setTimeout(() => { copyBtn.innerHTML = '<i class="bi bi-clipboard"></i>'; }, 2000);
          });
        }
      }

      if (paymentId) {
        const el = document.getElementById('paymentId');
        if (el) el.textContent = paymentId;
      }

      const dateEl = document.getElementById('orderDate');
      if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('en-IN', {
          day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
      }

      renderAddress(address);
      renderItems(items);
      showSection('confirmationContent');
      // Prevent multiple confetti launches on SPA navigation
      if (!window.hb_confetti_launched) {
        launchConfetti();
        window.hb_confetti_launched = true;
      }

      sessionStorage.removeItem('hb_checkout_address');
      sessionStorage.removeItem('hb_last_order_items');

      if (!orderId && !paymentId) {
        showSection('confirmationNotFound');
      }
    }

    function tryLoadFromFirestore(uid) {
      if (!window.Auth || typeof window.Auth.ensureFirebaseReady !== 'function') return;

      const searchParams = new URLSearchParams(window.location.search);
      const urlOrderId = searchParams.get('order_id') || searchParams.get('razorpay_order_id');

      window.Auth.ensureFirebaseReady()
        .then(({ firestore }) => {
          if (!firestore) return;

          let query = firestore.collection('users').doc(uid).collection('orders');

          if (urlOrderId) {
            query = query.doc(urlOrderId).get().then(doc => {
              if (!doc.exists) return { empty: true };
              return { empty: false, docs: [doc] };
            });
          } else {
            query = query.orderBy('createdAt', 'desc').limit(1).get();
          }

          return query.then((snap) => {
            if (snap.empty) return;
            const doc = snap.docs[0];
            const data = doc.data();

            if (data.items) renderItems(Object.values(data.items));
            if (data.shipping_address) renderAddress(data.shipping_address);

            const totalEl = document.getElementById('confirmationTotal');
            if (totalEl && data.amount) totalEl.textContent = formatter.format(data.amount);

            const payIdEl = document.getElementById('paymentId');
            if (payIdEl && data.razorpay_payment_id) payIdEl.textContent = data.razorpay_payment_id;
            
            showSection('confirmationContent');
          });
        })
        .catch((err) => console.warn('[Confirmation] Could not load from Firestore', err));
    }

    showSection('confirmationLoading');

    const params = new URLSearchParams(window.location.search);
    const hasOrderParams = params.get('order_id') || params.get('razorpay_order_id') ||
                           params.get('payment_id') || params.get('razorpay_payment_id') ||
                           params.get('payment') === 'success';

    if (!hasOrderParams) {
      showSection('confirmationNotFound');
      return;
    }

    loadOrderFromURL();

    const checkFirebaseOrder = () => {
      if (window.Auth && typeof window.Auth.isAuthenticated === 'function' && window.Auth.isAuthenticated()) {
        const user = window.Auth.getUser ? window.Auth.getUser() : null;
        if (user && user.uid) tryLoadFromFirestore(user.uid);
      }
    };

    if (window.Auth && typeof window.Auth.isAuthenticated === 'function') {
      checkFirebaseOrder();
    } else {
      window.addEventListener('hb:auth:ready', checkFirebaseOrder, { once: true });
    }

    window.addEventListener('hb:auth:signed-in', (e) => {
      if (document.body.dataset.pageId !== 'order-confirmation') return;
      const user = e && e.detail && e.detail.user;
      if (user && user.uid) tryLoadFromFirestore(user.uid);
    });
  }

  function initPages() {
    initMyOrdersPage();
    initOrderConfirmationPage();
  }

  // --- GLOBAL EVENT BINDING ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPages);
  } else {
    initPages();
  }

  document.addEventListener('hb:spa:pagechange', initPages);

})();
