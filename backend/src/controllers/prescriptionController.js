/**
 * Prescription Controller
 * Uses SQLite via better-sqlite3
 */

const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');

const createPrescription = async (req, res) => {
  try {
    const { appointment_id, patient_id, diagnosis, medicines, instructions, follow_up_date, notes } = req.body;

    const doctor = db.prepare('SELECT id FROM doctors WHERE user_id = ?').get(req.user.id);
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO prescriptions (id, appointment_id, patient_id, doctor_id, diagnosis, medicines, instructions, follow_up_date, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, appointment_id || null, patient_id, doctor.id, diagnosis, JSON.stringify(medicines || []), instructions, follow_up_date || null, notes, now, now);

    const prescription = db.prepare(`
      SELECT pr.*,
        du.full_name AS doctor_name, d.specialization, dept.name AS dept_name,
        pu.full_name AS patient_name, pu.email AS patient_email, p.user_id AS patient_user_id
      FROM prescriptions pr
      JOIN doctors d ON pr.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      JOIN patients p ON pr.patient_id = p.id
      JOIN users pu ON p.user_id = pu.id
      WHERE pr.id = ?
    `).get(id);

    // Notify patient
    if (prescription?.patient_user_id) {
      db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)`)
        .run(uuidv4(), prescription.patient_user_id, 'New Prescription', `Dr. ${prescription.doctor_name} has added a new prescription for you.`, 'prescription', now);
    }

    const result = { ...prescription, medicines: tryParse(prescription?.medicines, []) };
    res.status(201).json({ success: true, message: 'Prescription created successfully.', data: result });
  } catch (error) {
    console.error('CreatePrescription error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getPrescriptions = async (req, res) => {
  try {
    let conditions = [];
    let params = [];

    if (req.user.role === 'patient') {
      const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
      if (patient) { conditions.push('pr.patient_id = ?'); params.push(patient.id); }
    } else if (req.user.role === 'doctor') {
      const doctor = db.prepare('SELECT id FROM doctors WHERE user_id = ?').get(req.user.id);
      if (doctor) { conditions.push('pr.doctor_id = ?'); params.push(doctor.id); }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const prescriptions = db.prepare(`
      SELECT pr.*,
        d.id AS doctor_profile_id, d.specialization,
        du.full_name AS doctor_name, du.avatar_url AS doctor_avatar,
        dept.name AS dept_name,
        pu.full_name AS patient_name, pu.email AS patient_email
      FROM prescriptions pr
      JOIN doctors d ON pr.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      JOIN patients p ON pr.patient_id = p.id
      JOIN users pu ON p.user_id = pu.id
      ${where}
      ORDER BY pr.created_at DESC
    `).all(...params);

    const parsed = prescriptions.map(p => ({ ...p, medicines: tryParse(p.medicines, []) }));
    res.json({ success: true, data: parsed });
  } catch (error) {
    console.error('GetPrescriptions error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getPrescription = async (req, res) => {
  try {
    const prescription = db.prepare(`
      SELECT pr.*,
        du.full_name AS doctor_name, du.email AS doctor_email, du.phone AS doctor_phone, du.avatar_url AS doctor_avatar,
        d.specialization, dept.name AS dept_name,
        pu.full_name AS patient_name, pu.email AS patient_email, pu.phone AS patient_phone,
        a.appointment_date, a.appointment_time
      FROM prescriptions pr
      JOIN doctors d ON pr.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      JOIN patients p ON pr.patient_id = p.id
      JOIN users pu ON p.user_id = pu.id
      LEFT JOIN appointments a ON pr.appointment_id = a.id
      WHERE pr.id = ?
    `).get(req.params.id);

    if (!prescription) return res.status(404).json({ success: false, message: 'Prescription not found.' });
    res.json({ success: true, data: { ...prescription, medicines: tryParse(prescription.medicines, []) } });
  } catch (error) {
    console.error('GetPrescription error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const updatePrescription = async (req, res) => {
  try {
    const { diagnosis, medicines, instructions, follow_up_date, notes } = req.body;
    const now = new Date().toISOString();
    db.prepare(`UPDATE prescriptions SET diagnosis=?, medicines=?, instructions=?, follow_up_date=?, notes=?, updated_at=? WHERE id=?`)
      .run(diagnosis, JSON.stringify(medicines || []), instructions, follow_up_date || null, notes, now, req.params.id);
    const prescription = db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(req.params.id);
    res.json({ success: true, message: 'Prescription updated.', data: { ...prescription, medicines: tryParse(prescription?.medicines, []) } });
  } catch (error) {
    console.error('UpdatePrescription error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

function tryParse(val, fallback) {
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
}

module.exports = { createPrescription, getPrescriptions, getPrescription, updatePrescription };
