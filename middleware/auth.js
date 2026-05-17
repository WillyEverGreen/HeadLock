/**
 * Auth Middleware
 * 
 * Verifies that the incoming request contains a valid Bearer token.
 * Loaded from the SECRET_TOKEN environment variable.
 */

module.exports = function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  // 1. Return 401 if Authorization header is missing
  if (!authHeader) {
    return res.status(401).json({
      error: "Unauthorized: Missing Authorization header.",
      code: "MISSING_TOKEN",
      timeTaken: 0
    });
  }

  // 2. Return 403 if token format is invalid (must be Bearer <token>)
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(403).json({
      error: "Forbidden: Invalid authorization format. Must be 'Bearer <token>'.",
      code: "INVALID_TOKEN_FORMAT",
      timeTaken: 0
    });
  }

  const token = parts[1];
  const secretToken = process.env.SECRET_TOKEN;

  // 3. Handle server misconfiguration safely
  if (!secretToken) {
    console.error(`[${new Date().toISOString()}] Server Error: SECRET_TOKEN environment variable is not set.`);
    return res.status(500).json({
      error: "Internal Server Error: Authentication is not configured on the server.",
      code: "SERVER_CONFIG_ERROR",
      timeTaken: 0
    });
  }

  // 4. Return 401 if token is wrong
  if (token !== secretToken) {
    return res.status(401).json({
      error: "Unauthorized: Invalid token.",
      code: "INVALID_TOKEN",
      timeTaken: 0
    });
  }

  next();
};
