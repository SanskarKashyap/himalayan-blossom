(function () {
    'use strict';

    function initCheckout() {
        const payButton = document.getElementById('paySecurelyBtn');
        if (!payButton) return;

        payButton.addEventListener('click', handlePaymentClick);
    }

    async function handlePaymentClick(e) {
        e.preventDefault();
        const button = e.currentTarget;
        const originalText = button.textContent;

        // Check Auth
        if (!window.Auth || !window.Auth.isAuthenticated()) {
            alert('Please sign in to proceed with payment.');
            window.Auth.signIn();
            return;
        }

        try {
            button.disabled = true;
            button.textContent = 'Processing...';

            // 1. Create Order
            const orderResponse = await window.Auth.apiFetch('/api/create-order', {
                method: 'POST',
            });

            if (!orderResponse || !orderResponse.id) {
                throw new Error('Failed to create order');
            }

            const { id: order_id, amount, currency, key } = orderResponse;
            const user = window.Auth.getUser();

            // 2. Open Razorpay
            const options = {
                key: key,
                amount: amount,
                currency: currency,
                name: 'Himalayan Blossom',
                description: 'Premium Honey Order',
                // Use a secure placeholder or absolute URL to avoid CORS/Mixed Content issues on localhost
                // image: 'assets/img/logo.png', 
                image: 'https://cdn.razorpay.com/logos/GhRQcyean79PqE_medium.png',
                order_id: order_id,
                handler: async function (response) {
                    await verifyPayment(response, button, originalText);
                },
                prefill: {
                    name: user ? user.displayName : '',
                    email: user ? user.email : '',
                    contact: '' // Could ask user for this?
                },
                theme: {
                    color: '#B8860B' // Gold-ish color matching theme
                },
                modal: {
                    ondismiss: function () {
                        // User closed the modal manually
                        button.disabled = false;
                        button.textContent = originalText;
                    }
                }
            };

            const rzp1 = new Razorpay(options);

            // Safety timeout: Re-enable button after 5 seconds if modal doesn't appear
            // (e.g. if blocked by popup blocker or mixed content error)
            setTimeout(() => {
                if (button.textContent === 'Processing...') {
                    button.disabled = false;
                    button.textContent = originalText;
                }
            }, 5000);

            rzp1.open();

        } catch (error) {
            console.error('Payment Error:', error);
            alert('Failed to initiate payment. Please try again.');
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    async function verifyPayment(paymentResponse, button, originalText) {
        try {
            button.textContent = 'Verifying...';
            const verifyResponse = await window.Auth.apiFetch('/api/verify-payment', {
                method: 'POST',
                body: paymentResponse
            });

            if (verifyResponse && verifyResponse.success) {
                // Success!
                button.textContent = 'Payment Successful!';
                window.location.href = 'index.html?payment=success'; // Redirect to home or order page
            } else {
                throw new Error('Verification failed');
            }
        } catch (error) {
            console.error('Verification Error:', error);
            alert('Payment successful but verification failed. Please contact support.');
            button.disabled = false;
            button.textContent = originalText;
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
        document.head.appendChild(script);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadRazorpayScript);
    } else {
        loadRazorpayScript();
    }

})();
