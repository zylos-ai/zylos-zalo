import fs from 'node:fs';

globalThis.fetch = async (url, init = {}) => {
  const record = {
    url: String(url),
    method: init.method || 'GET',
    headers: init.headers || {},
    body: init.body ? JSON.parse(init.body) : null
  };
  if (process.env.ZALO_FETCH_LOG) {
    fs.appendFileSync(process.env.ZALO_FETCH_LOG, JSON.stringify(record) + '\n');
  }
  if (process.env.ZALO_FETCH_ERROR_JSON) {
    return new Response(process.env.ZALO_FETCH_ERROR_JSON, {
      status: Number(process.env.ZALO_FETCH_ERROR_STATUS || 200),
      headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({
    ok: true,
    result: { message_id: 'mock-message-id' }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
