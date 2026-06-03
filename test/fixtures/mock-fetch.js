import fs from 'node:fs';

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

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

  if (!String(url).includes('bot-api.')) {
    if ((init.method || 'GET') === 'HEAD') {
      return new Response('', {
        status: Number(process.env.ZALO_PREFLIGHT_STATUS || 200),
        headers: {
          'content-type': process.env.ZALO_PREFLIGHT_CONTENT_TYPE || 'image/jpeg',
          ...(process.env.ZALO_PREFLIGHT_CONTENT_LENGTH ? { 'content-length': process.env.ZALO_PREFLIGHT_CONTENT_LENGTH } : {})
        }
      });
    }
    return new Response(process.env.ZALO_DOWNLOAD_BYTES ? Buffer.from(process.env.ZALO_DOWNLOAD_BYTES, 'base64') : PNG_BYTES, {
      status: Number(process.env.ZALO_DOWNLOAD_STATUS || 200),
      headers: { 'content-type': process.env.ZALO_DOWNLOAD_CONTENT_TYPE || 'image/png' }
    });
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
