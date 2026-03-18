(function () {
    'use strict';

    const CART_PRICE_SCALE = 100;

    function showPaymentError(button, originalText, msg) {
        // Replace bare alert() with a styled inline message (Fix 10)
        const errorBanner = document.getElementById('cartPaymentError');
        if (errorBanner) {
            errorBanner.textContent = msg;
            errorBanner.classList.remove('d-none');
            errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => errorBanner.classList.add('d-none'), 8000);
        } else {
            alert(msg);
        }
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    function initCheckout() {
        const payButton = document.getElementById('paySecurelyBtn');
        if (!payButton) return;

        payButton.addEventListener('click', handlePaymentClick);
    }

    async function handlePaymentClick(e) {
        e.preventDefault();
        const button = e.currentTarget;
        const originalText = button.textContent || 'Pay Securely';

        // Fix 3: If no address saved yet, redirect to address page first
        const params = new URLSearchParams(window.location.search);
        const skipAddressStep = params.get('step') === 'pay';

        if (!skipAddressStep) {
            // Check if an address has been saved in sessionStorage
            const savedAddress = sessionStorage.getItem('hb_checkout_address');
            if (!savedAddress) {
                // No address yet — send to address collection page
                window.location.href = 'checkout-address.html';
                return;
            }
        }

        // Auth gate
        if (!window.Auth || !window.Auth.isAuthenticated()) {
            if (window.Auth && typeof window.Auth.signIn === 'function') {
                window.Auth.signIn({ redirectTo: window.location.href }).catch(() => {
                    const loginUrl = new URL('login.html', window.location.origin);
                    loginUrl.searchParams.set('redirect', window.location.href);
                    window.location.assign(`${loginUrl.pathname}${loginUrl.search}`);
                });
            } else {
                const loginUrl = new URL('login.html', window.location.origin);
                loginUrl.searchParams.set('redirect', window.location.href);
                window.location.assign(`${loginUrl.pathname}${loginUrl.search}`);
            }
            return;
        }

        try {
            button.disabled = true;
            button.textContent = 'Processing…';

            // Snapshot cart items to sessionStorage before payment (Fix 4)
            if (window.HBCart && typeof window.HBCart.getState === 'function') {
                const cartState = window.HBCart.getState();
                const items = (cartState && cartState.items) || [];
                const snapshotItems = items.map((item) => ({
                    name: item.product || item.productHi || '',
                    size: item.size || '',
                    quantity: item.quantity || 1,
                    priceSnapshot: item.pricePaise || 0,
                    image: item.image || '',
                    pricePaise: item.pricePaise || 0,
                }));
                try {
                    sessionStorage.setItem('hb_last_order_items', JSON.stringify(snapshotItems));
                } catch (err) { /* ignore */ }
            }

            // Read address for Razorpay prefill
            let address = {};
            try {
                address = JSON.parse(sessionStorage.getItem('hb_checkout_address') || '{}');
            } catch (err) { /* ignore */ }

            // 1. Create Order
            const orderResponse = await window.Auth.apiFetch('/api/create-order', {
                method: 'POST',
            });

            if (!orderResponse || !orderResponse.id) {
                throw new Error('Failed to create order. Please try again.');
            }

            const { id: order_id, amount, currency, key } = orderResponse;
            const user = window.Auth.getUser();

            // 2. Open Razorpay with address prefill (Fix 9 — phone from address)
            const options = {
                key: key,
                amount: amount,
                currency: currency,
                name: 'Himalayan Blossom',
                description: 'Premium Himalayan Honey',
                image: 'https://cdn.razorpay.com/logos/GhRQcyean79PqE_medium.png',
                order_id: order_id,
                handler: async function (response) {
                    await verifyPayment(response, button, originalText, order_id);
                },
                prefill: {
                    name: address.fullName || (user ? user.displayName : ''),
                    email: user ? user.email : '',
                    contact: address.phone || '',  // Now set from address form (Fix 9)
                },
                notes: {
                    shipping_address: [
                        address.addressLine1,
                        address.addressLine2,
                        address.city,
                        address.state,
                        address.pinCode,
                    ].filter(Boolean).join(', '),
                    customer_name: address.fullName || '',
                    delivery_note: address.deliveryNote || '',
                },
                theme: {
                    color: '#B8860B',
                },
                modal: {
                    ondismiss: function () {
                        button.disabled = false;
                        button.textContent = originalText;
                    },
                },
            };

            const rzp1 = new Razorpay(options);

            rzp1.on('payment.failed', function (response) {
                const errMsg = (response.error && response.error.description)
                    ? response.error.description
                    : 'Payment failed. Please try again or use a different payment method.';
                showPaymentError(button, originalText, errMsg);
            });

            // Safety timeout in case modal doesn't appear
            setTimeout(() => {
                if (button.textContent === 'Processing…') {
                    button.disabled = false;
                    button.textContent = originalText;
                }
            }, 8000);

            rzp1.open();

        } catch (error) {
            console.error('[Checkout] Payment error:', error);
            const msg = error && error.message
                ? error.message
                : 'Failed to initiate payment. Please try again.';
            showPaymentError(button, originalText, msg);
        }
    }

    async function verifyPayment(paymentResponse, button, originalText, orderId) {
        try {
            button.textContent = 'Verifying…';
            const verifyResponse = await window.Auth.apiFetch('/api/verify-payment', {
                method: 'POST',
                body: paymentResponse,
            });

            if (verifyResponse && verifyResponse.success) {
                // Fix 4: Redirect to order confirmation page instead of home
                button.textContent = 'Payment Successful!';
                const params = new URLSearchParams({
                    order_id: orderId || paymentResponse.razorpay_order_id || '',
                    payment_id: paymentResponse.razorpay_payment_id || '',
                });
                window.location.href = `order-confirmation.html?${params.toString()}`;
            } else {
                throw new Error('Payment verification failed. Please contact support with your payment ID.');
            }
        } catch (error) {
            console.error('[Checkout] Verification error:', error);
            const msg = error && error.message
                ? error.message
                : 'Payment was received but verification failed. Please contact support.';
            showPaymentError(button, originalText, msg);
        }
    }

    // Load Razorpay Script dynamically if not present
    function loadRazorpayScript() {
        if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
            initCheckout();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = initCheckout;
        script.onerror = () => {
            console.error('[Checkout] Failed to load Razorpay script.');
        };
        document.head.appendChild(script);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadRazorpayScript);
    } else {
        loadRazorpayScript();
    }

    // Re-initialize on SPA navigation
    document.addEventListener('hb:spa:pagechange', () => {
        if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
            initCheckout();
        } else {
            loadRazorpayScript();
        }
    });

})();
