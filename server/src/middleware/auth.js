import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { hashApiKey, looksLikeApiKey } from '../services/apiKey.js';

export const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]
      : null;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized. No token.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).populate('organization');

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    req.user = user;
    req.organization = user.organization;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
};

/**
 * Authenticate an external integration by API key, falling back to `protect`.
 *
 * Mounted only on the endpoints a third-party tool is meant to call. Keeping it
 * off everything else is the point: an API key that could drive the whole API
 * would be a far bigger thing to leak than one that can read a campaign's
 * generated outreach.
 *
 * `req.user` is left null for key-authenticated calls — there is no person on
 * the other end — so any handler using it must not be mounted here.
 */
export const apiKeyOrProtect = async (req, res, next) => {
  const presented = req.headers['x-api-key'] || (looksLikeApiKey(req.headers.authorization?.replace('Bearer ', '')) ? req.headers.authorization.replace('Bearer ', '') : null);

  if (!presented) return protect(req, res, next);

  try {
    const organization = await Organization.findOne({ 'apiKey.hash': hashApiKey(presented) });
    if (!organization) {
      return res.status(401).json({ success: false, message: 'Invalid API key.' });
    }

    req.organization = organization;
    req.user = null;
    req.authedViaApiKey = true;

    // Fire-and-forget: "when did this integration last call us" is worth
    // knowing, but never worth failing or delaying the request for.
    Organization.updateOne({ _id: organization._id }, { $set: { 'apiKey.lastUsedAt': new Date() } }).catch(() => {});

    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid API key.' });
  }
};

export const requirePlan = (...plans) => {
  return (req, res, next) => {
    if (!req.organization || !plans.includes(req.organization.plan)) {
      return res.status(403).json({
        success: false,
        message: `This feature requires a ${plans.join(' or ')} plan.`,
        code: 'UPGRADE_REQUIRED',
      });
    }
    next();
  };
};

export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
    }
    next();
  };
};
