/**
 * Billing Controller
 * Uses SQLite via better-sqlite3
 */

const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');

const createBill = async (req, res) => {
  try {
    const { appointment_id, patient_id, items, discount = 0, notes } = req.body;
    const subtotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
    const total = subtotal - discount;
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO billing (id, appointment_id, patient_id, items, subtotal, discount, amount, payment_status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, appointment_id || null, patient_id, JSON.stringify(items), subtotal, discount, total, 'pending', notes, now, now);

    const patient = db.prepare('SELECT user_id FROM patients WHERE id = ?').get(patient_id);
    if (patient) {
      db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)`)
        .run(uuidv4(), patient.user_id, 'New Bill Generated', `A bill of ₹${total} has been generated for your appointment.`, 'billing', now);
    }

    const bill = db.prepare('SELECT * FROM billing WHERE id = ?').get(id);
    res.status(201).json({ success: true, message: 'Bill created.', data: { ...bill, items: tryParse(bill?.items, []) } });
  } catch (error) {
    console.error('CreateBill error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getBills = async (req, res) => {
  try {
    let conditions = [];
    let params = [];

    if (req.user.role === 'patient') {
      const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
      if (patient) { conditions.push('b.patient_id = ?'); params.push(patient.id); }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const bills = db.prepare(`
      SELECT b.*,
        pu.full_name AS patient_name, pu.email AS patient_email,
        a.appointment_date,
        du.full_name AS doctor_name
      FROM billing b
      LEFT JOIN patients p ON b.patient_id = p.id
      LEFT JOIN users pu ON p.user_id = pu.id
      LEFT JOIN appointments a ON b.appointment_id = a.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      LEFT JOIN users du ON d.user_id = du.id
      ${where}
      ORDER BY b.created_at DESC
    `).all(...params);

    const parsed = bills.map(b => ({ ...b, items: tryParse(b.items, []) }));
    res.json({ success: true, data: parsed });
  } catch (error) {
    console.error('GetBills error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const processPayment = async (req, res) => {
  try {
    const { payment_method, transaction_id } = req.body;
    const now = new Date().toISOString();
    db.prepare(`UPDATE billing SET payment_status='paid', payment_method=?, transaction_id=?, paid_at=?, updated_at=? WHERE id=?`)
      .run(payment_method, transaction_id, now, now, req.params.id);
    const bill = db.prepare('SELECT * FROM billing WHERE id = ?').get(req.params.id);
    res.json({ success: true, message: 'Payment processed successfully.', data: { ...bill, items: tryParse(bill?.items, []) } });
  } catch (error) {
    console.error('ProcessPayment error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getBill = async (req, res) => {
  try {
    const bill = db.prepare(`
      SELECT b.*,
        pu.full_name AS patient_name, pu.email AS patient_email, pu.phone AS patient_phone,
        a.appointment_date, a.appointment_time,
        du.full_name AS doctor_name, dept.name AS dept_name
      FROM billing b
      LEFT JOIN patients p ON b.patient_id = p.id
      LEFT JOIN users pu ON p.user_id = pu.id
      LEFT JOIN appointments a ON b.appointment_id = a.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      LEFT JOIN users du ON d.user_id = du.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      WHERE b.id = ?
    `).get(req.params.id);

    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found.' });
    res.json({ success: true, data: { ...bill, items: tryParse(bill.items, []) } });
  } catch (error) {
    console.error('GetBill error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

function tryParse(val, fallback) {
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return fallback; }
}

module.exports = { createBill, getBills, processPayment, getBill };
