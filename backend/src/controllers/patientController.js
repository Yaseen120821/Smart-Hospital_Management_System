/**
 * Patient Controller
 * Uses SQLite via better-sqlite3
 */

const { db } = require('../config/database');
const { getPagination } = require('../utils/helpers');

const getPatientProfile = async (req, res) => {
  try {
    const patient = db.prepare(`
      SELECT p.*, u.id AS user_uid, u.full_name, u.email, u.phone, u.avatar_url, u.created_at AS user_created_at
      FROM patients p JOIN users u ON p.user_id = u.id WHERE p.user_id = ?
    `).get(req.user.id);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient profile not found.' });
    patient.users = { id: patient.user_uid, full_name: patient.full_name, email: patient.email, phone: patient.phone, avatar_url: patient.avatar_url, created_at: patient.user_created_at };
    res.json({ success: true, data: patient });
  } catch (error) {
    console.error('GetPatientProfile error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const updatePatientProfile = async (req, res) => {
  try {
    const { date_of_birth, gender, blood_group, address, emergency_contact, allergies, medical_history } = req.body;
    const now = new Date().toISOString();
    db.prepare(`UPDATE patients SET date_of_birth=?, gender=?, blood_group=?, address=?, emergency_contact=?, allergies=?, medical_history=?, updated_at=? WHERE user_id=?`)
      .run(date_of_birth, gender, blood_group, address, emergency_contact, allergies, medical_history, now, req.user.id);
    const patient = db.prepare('SELECT * FROM patients WHERE user_id = ?').get(req.user.id);
    res.json({ success: true, message: 'Profile updated.', data: patient });
  } catch (error) {
    console.error('UpdatePatientProfile error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getPatientDashboard = async (req, res) => {
  try {
    const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });

    const today = new Date().toISOString().split('T')[0];

    const upcomingAppointments = db.prepare(`
      SELECT a.*, d.specialization, du.full_name AS doctor_name, du.avatar_url AS doctor_avatar, dept.name AS department_name
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      WHERE a.patient_id = ? AND a.appointment_date >= ? AND a.status IN ('pending','confirmed')
      ORDER BY a.appointment_date LIMIT 5
    `).all(patient.id, today);

    const totalAppointments = db.prepare(`SELECT COUNT(*) AS count FROM appointments WHERE patient_id = ?`).get(patient.id)?.count || 0;
    const completedAppointments = db.prepare(`SELECT COUNT(*) AS count FROM appointments WHERE patient_id = ? AND status = 'completed'`).get(patient.id)?.count || 0;

    const recentPrescriptions = db.prepare(`
      SELECT pr.*, du.full_name AS doctor_name
      FROM prescriptions pr
      JOIN doctors d ON pr.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      WHERE pr.patient_id = ? ORDER BY pr.created_at DESC LIMIT 3
    `).all(patient.id).map(p => ({ ...p, medicines: tryParse(p.medicines, []) }));

    const pendingBills = db.prepare(`SELECT * FROM billing WHERE patient_id = ? AND payment_status = 'pending' LIMIT 5`).all(patient.id);
    const unreadNotifications = db.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0`).get(req.user.id)?.count || 0;

    res.json({
      success: true,
      data: { upcoming_appointments: upcomingAppointments, total_appointments: totalAppointments, completed_appointments: completedAppointments, recent_prescriptions: recentPrescriptions, pending_bills: pendingBills, unread_notifications: unreadNotifications }
    });
  } catch (error) {
    console.error('GetPatientDashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getAllPatients = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const { offset } = getPagination(page, limit);

    let where = '';
    let params = [];
    if (search) {
      where = `WHERE u.full_name LIKE ? OR u.email LIKE ?`;
      params = [`%${search}%`, `%${search}%`];
    }

    const total = db.prepare(`SELECT COUNT(*) AS count FROM patients p JOIN users u ON p.user_id = u.id ${where}`).get(...params)?.count || 0;
    const patients = db.prepare(`
      SELECT p.*, u.id AS user_uid, u.full_name, u.email, u.phone, u.avatar_url, u.is_active, u.created_at AS user_created_at
      FROM patients p JOIN users u ON p.user_id = u.id ${where}
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));

    const shaped = patients.map(p => ({
      ...p,
      users: { id: p.user_uid, full_name: p.full_name, email: p.email, phone: p.phone, avatar_url: p.avatar_url, is_active: p.is_active, created_at: p.user_created_at }
    }));

    res.json({ success: true, data: shaped, pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('GetAllPatients error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getPatientById = async (req, res) => {
  try {
    const patient = db.prepare(`
      SELECT p.*, u.id AS user_uid, u.full_name, u.email, u.phone, u.avatar_url
      FROM patients p JOIN users u ON p.user_id = u.id WHERE p.id = ?
    `).get(req.params.id);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });

    const appointments = db.prepare(`
      SELECT a.*, du.full_name AS doctor_name, dept.name AS department_name
      FROM appointments a JOIN doctors d ON a.doctor_id = d.id JOIN users du ON d.user_id = du.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      WHERE a.patient_id = ? ORDER BY a.appointment_date DESC LIMIT 10
    `).all(patient.id);

    const prescriptions = db.prepare(`
      SELECT pr.*, du.full_name AS doctor_name FROM prescriptions pr
      JOIN doctors d ON pr.doctor_id = d.id JOIN users du ON d.user_id = du.id
      WHERE pr.patient_id = ? ORDER BY pr.created_at DESC LIMIT 5
    `).all(patient.id).map(p => ({ ...p, medicines: tryParse(p.medicines, []) }));

    res.json({ success: true, data: { ...patient, appointments, prescriptions } });
  } catch (error) {
    console.error('GetPatientById error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

function tryParse(val, fallback) {
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
}

module.exports = { getPatientProfile, updatePatientProfile, getPatientDashboard, getAllPatients, getPatientById };
