/**
 * Report Controller
 * Uses SQLite via better-sqlite3
 */

const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const path = require('path');
const fs = require('fs');

const uploadReport = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

    const { title, description, report_type, appointment_id } = req.body;
    const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });

    const id = uuidv4();
    const now = new Date().toISOString();
    const fileUrl = `/uploads/${req.file.filename}`;

    db.prepare(`INSERT INTO reports (id, patient_id, appointment_id, title, description, report_type, file_url, file_name, file_size, mime_type, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, patient.id, appointment_id || null, title, description, report_type || 'general', fileUrl, req.file.originalname, req.file.size, req.file.mimetype, req.user.id, now);

    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    res.status(201).json({ success: true, message: 'Report uploaded.', data: report });
  } catch (error) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    console.error('UploadReport error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getReports = async (req, res) => {
  try {
    let conditions = [];
    let params = [];

    if (req.user.role === 'patient') {
      const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
      if (patient) { conditions.push('r.patient_id = ?'); params.push(patient.id); }
    } else if (req.params.patientId) {
      conditions.push('r.patient_id = ?'); params.push(req.params.patientId);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const reports = db.prepare(`SELECT r.* FROM reports r ${where} ORDER BY r.created_at DESC`).all(...params);
    res.json({ success: true, data: reports });
  } catch (error) {
    console.error('GetReports error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const deleteReport = async (req, res) => {
  try {
    const report = db.prepare(`
      SELECT r.*, p.user_id AS patient_user_id FROM reports r
      LEFT JOIN patients p ON r.patient_id = p.id WHERE r.id = ?
    `).get(req.params.id);

    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });
    if (req.user.role === 'patient' && report.patient_user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const filePath = path.join(__dirname, '../../', report.file_url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Report deleted.' });
  } catch (error) {
    console.error('DeleteReport error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { uploadReport, getReports, deleteReport };
