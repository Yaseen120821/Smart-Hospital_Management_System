/**
 * Admin Controller
 * Handles admin dashboard, analytics, and management operations
 * Uses SQLite via better-sqlite3
 */

const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');

/**
 * Get admin dashboard stats
 * GET /api/admin/dashboard
 */
const getDashboardStats = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().slice(0, 7);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const totalPatients = db.prepare('SELECT COUNT(*) AS count FROM patients').get()?.count || 0;
    const totalDoctors = db.prepare('SELECT COUNT(*) AS count FROM doctors').get()?.count || 0;
    const todayAppointments = db.prepare(`SELECT COUNT(*) AS count FROM appointments WHERE appointment_date = ?`).get(today)?.count || 0;
    const totalAppointments = db.prepare('SELECT COUNT(*) AS count FROM appointments').get()?.count || 0;
    const pendingAppointments = db.prepare(`SELECT COUNT(*) AS count FROM appointments WHERE status = 'pending'`).get()?.count || 0;
    const emergencyCases = db.prepare(`SELECT COUNT(*) AS count FROM emergency_cases WHERE status = 'active'`).get()?.count || 0;

    // Revenue this month
    const billingData = db.prepare(`SELECT amount FROM billing WHERE payment_status = 'paid' AND created_at >= ?`).all(`${thisMonth}-01`);
    const monthlyRevenue = billingData.reduce((sum, b) => sum + (b.amount || 0), 0);

    // Recent appointments
    const recentAppointments = db.prepare(`
      SELECT a.*,
        pu.full_name AS patient_name,
        du.full_name AS doctor_name,
        dept.name AS department_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN users pu ON p.user_id = pu.id
      JOIN doctors d ON a.doctor_id = d.id
      JOIN users du ON d.user_id = du.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      ORDER BY a.created_at DESC
      LIMIT 10
    `).all();

    // Department stats
    const deptAppts = db.prepare(`
      SELECT dept.name AS dept_name, COUNT(*) AS count
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      WHERE a.appointment_date >= ?
      GROUP BY dept.id
    `).all(thirtyDaysAgo);
    const deptStats = {};
    deptAppts.forEach(r => { deptStats[r.dept_name || 'Unknown'] = r.count; });

    // Daily stats (last 7 days)
    const weeklyData = db.prepare(`
      SELECT appointment_date, COUNT(*) AS count FROM appointments
      WHERE appointment_date >= ?
      GROUP BY appointment_date
    `).all(sevenDaysAgo);
    const dailyStats = {};
    weeklyData.forEach(r => { dailyStats[r.appointment_date] = r.count; });

    // Beds
    const beds = db.prepare('SELECT status FROM beds').all();
    const bedStats = {
      total: beds.length,
      available: beds.filter(b => b.status === 'available').length,
      occupied: beds.filter(b => b.status === 'occupied').length,
      maintenance: beds.filter(b => b.status === 'maintenance').length
    };

    res.json({
      success: true,
      data: {
        stats: { total_patients: totalPatients, total_doctors: totalDoctors, today_appointments: todayAppointments, total_appointments: totalAppointments, pending_appointments: pendingAppointments, emergency_cases: emergencyCases, monthly_revenue: monthlyRevenue },
        recent_appointments: recentAppointments,
        department_stats: deptStats,
        daily_stats: dailyStats,
        bed_stats: bedStats
      }
    });
  } catch (error) {
    console.error('GetDashboardStats error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get revenue analytics
 * GET /api/admin/revenue
 */
const getRevenueAnalytics = async (req, res) => {
  try {
    const billingData = db.prepare(`SELECT amount, payment_status, payment_method, created_at FROM billing ORDER BY created_at DESC`).all();

    const monthlyRevenue = {};
    billingData.forEach(bill => {
      const month = bill.created_at?.slice(0, 7);
      if (!monthlyRevenue[month]) monthlyRevenue[month] = { total: 0, paid: 0, pending: 0 };
      monthlyRevenue[month].total += bill.amount || 0;
      if (bill.payment_status === 'paid') monthlyRevenue[month].paid += bill.amount || 0;
      else monthlyRevenue[month].pending += bill.amount || 0;
    });

    const paymentMethods = {};
    billingData.filter(b => b.payment_status === 'paid').forEach(bill => {
      const method = bill.payment_method || 'cash';
      paymentMethods[method] = (paymentMethods[method] || 0) + (bill.amount || 0);
    });

    const totalRevenue = billingData.filter(b => b.payment_status === 'paid').reduce((s, b) => s + (b.amount || 0), 0);
    const pendingRevenue = billingData.filter(b => b.payment_status === 'pending').reduce((s, b) => s + (b.amount || 0), 0);

    res.json({ success: true, data: { total_revenue: totalRevenue, pending_revenue: pendingRevenue, monthly_revenue: monthlyRevenue, payment_methods: paymentMethods } });
  } catch (error) {
    console.error('GetRevenueAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Manage doctors
 * GET /api/admin/doctors
 */
const manageDoctors = async (req, res) => {
  try {
    const doctors = db.prepare(`
      SELECT d.*,
        u.id AS user_uid, u.full_name, u.email, u.phone, u.avatar_url, u.is_active, u.created_at AS user_created_at,
        dept.name AS dept_name
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN departments dept ON d.department_id = dept.id
      ORDER BY d.created_at DESC
    `).all();

    const shaped = doctors.map(d => ({
      ...d,
      users: { id: d.user_uid, full_name: d.full_name, email: d.email, phone: d.phone, avatar_url: d.avatar_url, is_active: d.is_active, created_at: d.user_created_at },
      departments: d.dept_name ? { name: d.dept_name } : null
    }));

    res.json({ success: true, data: shaped });
  } catch (error) {
    console.error('ManageDoctors error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Delete doctor
 * DELETE /api/admin/doctors/:id
 */
const deleteDoctor = async (req, res) => {
  try {
    const doctor = db.prepare(`SELECT d.id, d.user_id, u.full_name FROM doctors d JOIN users u ON d.user_id = u.id WHERE d.id = ?`).get(req.params.id);
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });

    db.prepare('DELETE FROM doctors WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(doctor.user_id);

    res.json({ success: true, message: `Dr. ${doctor.full_name} has been permanently deleted.` });
  } catch (error) {
    console.error('DeleteDoctor error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Toggle user active status
 * PUT /api/admin/users/:id/toggle
 */
const toggleUserStatus = async (req, res) => {
  try {
    const user = db.prepare('SELECT is_active FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const newStatus = user.is_active ? 0 : 1;
    db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(newStatus, new Date().toISOString(), req.params.id);

    const updatedUser = db.prepare('SELECT id, full_name, is_active FROM users WHERE id = ?').get(req.params.id);
    res.json({ success: true, message: `User ${updatedUser.is_active ? 'activated' : 'deactivated'} successfully.`, data: updatedUser });
  } catch (error) {
    console.error('ToggleUserStatus error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get departments
 * GET /api/admin/departments
 */
const getDepartments = async (req, res) => {
  try {
    const departments = db.prepare('SELECT * FROM departments ORDER BY name').all();
    res.json({ success: true, data: departments });
  } catch (error) {
    console.error('GetDepartments error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Create department
 * POST /api/admin/departments
 */
const createDepartment = async (req, res) => {
  try {
    const { name, description, head_doctor_id, floor, room_numbers } = req.body;
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO departments (id, name, description, head_doctor_id, floor, room_numbers, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, name, description, head_doctor_id || null, floor, room_numbers, now, now);
    const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
    res.status(201).json({ success: true, message: 'Department created.', data: dept });
  } catch (error) {
    console.error('CreateDepartment error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Manage beds
 * GET /api/admin/beds
 */
const manageBeds = async (req, res) => {
  try {
    const beds = db.prepare(`
      SELECT b.*,
        dept.name AS dept_name,
        pu.full_name AS patient_name
      FROM beds b
      LEFT JOIN departments dept ON b.department_id = dept.id
      LEFT JOIN patients p ON b.patient_id = p.id
      LEFT JOIN users pu ON p.user_id = pu.id
      ORDER BY b.bed_number
    `).all();

    const stats = {
      total: beds.length,
      available: beds.filter(b => b.status === 'available').length,
      occupied: beds.filter(b => b.status === 'occupied').length,
      maintenance: beds.filter(b => b.status === 'maintenance').length
    };

    res.json({ success: true, data: beds, stats });
  } catch (error) {
    console.error('ManageBeds error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Update bed status
 * PUT /api/admin/beds/:id
 */
const updateBedStatus = async (req, res) => {
  try {
    const { status, patient_id } = req.body;
    const now = new Date().toISOString();
    const pid = status === 'available' ? null : (patient_id || null);
    db.prepare('UPDATE beds SET status = ?, patient_id = ?, updated_at = ? WHERE id = ?').run(status, pid, now, req.params.id);
    const bed = db.prepare('SELECT * FROM beds WHERE id = ?').get(req.params.id);
    res.json({ success: true, message: 'Bed status updated.', data: bed });
  } catch (error) {
    console.error('UpdateBedStatus error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Get emergency cases
 * GET /api/admin/emergency
 */
const getEmergencyCases = async (req, res) => {
  try {
    const cases = db.prepare(`
      SELECT ec.*,
        pu.full_name AS patient_name, pu.phone AS patient_phone,
        du.full_name AS doctor_name
      FROM emergency_cases ec
      LEFT JOIN patients p ON ec.patient_id = p.id
      LEFT JOIN users pu ON p.user_id = pu.id
      LEFT JOIN doctors d ON ec.doctor_id = d.id
      LEFT JOIN users du ON d.user_id = du.id
      ORDER BY ec.created_at DESC
    `).all();
    res.json({ success: true, data: cases });
  } catch (error) {
    console.error('GetEmergencyCases error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/**
 * Create emergency case
 * POST /api/admin/emergency
 */
const createEmergencyCase = async (req, res) => {
  try {
    const { patient_id, doctor_id, description, severity, location } = req.body;
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO emergency_cases (id, patient_id, doctor_id, description, severity, location, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, patient_id || null, doctor_id || null, description, severity || 'high', location || null, 'active', now, now);

    const emergencyCase = db.prepare('SELECT * FROM emergency_cases WHERE id = ?').get(id);

    // Notify all doctors
    const doctors = db.prepare('SELECT user_id FROM doctors').all();
    const insertNotif = db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)`);
    const notifyDoctors = db.transaction(() => {
      for (const doc of doctors) {
        insertNotif.run(uuidv4(), doc.user_id, '🚨 Emergency Alert', `Emergency case reported: ${description}. Severity: ${severity}`, 'emergency', now);
      }
    });
    notifyDoctors();

    res.status(201).json({ success: true, message: 'Emergency case created.', data: emergencyCase });
  } catch (error) {
    console.error('CreateEmergencyCase error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  getDashboardStats, getRevenueAnalytics, manageDoctors, toggleUserStatus,
  deleteDoctor, getDepartments, createDepartment, manageBeds, updateBedStatus,
  getEmergencyCases, createEmergencyCase
};
