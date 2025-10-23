const { verifyIdToken, appendSheetRow } = require('./_services');

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed' });
  }

  try {
    const token = extractToken(req);
    if (!token) {
      return send(res, 401, { error: 'Missing Firebase ID token.' });
    }

    const decoded = await verifyIdToken(token);
    const email = decoded.email || '';
    const uid = decoded.uid;
    const name = decoded.name || decoded.displayName || '';
    const authTime = decoded.auth_time
      ? new Date(decoded.auth_time * 1000).toISOString()
      : new Date().toISOString();
    const loginRange = process.env.GOOGLE_SHEETS_LOGIN_RANGE || 'LoginLog!A:E';

    await appendSheetRow(loginRange, [
      new Date().toISOString(),
      email,
      uid,
      name,
      authTime,
    ]);

    return send(res, 200, { status: 'ok' });
  } catch (error) {
    console.error('Login log failed:', error);
    return send(res, 500, { error: 'Failed to log login activity.' });
  }
};
