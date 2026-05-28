import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import {
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
} from '../services/resend/emailService.js';

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
  const refreshToken = jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
  return { accessToken, refreshToken };
};

/* ── Register ────────────────────────────────────────────────────── */
export const register = async (req, res) => {
  try {
    const { name, email, password, organizationName } = req.body;

    if (await User.findOne({ email })) {
      return res.status(400).json({ success: false, message: 'Email already in use.' });
    }

    const slug =
      organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      uuidv4().slice(0, 6);

    // Build email verification token
    const rawVerifyToken = crypto.randomBytes(32).toString('hex');
    const hashedVerifyToken = crypto.createHash('sha256').update(rawVerifyToken).digest('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h

    const user = await User.create({
      name,
      email,
      password,
      role: 'owner',
      emailVerificationToken: hashedVerifyToken,
      emailVerificationExpires: verifyExpires,
    });

    const org = await Organization.create({
      name: organizationName,
      slug,
      owner: user._id,
      members: [{ user: user._id, role: 'admin' }],
    });

    user.organization = org._id;
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user._id);
    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    // Fire-and-forget emails
    const verifyUrl = `${process.env.CLIENT_URL}/verify-email/${rawVerifyToken}`;
    sendWelcomeEmail({ name: user.name, email: user.email }).catch(console.error);
    sendVerificationEmail({ name: user.name, email: user.email, verifyUrl }).catch(console.error);

    const populated = await User.findById(user._id).populate('organization');

    res.status(201).json({ success: true, accessToken, refreshToken, user: populated });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Registration failed.', error: error.message });
  }
};

/* ── Login ───────────────────────────────────────────────────────── */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password').populate('organization');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const { accessToken, refreshToken } = generateTokens(user._id);
    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, accessToken, refreshToken, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Login failed.', error: error.message });
  }
};

/* ── Refresh token ───────────────────────────────────────────────── */
export const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ success: false, message: 'No refresh token.' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id).select('+refreshToken');

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);
    user.refreshToken = newRefreshToken;
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, accessToken, refreshToken: newRefreshToken });
  } catch {
    res.status(401).json({ success: false, message: 'Refresh token expired or invalid.' });
  }
};

/* ── Logout ──────────────────────────────────────────────────────── */
export const logout = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
    res.json({ success: true, message: 'Logged out.' });
  } catch {
    res.status(500).json({ success: false, message: 'Logout failed.' });
  }
};

/* ── Get me ──────────────────────────────────────────────────────── */
export const getMe = async (req, res) => {
  const user = await User.findById(req.user._id).populate('organization');
  res.json({ success: true, user });
};

/* ── Verify email ────────────────────────────────────────────────── */
export const verifyEmail = async (req, res) => {
  try {
    const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      emailVerificationToken: hashed,
      emailVerificationExpires: { $gt: Date.now() },
    }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Verification link is invalid or has expired.' });
    }

    user.isVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, message: 'Email verified successfully.' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ success: false, message: 'Verification failed.' });
  }
};

/* ── Forgot password ─────────────────────────────────────────────── */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    // Always respond with 200 to prevent email enumeration
    if (!user) {
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 h
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${rawToken}`;
    await sendPasswordResetEmail({ name: user.name, email: user.email, resetUrl });

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Could not send reset email.' });
  }
};

/* ── Reset password ──────────────────────────────────────────────── */
export const resetPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashed,
      passwordResetExpires: { $gt: Date.now() },
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    // Invalidate all sessions
    user.refreshToken = null;
    await user.save();

    res.json({ success: true, message: 'Password reset successfully. Please log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Password reset failed.' });
  }
};
