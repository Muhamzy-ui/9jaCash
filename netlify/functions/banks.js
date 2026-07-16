const https = require('https');
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  return new Promise((resolve) => {
    const reqOpts = {
      hostname: 'api.paystack.co',
      path: '/bank?country=nigeria&perPage=300',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`
      }
    };

    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 && parsed.status) {
            const banks = parsed.data
              .filter(b => b.active && !b.is_deleted)
              .map(b => ({ code: b.code, name: b.name }))
              .sort((a, b) => a.name.localeCompare(b.name));

            resolve({
              statusCode: 200,
              headers,
              body: JSON.stringify({ status: true, banks })
            });
          } else {
            resolve({
              statusCode: 500,
              headers,
              body: JSON.stringify({ error: 'Failed to fetch bank list from Paystack.' })
            });
          }
        } catch (e) {
          resolve({
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Invalid JSON response from Paystack.' })
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Bank list service offline.' })
      });
    });

    req.end();
  });
};
