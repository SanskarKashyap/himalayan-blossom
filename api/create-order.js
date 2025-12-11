const Razorpay = require('razorpay');
const { verifyIdToken } = require('./_services');

// Server-side pricing source of truth (Must match client logic or be the master)
const DEFAULT_PRICING = {
    '250 gram': 1199,
    '500 gram': 1999,
    '1000 gram': 3499,
};

// You might load this from a database or config file
const PREORDER_PRICING = {};

function resolvePrice(variant, size) {
    // Logic mirroring the client but TRUSTED
    // If variant specific logic exists, add it here.
    // For now, using size-based default pricing as evident in client code

    if (PREORDER_PRICING[variant] && PREORDER_PRICING[variant][size]) {
        return PREORDER_PRICING[variant][size];
    }
    return DEFAULT_PRICING[size] || null;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        // 1. Authenticate Request
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: Missing token' });
        }
        const token = authHeader.split(' ')[1];
        const decodedToken = await verifyIdToken(token);
        const uid = decodedToken.uid;

        // 2. Validate Inputs
        const { variant, size, currency = 'INR', notes } = req.body;

        if (!variant || !size) {
            return res.status(400).json({ error: 'Missing product details' });
        }

        // 3. Secure Price Resolution
        const price = resolvePrice(variant, size);
        if (!price) {
            return res.status(400).json({ error: 'Invalid product configuration' });
        }

        // 4. Initialize Razorpay
        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.error('Razorpay keys missing');
            return res.status(500).json({ error: 'Server payment configuration missing' });
        }

        const instance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        const amountPaise = Math.round(price * 100);

        // 5. Create Order
        const order = await instance.orders.create({
            amount: amountPaise,
            currency: currency,
            receipt: `receipt_${Date.now()}_${uid.slice(0, 5)}`,
            notes: {
                ...notes,
                userId: uid,
                product_variant: variant,
                product_size: size
            }
        });

        // 6. Return Secure Order Details
        res.status(200).json({
            order,
            razorpay_key_id: process.env.RAZORPAY_KEY_ID,
            verified_amount: price
        });

    } catch (error) {
        console.error('Order creation failed:', error);
        res.status(500).json({ error: 'Internal Server Error', detail: error.message });
    }
};
