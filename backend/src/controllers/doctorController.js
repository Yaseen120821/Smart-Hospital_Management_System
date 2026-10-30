/**
 * Doctor Controller
 * Handles doctor profile, availability, and management
 * Uses SQLite via better-sqlite3
 */

const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const { getPagination } = require('../utils/helpers');

/**
 * Get all doctors (public)
 * GET /api/doctors
 */
const getAllDoctors = async (req, res) => {
  try {
    const { page = 1, limit = 12, department, search, is_available } = req.query;
    const { offset } = getPagination(page, limit);

    let conditions = ['u.is_active = 1'];
    let params = [];

    if (department) { conditions.push('d.department_id = ?'); params.push(department); }
    if (is_available !== undefined) { conditions.push('d.is_available = ?'); params.push(is_available === 'true' ? 1 : 0); }
    if (search) {
      conditions.push('(u.full_name LIKE ? OR d.specialization LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = 'WHERE ' + conditions.join(' AND ');

    const total = db.prepare(`
      SELECT COUNT(*) AS count FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      ${where}
    `).get(...params)?.count || 0;

    const doctors = db.prepare(`
      SELECT d.id, d.specialization, d.experience_years, d.consultation_fee, d.rating, d.is_available,
        u.id AS user_id, u.full_name, u.email, u.avatar_url, u.phone,
        dept.id AS dept_id, dept.name AS dept_name
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      ${where}
      ORDER BY d.rating DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));

    // Shape the result to match original format
    const shaped = doctors.map(d => ({
      ...d,
      users: { id: d.user_id, full_name: d.full_name, email: d.email, avatar_url: d.avatar_url, phone: d.phone },
      departments: d.dept_id ? { id: d.dept_id, name: d.dept_name } : null
    }));

    res.json({
      success: true,
      data: shaped,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('GetAllDoctors error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get doctor by ID
 * GET /api/doctors/:id
 */
const getDoctorById = async (req, res) => {
  try {
    const doctor = db.prepare(`
      SELECT d.*,
        u.id AS user_uid, u.full_name, u.email, u.avatar_url, u.phone,
        dept.id AS dept_id, dept.name AS dept_name, dept.description AS dept_desc
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      WHERE d.id = ?
    `).get(req.params.id);

    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });

    const availability = db.prepare('SELECT * FROM doctor_availability WHERE doctor_id = ?').all(doctor.id);
    const totalAppts = db.prepare(`SELECT COUNT(*) AS count FROM appointments WHERE doctor_id = ? AND status = 'completed'`).get(doctor.id);

    res.json({
      success: true,
      data: {
        ...doctor,
        users: { id: doctor.user_uid, full_name: doctor.full_name, email: doctor.email, avatar_url: doctor.avatar_url, phone: doctor.phone },
        departments: doctor.dept_id ? { id: doctor.dept_id, name: doctor.dept_name, description: doctor.dept_desc } : null,
        doctor_availability: availability,
        total_completed_appointments: totalAppts?.count || 0
      }
    });
  } catch (error) {
    console.error('GetDoctorById error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get doctor's own profile
 * GET /api/doctors/profile/me
 */
const getDoctorProfile = async (req, res) => {
  try {
    const doctor = db.prepare(`
      SELECT d.*,
        u.id AS user_uid, u.full_name, u.email, u.avatar_url, u.phone,
        dept.id AS dept_id, dept.name AS dept_name
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      WHERE d.user_id = ?
    `).get(req.user.id);

    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });

    const availability = db.prepare('SELECT * FROM doctor_availability WHERE doctor_id = ?').all(doctor.id);

    res.json({
      success: true,
      data: {
        ...doctor,
        users: { id: doctor.user_uid, full_name: doctor.full_name, email: doctor.email, avatar_url: doctor.avatar_url, phone: doctor.phone },
        departments: doctor.dept_id ? { id: doctor.dept_id, name: doctor.dept_name } : null,
        doctor_availability: availability
      }
    });
  } catch (error) {
    console.error('GetDoctorProfile error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Update doctor profile
 * PUT /api/doctors/profile
 */
const updateDoctorProfile = async (req, res) => {
  try {
    const { specialization, experience_years, consultation_fee, bio, education } = req.body;
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE doctors SET specialization = ?, experience_years = ?, consultation_fee = ?, bio = ?, education = ?, updated_at = ? WHERE user_id = ?`
    ).run(specialization, experience_years, consultation_fee, bio, education, now, req.user.id);

    const doctor = db.prepare('SELECT * FROM doctors WHERE user_id = ?').get(req.user.id);
    res.json({ success: true, message: 'Profile updated.', data: doctor });
  } catch (error) {
    console.error('UpdateDoctorProfile error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Update doctor availability
 * PUT /api/doctors/availability
 */
const updateAvailability = async (req, res) => {
  try {
    const { availability, is_available } = req.body;

    const doctor = db.prepare('SELECT id FROM doctors WHERE user_id = ?').get(req.user.id);
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });

    const now = new Date().toISOString();

    if (is_available !== undefined) {
      db.prepare('UPDATE doctors SET is_available = ?, updated_at = ? WHERE id = ?').run(is_available ? 1 : 0, now, doctor.id);
    }

    if (availability && Array.isArray(availability)) {
      db.prepare('DELETE FROM doctor_availability WHERE doctor_id = ?').run(doctor.id);
      const insert = db.prepare(
        `INSERT INTO doctor_availability (id, doctor_id, day_of_week, start_time, end_time, slot_duration, is_available, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      );
      const insertAll = db.transaction(() => {
        for (const slot of availability) {
          insert.run(uuidv4(), doctor.id, slot.day_of_week, slot.start_time, slot.end_time, slot.slot_duration || 30, slot.is_available !== false ? 1 : 0, now, now);
        }
      });
      insertAll();
    }

    res.json({ success: true, message: 'Availability updated successfully.' });
  } catch (error) {
    console.error('UpdateAvailability error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get doctor analytics
 * GET /api/doctors/analytics
 */
const getDoctorAnalytics = async (req, res) => {
  try {
    const doctor = db.prepare('SELECT id FROM doctors WHERE user_id = ?').get(req.user.id);
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });

    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const todayCount = db.prepare(`SELECT COUNT(*) AS count FROM appointments WHERE doctor_id = ? AND appointment_date = ?`).get(doctor.id, today)?.count || 0;
    const totalPatients = db.prepare(`SELECT COUNT(*) AS count FROM appointments WHERE doctor_id = ? AND status = 'completed'`).get(doctor.id)?.count || 0;
    const pendingCount = db.prepare(`SELECT COUNT(*) AS count FROM appointments WHERE doctor_id = ? AND status = 'pending'`).get(doctor.id)?.count || 0;

    const recentAppts = db.prepare(
      `SELECT appointment_date, status FROM appointments WHERE doctor_id = ? AND appointment_date >= ? ORDER BY appointment_date`
    ).all(doctor.id, thirtyDaysAgo);

    const appointmentsByDate = {};
    recentAppts.forEach(apt => {
      const date = apt.appointment_date;
      appointmentsByDate[date] = (appointmentsByDate[date] || 0) + 1;
    });

    res.json({
      success: true,
      data: { today_appointments: todayCount, total_patients: totalPatients, pending_appointments: pendingCount, appointments_by_date: appointmentsByDate }
    });
  } catch (error) {
    console.error('GetDoctorAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get doctor's patients list
 * GET /api/doctors/patients
 */
const getDoctorPatients = async (req, res) => {
  try {
    const doctor = db.prepare('SELECT id FROM doctors WHERE user_id = ?').get(req.user.id);
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });

    const patients = db.prepare(`
      SELECT DISTINCT p.*, u.full_name, u.email, u.phone, u.avatar_url
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN users u ON p.user_id = u.id
      WHERE a.doctor_id = ? AND a.status = 'completed'
    `).all(doctor.id);

    res.json({ success: true, data: patients });
  } catch (error) {
    console.error('GetDoctorPatients error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getAllDoctors, getDoctorById, getDoctorProfile, updateDoctorProfile, updateAvailability, getDoctorAnalytics, getDoctorPatients };
