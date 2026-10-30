/**
 * Queue Controller
 * Uses SQLite via better-sqlite3
 */

const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');

const getDoctorQueue = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { date } = req.query;
    const queueDate = date || new Date().toISOString().split('T')[0];

    const queue = db.prepare(`
      SELECT qt.*,
        u.full_name AS patient_name, u.avatar_url AS patient_avatar,
        a.appointment_time, a.reason, a.type
      FROM queue_tokens qt
      JOIN patients p ON qt.patient_id = p.id
      JOIN users u ON p.user_id = u.id
      JOIN appointments a ON qt.appointment_id = a.id
      WHERE qt.doctor_id = ? AND qt.appointment_date = ?
      ORDER BY qt.token_number
    `).all(doctorId, queueDate);

    const stats = {
      total: queue.length,
      waiting: queue.filter(q => q.status === 'waiting').length,
      in_progress: queue.filter(q => q.status === 'in_progress').length,
      completed: queue.filter(q => q.status === 'completed').length,
      current_token: queue.find(q => q.status === 'in_progress')?.token_code || null
    };

    res.json({ success: true, data: queue, stats });
  } catch (error) {
    console.error('GetDoctorQueue error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getQueuePosition = async (req, res) => {
  try {
    const token = db.prepare(`
      SELECT qt.*, a.appointment_date, a.doctor_id
      FROM queue_tokens qt JOIN appointments a ON qt.appointment_id = a.id
      WHERE qt.appointment_id = ?
    `).get(req.params.appointmentId);

    if (!token) return res.status(404).json({ success: false, message: 'Queue token not found.' });

    const aheadCount = db.prepare(`
      SELECT COUNT(*) AS count FROM queue_tokens
      WHERE doctor_id = ? AND appointment_date = ? AND token_number < ? AND status IN ('waiting','in_progress')
    `).get(token.doctor_id, token.appointment_date, token.token_number)?.count || 0;

    const estimatedWait = aheadCount * 15;

    res.json({
      success: true,
      data: {
        token_code: token.token_code,
        token_number: token.token_number,
        status: token.status,
        position: aheadCount + 1,
        people_ahead: aheadCount,
        estimated_wait_minutes: estimatedWait
      }
    });
  } catch (error) {
    console.error('GetQueuePosition error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const updateQueueStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const now = new Date().toISOString();
    db.prepare('UPDATE queue_tokens SET status = ?, updated_at = ? WHERE id = ?').run(status, now, req.params.tokenId);
    const token = db.prepare('SELECT * FROM queue_tokens WHERE id = ?').get(req.params.tokenId);
    res.json({ success: true, message: 'Queue updated.', data: token });
  } catch (error) {
    console.error('UpdateQueueStatus error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const callNextPatient = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    // Complete current in-progress
    db.prepare(`UPDATE queue_tokens SET status = 'completed', updated_at = ? WHERE doctor_id = ? AND appointment_date = ? AND status = 'in_progress'`)
      .run(now, doctorId, today);

    // Get next waiting
    const nextToken = db.prepare(`
      SELECT qt.*, u.full_name AS patient_name, p.user_id AS patient_user_id
      FROM queue_tokens qt
      JOIN patients p ON qt.patient_id = p.id
      JOIN users u ON p.user_id = u.id
      WHERE qt.doctor_id = ? AND qt.appointment_date = ? AND qt.status = 'waiting'
      ORDER BY qt.token_number LIMIT 1
    `).get(doctorId, today);

    if (!nextToken) return res.json({ success: true, message: 'No more patients in queue.', data: null });

    db.prepare(`UPDATE queue_tokens SET status = 'in_progress', updated_at = ? WHERE id = ?`).run(now, nextToken.id);

    // Notify patient
    if (nextToken.patient_user_id) {
      db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)`)
        .run(uuidv4(), nextToken.patient_user_id, 'Your Turn!', `Token ${nextToken.token_code} - Please proceed to the doctor's room.`, 'queue', now);
    }

    res.json({ success: true, message: `Now calling token ${nextToken.token_code}`, data: nextToken });
  } catch (error) {
    console.error('CallNextPatient error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getDoctorQueue, getQueuePosition, updateQueueStatus, callNextPatient };
