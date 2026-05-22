import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

function request(port, path, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function startServer(port, host, handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(port, host, () => resolve(srv));
  });
}

test('webhook public server does not serve /internal/record-outgoing', async () => {
  const publicServer = await startServer(0, '127.0.0.1', (req, res) => {
    if (req.method === 'POST' && req.url === '/zalo/webhook') {
      res.writeHead(200).end('ok');
      return;
    }
    res.writeHead(404).end();
  });

  const port = publicServer.address().port;
  try {
    const webhookRes = await request(port, '/zalo/webhook');
    assert.equal(webhookRes.status, 200);

    const internalRes = await request(port, '/internal/record-outgoing', {
      headers: { 'X-Internal-Token': 'anything' },
      body: JSON.stringify({ chatId: '1', text: 'test' })
    });
    assert.equal(internalRes.status, 404);
  } finally {
    publicServer.close();
  }
});

test('internal server accepts record-outgoing with correct token and rejects wrong token', async () => {
  const VALID_TOKEN = 'correct-token-abc123';
  const internalServer = await startServer(0, '127.0.0.1', (req, res) => {
    if (req.method === 'POST' && req.url === '/internal/record-outgoing') {
      const token = req.headers['x-internal-token'];
      if (token !== VALID_TOKEN) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200).end('ok');
      });
      return;
    }
    res.writeHead(404).end();
  });

  const port = internalServer.address().port;
  try {
    const goodRes = await request(port, '/internal/record-outgoing', {
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': VALID_TOKEN },
      body: JSON.stringify({ chatId: '1', text: 'test' })
    });
    assert.equal(goodRes.status, 200);

    const badRes = await request(port, '/internal/record-outgoing', {
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': 'wrong-token' },
      body: JSON.stringify({ chatId: '1', text: 'test' })
    });
    assert.equal(badRes.status, 403);

    const noTokenRes = await request(port, '/internal/record-outgoing', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: '1', text: 'test' })
    });
    assert.equal(noTokenRes.status, 403);
  } finally {
    internalServer.close();
  }
});
