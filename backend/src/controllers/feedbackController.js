/**
 * Feedback Controller
 * Uses SQLite via better-sqlite3
 */

const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');

const submitFeedback = async (req, res) => {
  try {
    const { appointment_id, rating, comment } = req.body;

    if (!appointment_id || !rating) return res.status(400).json({ success: false, message: 'appointment_id and rating are required.' });
    if (rating < 1 || rating > 5) return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });

    const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient profile not found.' });

    const appointment = db.prepare('SELECT id, doctor_id, status, patient_id FROM appointments WHERE id = ?').get(appointment_id);
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found.' });
    if (appointment.patient_id !== patient.id) return res.status(403).json({ success: false, message: 'Not your appointment.' });
    if (appointment.status !== 'completed') return res.status(400).json({ success: false, message: 'Can only review completed appointments.' });

    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id FROM feedback WHERE appointment_id = ?').get(appointment_id);

    let feedback;
    if (existing) {
      db.prepare('UPDATE feedback SET rating = ?, comment = ? WHERE appointment_id = ?').run(parseInt(rating), comment?.trim() || null, appointment_id);
      feedback = db.prepare('SELECT * FROM feedback WHERE appointment_id = ?').get(appointment_id);
    } else {
      const id = uuidv4();
      db.prepare(`INSERT INTO feedback (id, appointment_id, patient_id, doctor_id, rating, comment, created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(id, appointment_id, patient.id, appointment.doctor_id, parseInt(rating), comment?.trim() || null, now);
      feedback = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id);
    }

    // Recalculate doctor rating
    const avgRow = db.prepare('SELECT AVG(rating) AS avg FROM feedback WHERE doctor_id = ?').get(appointment.doctor_id);
    if (avgRow?.avg) {
      db.prepare('UPDATE doctors SET rating = ? WHERE id = ?').run(Math.round(avgRow.avg * 100) / 100, appointment.doctor_id);
    }

    res.status(201).json({ success: true, message: 'Thank you for your feedback!', data: feedback });
  } catch (err) {
    console.error('SubmitFeedback error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getFeedbackByAppointment = async (req, res) => {
  try {
    const feedback = db.prepare('SELECT * FROM feedback WHERE appointment_id = ?').get(req.params.appointmentId);
    res.json({ success: true, data: feedback || null });
  } catch (err) {
    console.error('GetFeedback error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getDoctorFeedback = async (req, res) => {
  try {
    const doctor = db.prepare('SELECT id, rating FROM doctors WHERE user_id = ?').get(req.user.id);
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });

    const feedbacks = db.prepare(`
      SELECT f.*,
        u.full_name AS patient_name, u.avatar_url AS patient_avatar,
        a.appointment_date, a.reason
      FROM feedback f
      JOIN patients p ON f.patient_id = p.id
      JOIN users u ON p.user_id = u.id
      JOIN appointments a ON f.appointment_id = a.id
      WHERE f.doctor_id = ?
      ORDER BY f.created_at DESC
    `).all(doctor.id);

    const avg = feedbacks.length
      ? (feedbacks.reduce((s, f) => s + f.rating, 0) / feedbacks.length).toFixed(1)
      : doctor.rating;

    res.json({ success: true, data: feedbacks, average_rating: parseFloat(avg), total_reviews: feedbacks.length });
  } catch (err) {
    console.error('GetDoctorFeedback error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { submitFeedback, getFeedbackByAppointment, getDoctorFeedback };
