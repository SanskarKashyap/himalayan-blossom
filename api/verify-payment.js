const crypto = require('crypto');
const { verifyIdToken, getFirestore } = require('./_services');

function send(res, statusCode, data) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
}

module.exports = async function (req, res) {
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
        return send(res, 401, { error: 'Unauthorized' });
    }

    // 2. Validate Input
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return send(res, 400, { error: 'Missing payment details' });
    }

    try {
        // 3. Verify Signature
        const secret = process.env.RAZORPAY_KEY_SECRET;
        const generated_signature = crypto
            .createHmac('sha256', secret)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');

        if (generated_signature !== razorpay_signature) {
            return send(res, 400, { error: 'Payment verification failed: Invalid signature' });
        }

        // 4. Move Cart to Orders
        const db = getFirestore();
        const cartRef = db.collection('carts').doc(uid);
        const ordersRef = db.collection('users').doc(uid).collection('orders');

        const cartDoc = await cartRef.get();

        const cartData = cartDoc.exists ? cartDoc.data() : {};
        const itemsMap = cartData.items || {};
        const items = Object.values(itemsMap);

        let totalAmount = 0;
        items.forEach(item => {
            let priceInPaise = 0;
            if (item.priceSnapshot !== undefined && item.priceSnapshot !== null) {
                priceInPaise = Number(item.priceSnapshot);
            } else {
                priceInPaise = (Number(item.price) || 0) * 100;
            }
            const quantity = Number(item.qty) || Number(item.quantity) || 1;
            totalAmount += priceInPaise * quantity;
        });

        const orderData = {
            razorpay_order_id,
            razorpay_payment_id,
            amount: totalAmount / 100, // INR
            amountPaise: totalAmount,
            currency: 'INR',
            items: items,
            paymentStatus: 'paid',
            paymentMethod: 'razorpay',
            createdAt: new Date().toISOString()
        };

        // Transaction to ensure atomicity
        await db.runTransaction(async (t) => {
            // Create order
            const newOrderRef = ordersRef.doc();
            t.set(newOrderRef, orderData);

            // Clear cart items
            t.update(cartRef, {
                items: {},
                updatedAt: new Date().toISOString()
            });
        });

        return send(res, 200, { success: true, message: 'Payment verified and order created' });

    } catch (error) {
        console.error('Verify Payment Error:', error);
        return send(res, 500, { error: 'Internal Server Error' });
    }
};
