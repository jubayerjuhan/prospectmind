import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Organization from '../models/Organization.js';

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
