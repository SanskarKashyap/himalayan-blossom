const dotenv = require('dotenv');
// Load environment variables immediately
dotenv.config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const createOrder = require('./api/create-order');
const verifyPayment = require('./api/verify-payment');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors({
    origin: true, // Reflects the request origin
    credentials: true // Allow cookies/headers
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files if needed, but we mostly use Live Server for that

// Mock Request/Response objects for Vercel functions
const createVercelHandler = (handler) => async (req, res) => {
    // Vercel functions look like (req, res) => ...
    // Express req/res are compatible enough for this basic usage
    try {
        await handler(req, res);
    } catch (error) {
        console.error('API Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
};

// Routes
app.post('/api/create-order', createVercelHandler(createOrder));
app.post('/api/verify-payment', createVercelHandler(verifyPayment));

// Root route (optional)
app.get('/', (req, res) => {
    res.send('Local Development Server is Running. API at /api');
});

app.listen(PORT, () => {
    console.log(`Local Development Server running on http://localhost:${PORT}`);
    console.log(`API Endpoints available at http://localhost:${PORT}/api/create-order`);
});
