/**
 * Authentication Controller
 * Handles user registration, login, and auth operations
 * Uses SQLite via better-sqlite3
 */

const { v4: uuidv4 } = require('uuid');
const { db, queryOne, run } = require('../config/database');
const { generateToken, hashPassword, comparePassword } = require('../utils/helpers');
const { sendWelcomeEmail } = require('../utils/emailService');
const { validationResult } = require('express-validator');

/**
 * Register new user (patient or doctor)
 * POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password, full_name, role = 'patient', phone, date_of_birth, gender } = req.body;

    // Check if user already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered. Please login.' });
    }

    const hashedPassword = await hashPassword(password);
    const userId = uuidv4();
    const now = new Date().toISOString();

    // Create user
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, role, phone, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,1,?,?)`
    ).run(userId, email, hashedPassword, full_name, role, phone || null, now, now);

    // Create role-specific profile
    if (role === 'patient') {
      db.prepare(
        `INSERT INTO patients (id, user_id, date_of_birth, gender, blood_group, address, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(uuidv4(), userId, date_of_birth || null, gender || null, req.body.blood_group || null, req.body.address || null, now, now);
    } else if (role === 'doctor') {
      db.prepare(
        `INSERT INTO doctors (id, user_id, specialization, department_id, license_number, experience_years, consultation_fee, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(uuidv4(), userId, req.body.specialization || 'General', req.body.department_id || null, req.body.license_number || null, req.body.experience_years || 0, req.body.consultation_fee || 500, now, now);
    }

    // Welcome notification
    db.prepare(
      `INSERT INTO notifications (id, user_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)`
    ).run(uuidv4(), userId, 'Welcome to Smart Hospital!', `Welcome ${full_name}! Your account has been created successfully.`, 'info', now);

    // Send welcome email (non-blocking)
    sendWelcomeEmail(email, full_name).catch(console.error);

    const token = generateToken(userId, role);

    res.status(201).json({
      success: true,
      message: 'Registration successful!',
      data: { token, user: { id: userId, email, full_name, role } }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
};

/**
 * Login user
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account deactivated. Contact administrator.' });
    }

    const isPasswordValid = await comparePassword(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Get role-specific profile
    let profile = null;
    if (user.role === 'patient') {
      profile = db.prepare('SELECT * FROM patients WHERE user_id = ?').get(user.id);
    } else if (user.role === 'doctor') {
      profile = db.prepare(`
        SELECT d.*, dept.name AS department_name
        FROM doctors d
        LEFT JOIN departments dept ON d.department_id = dept.id
        WHERE d.user_id = ?
      `).get(user.id);
      if (profile) profile.departments = { name: profile.department_name };
    }

    // Update last login
    db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);

    const token = generateToken(user.id, user.role);

    res.json({
      success: true,
      message: 'Login successful!',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          phone: user.phone,
          avatar_url: user.avatar_url,
          profile
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

/**
 * Get current user profile
 * GET /api/auth/me
 */
const getMe = async (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, full_name, role, phone, avatar_url, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let profile = null;
    if (user.role === 'patient') {
      profile = db.prepare('SELECT * FROM patients WHERE user_id = ?').get(user.id);
    } else if (user.role === 'doctor') {
      profile = db.prepare(`
        SELECT d.*, dept.name AS department_name, dept.description AS department_description
        FROM doctors d
        LEFT JOIN departments dept ON d.department_id = dept.id
        WHERE d.user_id = ?
      `).get(user.id);
      if (profile) profile.departments = { name: profile.department_name, description: profile.department_description };
    }

    res.json({ success: true, data: { ...user, profile } });
  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Update user profile
 * PUT /api/auth/profile
 */
const updateProfile = async (req, res) => {
  try {
    const { full_name, phone, avatar_url } = req.body;
    const now = new Date().toISOString();

    db.prepare('UPDATE users SET full_name = ?, phone = ?, avatar_url = ?, updated_at = ? WHERE id = ?')
      .run(full_name, phone, avatar_url, now, req.user.id);

    const updatedUser = db.prepare('SELECT id, email, full_name, role, phone, avatar_url FROM users WHERE id = ?').get(req.user.id);

    res.json({ success: true, message: 'Profile updated successfully.', data: updatedUser });
  } catch (error) {
    console.error('UpdateProfile error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Change password
 * PUT /api/auth/change-password
 */
const changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const isValid = await comparePassword(current_password, user.password_hash);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    const hashedPassword = await hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashedPassword, new Date().toISOString(), req.user.id);

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (error) {
    console.error('ChangePassword error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { register, login, getMe, updateProfile, changePassword };
