const { getFirebaseApp, getFirestore, verifyIdToken, appendSheetRow } = require('./_services');

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((all, part) => {
    const [key, value] = part.split('=');
    if (!key) return all;
    all[key.trim()] = decodeURIComponent((value || '').trim());
    return all;
  }, {});
}

function extractToken(req) {
  const authHeader = req.headers && req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers && req.headers.cookie);
  if (cookies.hbAuthToken) {
    return cookies.hbAuthToken;
  }
  if (req.body && typeof req.body === 'object' && typeof req.body.token === 'string') {
    return req.body.token;
  }
  return null;
}

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  const chunks = [];
  return new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      chunks.push(chunk);
      if (chunks.reduce((size, buffer) => size + buffer.length, 0) > 1_000_000) {
        reject(new Error('Payload too large.'));
      }
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', reject);
  });
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

function normalizeCartItem(rawItem) {
  if (!rawItem || typeof rawItem !== 'object') {
    throw new Error('Invalid cart item payload.');
  }

  const product = (rawItem.product || rawItem.productName || rawItem.name || '').toString().trim();
  const size = (rawItem.size || '').toString().trim();
  if (!product) {
    throw new Error('Cart item is missing product name.');
  }
  if (!size) {
    throw new Error('Cart item is missing size selection.');
  }

  const quantityNumber = Number(rawItem.quantity);
  const quantity =
    Number.isFinite(quantityNumber) && quantityNumber > 0 ? Math.floor(quantityNumber) : 1;

  const productId = rawItem.productId
    ? rawItem.productId.toString().trim()
    : slugify(`${product}-${size}`);

  const priceNumber = Number(rawItem.price);
  const price =
    Number.isFinite(priceNumber) && priceNumber >= 0 ? Number(priceNumber.toFixed(2)) : null;

  return {
    productId,
    product,
    productHi: (rawItem.productHi || '').toString().trim(),
    size,
    quantity,
    price,
    image: (rawItem.img || rawItem.image || '').toString(),
    language: (rawItem.language || 'en').toString(),
    notes: (rawItem.notes || '').toString(),
    metadata: typeof rawItem.metadata === 'object' && rawItem.metadata !== null ? rawItem.metadata : null,
    addedAt: rawItem.addedAt || new Date().toISOString(),
  };
}

function sanitizeCartItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((raw) => {
      try {
        return normalizeCartItem(raw);
      } catch (error) {
        console.warn('[api/cart] Ignoring invalid cart item', raw, error);
        return null;
      }
    })
    .filter(Boolean);
}

function mergeCartItems(existingItems, incomingItem) {
  const map = new Map();
  (existingItems || []).forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const key = `${item.productId || item.product}-${item.size}`.toLowerCase();
    map.set(key, Object.assign({}, item));
  });

  const mergeKey = `${incomingItem.productId || incomingItem.product}-${incomingItem.size}`.toLowerCase();
  const current = map.get(mergeKey);
  if (current) {
    const currentQuantity = Number(current.quantity) || 0;
    map.set(
      mergeKey,
      Object.assign({}, current, incomingItem, {
        quantity: currentQuantity + incomingItem.quantity,
        addedAt: incomingItem.addedAt || current.addedAt || new Date().toISOString(),
      })
    );
  } else {
    map.set(mergeKey, Object.assign({}, incomingItem));
  }

  return Array.from(map.values());
}

async function handleGetCart(req, res, decoded) {
  const db = getFirestore();
  const cartRef = db.collection('carts').doc(decoded.uid);
  const snapshot = await cartRef.get();
  const data = snapshot.exists ? snapshot.data() : {};
  return send(res, 200, {
    uid: decoded.uid,
    email: decoded.email || '',
    updatedAt: data.updatedAt || null,
    createdAt: data.createdAt || null,
    items: Array.isArray(data.items) ? data.items : [],
  });
}

async function handlePostCart(req, res, decoded) {
  const body = await readRequestBody(req);
  const replaceItems = Array.isArray(body && body.items);
  const incomingItems = replaceItems ? sanitizeCartItems(body.items) : [];
  const incomingItem = replaceItems ? null : normalizeCartItem(body && body.item ? body.item : body);

  const db = getFirestore();
  const cartRef = db.collection('carts').doc(decoded.uid);
  const timestamp = new Date().toISOString();
  let updatedItems = [];

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(cartRef);
    const existing = snapshot.exists ? snapshot.data() : {};
    if (replaceItems) {
      updatedItems = incomingItems;
    } else {
      updatedItems = mergeCartItems(existing.items || [], incomingItem);
    }
    const payload = {
      uid: decoded.uid,
      email: decoded.email || existing.email || '',
      updatedAt: timestamp,
      items: updatedItems,
    };
    if (!snapshot.exists) {
      payload.createdAt = timestamp;
    }
    transaction.set(cartRef, payload, { merge: true });
  });

  if (!replaceItems && incomingItem) {
    const cartRange = process.env.GOOGLE_SHEETS_CART_RANGE || 'CartLog!A:H';
    await appendSheetRow(cartRange, [
      timestamp,
      decoded.email || '',
      decoded.uid,
      incomingItem.product,
      incomingItem.size,
      incomingItem.quantity,
      incomingItem.price != null ? incomingItem.price : '',
      JSON.stringify(incomingItem),
    ]);
  }

  return send(res, 200, {
    status: 'ok',
    cart: {
      uid: decoded.uid,
      email: decoded.email || '',
      updatedAt: timestamp,
      items: updatedItems,
    },
  });
}

module.exports = async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return send(res, 401, { error: 'Missing Firebase ID token.' });
    }
    const decoded = await verifyIdToken(token);

    if (req.method === 'GET') {
      return await handleGetCart(req, res, decoded);
    }

    if (req.method === 'POST') {
      return await handlePostCart(req, res, decoded);
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('Cart handler failed:', error);
    return send(res, 500, { error: error.message || 'Failed to process cart request.' });
  }
};
