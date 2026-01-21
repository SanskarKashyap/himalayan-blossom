const Razorpay = require('razorpay');
const { verifyIdToken, getFirestore } = require('./_services');

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

function send(res, statusCode, data) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
}

module.exports = async function (req, res) {
    // Allow only POST
    if (req.method !== 'POST') {
        return send(res, 405, { error: 'Method not allowed' });
    }

    // 1. Verify User
    let uid;
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return send(res, 401, { error: 'Unauthorized: Missing token' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = await verifyIdToken(token);
        uid = decoded.uid;
    } catch (error) {
        console.error('Auth error:', error);
        return send(res, 401, { error: 'Unauthorized: Invalid token' });
    }

    try {
        const db = getFirestore();
        // ... (rest of logic)

        // 2. Fetch Cart from /carts/{uid}
        const cartDoc = await db.collection('carts').doc(uid).get();

        if (!cartDoc.exists) {
            return send(res, 400, { error: 'Cart is empty' });
        }

        const cartData = cartDoc.data();
        const itemsMap = cartData.items || {};
        const items = Object.values(itemsMap);

        if (items.length === 0) {
            return send(res, 400, { error: 'Cart is empty' });
        }

        let totalAmount = 0;

        // Calculate total
        items.forEach((item) => {
            // Calculate price in paise
            let priceInPaise = 0;
            if (item.priceSnapshot !== undefined && item.priceSnapshot !== null) {
                priceInPaise = Number(item.priceSnapshot);
            } else {
                // Fallback if priceSnapshot missing, assumes price is Rupees
                priceInPaise = (Number(item.price) || 0) * 100;
            }

            const quantity = Number(item.qty) || Number(item.quantity) || 1;
            totalAmount += priceInPaise * quantity;
        });

        if (totalAmount <= 0) {
            return send(res, 400, { error: 'Invalid cart total' });
        }

        // 3. Create Razorpay Order
        // Amount in paise
        const options = {
            amount: Math.round(totalAmount),
            currency: 'INR',
            receipt: `order_${Date.now()}_${uid.substring(0, 5)}`,
            payment_capture: 1
        };

        const order = await razorpay.orders.create(options);

        // 4. Return Order Details
        return send(res, 200, {
            id: order.id,
            amount: order.amount,
            currency: order.currency,
            key: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error('Create Order Error:', error);
        return send(res, 500, { error: 'Internal Server Error' });
    }
};
