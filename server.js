// index.js

const url = require('url');
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const queryObject = url.parse(req.url, true).query;
  const targetUrl = queryObject.url;

  if (!targetUrl) {
    res.status(400).send("URL is required as a query parameter.");
    return;
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "*");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    const data = await response.arrayBuffer();
    res.status(response.status).send(Buffer.from(data));

  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).send("Error fetching the requested URL.");
  }
};
