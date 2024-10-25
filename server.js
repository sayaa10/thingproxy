const url = require("url");
const request = require("request");
const throttle = require("tokenthrottle")({ rate: config.max_requests_per_second });
const publicAddressFinder = require("public-address");

let publicIP;

// Get public IP address once on startup
publicAddressFinder((err, data) => {
  if (!err && data) {
    publicIP = data.address;
  }
});

// Helper to add CORS headers
function addCORSHeaders(req, res) {
  if (req.method.toUpperCase() === "OPTIONS") {
    if (req.headers["access-control-request-headers"]) {
      res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"]);
    }
    if (req.headers["access-control-request-method"]) {
      res.setHeader("Access-Control-Allow-Methods", req.headers["access-control-request-method"]);
    }
  }
  if (req.headers["origin"]) {
    res.setHeader("Access-Control-Allow-Origin", req.headers["origin"]);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
}

function writeResponse(res, httpCode, body) {
  res.statusCode = httpCode;
  res.end(body);
}

function sendInvalidURLResponse(res) {
  return writeResponse(res, 404, "URL must be in the form of /fetch/{some_url_here}");
}

function sendTooBigResponse(res) {
  return writeResponse(res, 413, `Request or response content cannot exceed ${config.max_request_length} characters.`);
}

async function processRequest(req, res) {
  addCORSHeaders(req, res);

  // Handle preflight OPTIONS request
  if (req.method.toUpperCase() === "OPTIONS") {
    return writeResponse(res, 204);
  }

  const result = config.fetch_regex.exec(req.url);

  if (result && result.length === 2 && result[1]) {
    let remoteURL;

    try {
      remoteURL = url.parse(decodeURI(result[1]));
    } catch (e) {
      return sendInvalidURLResponse(res);
    }

    // Validate the remote URL
    if (!remoteURL.host) return writeResponse(res, 404, "Relative URLs are not supported");
    if (config.blacklist_hostname_regex.test(remoteURL.hostname)) return writeResponse(res, 400, "Blocked host");
    if (remoteURL.protocol !== "http:" && remoteURL.protocol !== "https:") return writeResponse(res, 400, "Only http and https are supported");

    // Forward IP address if available
    if (publicIP) {
      req.headers["x-forwarded-for"] = req.headers["x-forwarded-for"]
        ? `${req.headers["x-forwarded-for"]}, ${publicIP}`
        : publicIP;
    }

    req.headers["host"] = remoteURL.host;
    delete req.headers["origin"];
    delete req.headers["referer"];

    const proxyRequest = request({
      url: remoteURL,
      headers: req.headers,
      method: req.method,
      timeout: config.proxy_request_timeout_ms,
      strictSSL: false
    });

    let requestSize = 0;
    let proxyResponseSize = 0;

    req.pipe(proxyRequest)
      .on("data", (data) => {
        requestSize += data.length;
        if (requestSize >= config.max_request_length) {
          proxyRequest.end();
          return sendTooBigResponse(res);
        }
      })
      .on("error", () => writeResponse(res, 500, "Stream Error"));

    proxyRequest.pipe(res)
      .on("data", (data) => {
        proxyResponseSize += data.length;
        if (proxyResponseSize >= config.max_request_length) {
          proxyRequest.end();
          return sendTooBigResponse(res);
        }
      })
      .on("error", () => writeResponse(res, 500, "Stream Error"));
  } else {
    sendInvalidURLResponse(res);
  }
}

module.exports = async (req, res) => {
  if (config.enable_rate_limiting) {
    throttle.rateLimit(getClientAddress(req), (err, limited) => {
      if (limited) {
        return writeResponse(res, 429, "Rate limit exceeded");
      }
      processRequest(req, res);
    });
  } else {
    processRequest(req, res);
  }
};
