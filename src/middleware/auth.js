const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "sahl-dev-secret-change-me";

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "لم يتم تسجيل الدخول" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "جلسة غير صالحة، سجّل الدخول مجدداً" });
  }
}

module.exports = { requireAuth, JWT_SECRET };
