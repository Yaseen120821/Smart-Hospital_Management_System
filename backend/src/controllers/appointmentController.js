/**
 * Appointment Controller
 * Handles all appointment-related operations
 * Uses SQLite via better-sqlite3
 */

const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const { generateQueueToken, getPagination } = require('../utils/helpers');
const { sendAppointmentConfirmation } = require('../utils/emailService');

/**
 * Book a new appointment
 * POST /api/appointments
 */
const bookAppointment = async (req, res) => {
  try {
    const { doctor_id, appointment_date, appointment_time, reason, type = 'regular' } = req.body;

    // Get patient profile
    const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient profile not found.' });

    // Check doctor exists
    const doctor = db.prepare(`
      SELECT d.*, u.full_name AS doctor_name, u.email AS doctor_email, u.id AS user_uid,
             dept.name AS dept_name
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      WHERE d.id = ?
    `).get(doctor_id);
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });

    // Check for double booking - same doctor, date, time
    const existingAppt = db.prepare(
      `SELECT id FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'cancelled'`
    ).get(doctor_id, appointment_date, appointment_time);
    if (existingAppt) {
      return res.status(409).json({ success: false, message: 'This time slot is already booked. Please choose another time.' });
    }

    // Check if patient already has appointment at same time
    const patientConflict = db.prepare(
      `SELECT id FROM appointments WHERE patient_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'cancelled'`
    ).get(patient.id, appointment_date, appointment_time);
    if (patientConflict) {
      return res.status(409).json({ success: false, message: 'You already have an appointment at this time.' });
    }

    // Generate queue token
    const countRow = db.prepare(
      `SELECT COUNT(*) AS count FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status != 'cancelled'`
    ).get(doctor_id, appointment_date);
    const tokenNumber = (countRow?.count || 0) + 1;
    const queueToken = generateQueueToken('T', tokenNumber);

    const appointmentId = uuidv4();
    const now = new Date().toISOString();

    // Create appointment
    db.prepare(
      `INSERT INTO appointments (id, patient_id, doctor_id, appointment_date, appointment_time, reason, type, status, queue_token, token_number, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(appointmentId, patient.id, doctor_id, appointment_date, appointment_time, reason, type, 'pending', queueToken, tokenNumber, now, now);

    // Create queue token record
    db.prepare(
      `INSERT INTO queue_tokens (id, appointment_id, doctor_id, patient_id, token_number, token_code, appointment_date, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(uuidv4(), appointmentId, doctor_id, patient.id, tokenNumber, queueToken, appointment_date, 'waiting', now, now);

    // Notify patient
    db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)`)
      .run(uuidv4(), req.user.id, 'Appointment Booked',
        `Your appointment with Dr. ${doctor.doctor_name} on ${appointment_date} at ${appointment_time} has been booked. Token: ${queueToken}`,
        'appointment', now);

    // Notify doctor
    db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)`)
      .run(uuidv4(), doctor.user_uid, 'New Appointment',
        `New appointment booked by ${req.user.full_name} on ${appointment_date} at ${appointment_time}`,
        'appointment', now);

    // Send confirmation email (non-blocking)
    sendAppointmentConfirmation(req.user.email, {
      patientName: req.user.full_name,
      doctorName: doctor.doctor_name,
      department: doctor.dept_name || 'General',
      date: appointment_date,
      time: appointment_time,
      token: queueToken
    }).catch(console.error);

    const appointment = db.prepare(`
      SELECT a.*,
        d.specialization, d.consultation_fee,
        du.full_name AS doctor_name, du.avatar_url AS doctor_avatar,
        dept.name AS department_name,
        pu.full_name AS patient_name, pu.email AS patient_email
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      JOIN patients p ON a.patient_id = p.id
      JOIN users pu ON p.user_id = pu.id
      WHERE a.id = ?
    `).get(appointmentId);

    res.status(201).json({ success: true, message: 'Appointment booked successfully!', data: appointment });
  } catch (error) {
    console.error('BookAppointment error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get appointments (filtered by role)
 * GET /api/appointments
 */
const getAppointments = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, date } = req.query;
    const { offset } = getPagination(page, limit);

    let conditions = [];
    let params = [];

    if (req.user.role === 'patient') {
      const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
      if (patient) { conditions.push('a.patient_id = ?'); params.push(patient.id); }
    } else if (req.user.role === 'doctor') {
      const doctor = db.prepare('SELECT id FROM doctors WHERE user_id = ?').get(req.user.id);
      if (doctor) { conditions.push('a.doctor_id = ?'); params.push(doctor.id); }
    }

    if (status) { conditions.push('a.status = ?'); params.push(status); }
    if (date) { conditions.push('a.appointment_date = ?'); params.push(date); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const appointments = db.prepare(`
      SELECT a.*,
        d.specialization, d.consultation_fee,
        du.full_name AS doctor_name, du.avatar_url AS doctor_avatar,
        dept.name AS department_name,
        pu.full_name AS patient_name, pu.email AS patient_email,
        pu.phone AS patient_phone, pu.avatar_url AS patient_avatar,
        p.blood_group
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      JOIN patients p ON a.patient_id = p.id
      JOIN users pu ON p.user_id = pu.id
      ${where}
      ORDER BY a.appointment_date DESC, a.appointment_time ASC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));

    const totalRow = db.prepare(`
      SELECT COUNT(*) AS count
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN patients p ON a.patient_id = p.id
      ${where}
    `).get(...params);
    const total = totalRow?.count || 0;

    res.json({
      success: true,
      data: appointments,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('GetAppointments error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get single appointment
 * GET /api/appointments/:id
 */
const getAppointment = async (req, res) => {
  try {
    const appointment = db.prepare(`
      SELECT a.*,
        d.specialization, d.consultation_fee, d.bio,
        du.full_name AS doctor_name, du.email AS doctor_email, du.phone AS doctor_phone, du.avatar_url AS doctor_avatar,
        dept.name AS department_name,
        pu.full_name AS patient_name, pu.email AS patient_email, pu.phone AS patient_phone, pu.avatar_url AS patient_avatar,
        p.blood_group, p.gender, p.date_of_birth
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      JOIN patients p ON a.patient_id = p.id
      JOIN users pu ON p.user_id = pu.id
      WHERE a.id = ?
    `).get(req.params.id);

    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found.' });

    // Attach prescriptions and billing
    appointment.prescriptions = db.prepare('SELECT * FROM prescriptions WHERE appointment_id = ?').all(req.params.id);
    appointment.billing = db.prepare('SELECT * FROM billing WHERE appointment_id = ?').all(req.params.id);

    res.json({ success: true, data: appointment });
  } catch (error) {
    console.error('GetAppointment error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Update appointment status
 * PUT /api/appointments/:id/status
 */
const updateAppointmentStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const validStatuses = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
    if (!validStatuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });

    const now = new Date().toISOString();
    const completedAt = status === 'completed' ? now : null;

    db.prepare(
      `UPDATE appointments SET status = ?, doctor_notes = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`
    ).run(status, notes, now, completedAt, req.params.id);

    // Update queue token
    if (status === 'in_progress') {
      db.prepare(`UPDATE queue_tokens SET status = 'in_progress', updated_at = ? WHERE appointment_id = ?`).run(now, req.params.id);
    } else if (status === 'completed') {
      db.prepare(`UPDATE queue_tokens SET status = 'completed', updated_at = ? WHERE appointment_id = ?`).run(now, req.params.id);
    }

    const appointment = db.prepare(`
      SELECT a.*, p.user_id AS patient_user_id,
        pu.full_name AS patient_name, du.full_name AS doctor_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN users pu ON p.user_id = pu.id
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      WHERE a.id = ?
    `).get(req.params.id);

    // Notify patient
    if (appointment?.patient_user_id) {
      db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)`)
        .run(uuidv4(), appointment.patient_user_id, 'Appointment Update', `Your appointment status has been updated to: ${status}`, 'appointment', now);
    }

    res.json({ success: true, message: `Appointment ${status} successfully.`, data: appointment });
  } catch (error) {
    console.error('UpdateAppointmentStatus error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Cancel appointment
 * DELETE /api/appointments/:id
 */
const cancelAppointment = async (req, res) => {
  try {
    const appointment = db.prepare(`
      SELECT a.*, p.user_id AS patient_user_id
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE a.id = ?
    `).get(req.params.id);

    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found.' });

    if (req.user.role === 'patient' && appointment.patient_user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, req.params.id);
    db.prepare(`UPDATE queue_tokens SET status = 'cancelled', updated_at = ? WHERE appointment_id = ?`).run(now, req.params.id);

    res.json({ success: true, message: 'Appointment cancelled successfully.' });
  } catch (error) {
    console.error('CancelAppointment error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get available time slots for a doctor on a date
 * GET /api/appointments/slots/:doctorId
 */
const getAvailableSlots = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'Date is required.' });

    const dayOfWeek = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const availability = db.prepare(
      `SELECT * FROM doctor_availability WHERE doctor_id = ? AND day_of_week = ? AND is_available = 1`
    ).get(doctorId, dayOfWeek);

    if (!availability) return res.json({ success: true, data: [], message: 'Doctor not available on this day.' });

    const { generateTimeSlots } = require('../utils/helpers');
    const allSlots = generateTimeSlots(availability.start_time, availability.end_time, availability.slot_duration || 30);

    const booked = db.prepare(
      `SELECT appointment_time FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status != 'cancelled'`
    ).all(doctorId, date);
    const bookedTimes = booked.map(a => a.appointment_time);

    const availableSlots = allSlots.map(slot => ({ time: slot, available: !bookedTimes.includes(slot) }));

    res.json({ success: true, data: availableSlots });
  } catch (error) {
    console.error('GetAvailableSlots error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get today's appointments
 * GET /api/appointments/today
 */
const getTodayAppointments = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    let conditions = ['a.appointment_date = ?'];
    let params = [today];

    if (req.user.role === 'doctor') {
      const doctor = db.prepare('SELECT id FROM doctors WHERE user_id = ?').get(req.user.id);
      if (doctor) { conditions.push('a.doctor_id = ?'); params.push(doctor.id); }
    }

    const appointments = db.prepare(`
      SELECT a.*,
        du.full_name AS doctor_name,
        pu.full_name AS patient_name
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      JOIN patients p ON a.patient_id = p.id
      JOIN users pu ON p.user_id = pu.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.appointment_time
    `).all(...params);

    res.json({ success: true, data: appointments });
  } catch (error) {
    console.error('GetTodayAppointments error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  bookAppointment, getAppointments, getAppointment,
  updateAppointmentStatus, cancelAppointment, getAvailableSlots, getTodayAppointments
};
