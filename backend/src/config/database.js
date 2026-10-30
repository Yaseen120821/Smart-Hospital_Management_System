/**
 * SQLite Database Configuration using sql.js (pure JavaScript, no native deps)
 * Replaces Supabase with a local SQLite database
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '../../data/hospital.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ── singleton ──────────────────────────────────────────────
let _db = null;   // sql.js Database instance
let _ready = false;
const _readyCallbacks = [];

// Persist DB to disk periodically & on mutations
let _dirty = false;
const _save = () => {
  if (!_db || !_dirty) return;
  try {
    const data = _db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    _dirty = false;
  } catch (e) {
    console.error('DB save error:', e.message);
  }
};

// Save every 2 seconds if dirty
setInterval(_save, 2000);
process.on('exit', _save);
process.on('SIGINT', () => { _save(); process.exit(); });
process.on('SIGTERM', () => { _save(); process.exit(); });

// ── init ──────────────────────────────────────────────────
const _init = async () => {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
    console.log('✅ SQLite database loaded from disk:', DB_PATH);
  } else {
    _db = new SQL.Database();
    console.log('✅ New SQLite database created at:', DB_PATH);
  }

  // Enable foreign keys
  _db.run('PRAGMA foreign_keys = ON;');

  _initSchema();
  _seedData();
  _ready = true;
  _save(); // initial save
  _readyCallbacks.forEach(cb => cb());
};

const waitReady = () => new Promise(resolve => {
  if (_ready) return resolve();
  _readyCallbacks.push(resolve);
});

/**
 * Execute a SELECT returning all rows as array of objects
 */
const query = (sql, params = []) => {
  if (!_ready) throw new Error('DB not ready');
  return _rawQuery(sql, params);
};

/**
 * Internal query that bypasses the _ready check (used during init/seed)
 */
const _rawQuery = (sql, params = []) => {
  try {
    const stmt = _db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return { data: rows, error: null };
  } catch (error) {
    console.error('DB query error:', error.message, '\nSQL:', sql);
    return { data: null, error };
  }
};

const _rawQueryOne = (sql, params = []) => {
  const { data, error } = _rawQuery(sql, params);
  if (error) return { data: null, error };
  return { data: data?.[0] ?? null, error: null };
};

/**
 * Execute a SELECT returning the first row or null
 */
const queryOne = (sql, params = []) => {
  if (!_ready) throw new Error('DB not ready');
  return _rawQueryOne(sql, params);
};


/**
 * Execute an INSERT / UPDATE / DELETE
 */
const run = (sql, params = []) => {
  if (!_ready) throw new Error('DB not ready');
  try {
    _db.run(sql, params);
    _dirty = true;
    return { error: null };
  } catch (error) {
    console.error('DB run error:', error.message, '\nSQL:', sql);
    return { error };
  }
};

/**
 * Count rows
 */
const count = (sql, params = []) => {
  const { data, error } = query(sql, params);
  if (error) return { count: 0, error };
  return { count: Object.values(data?.[0] ?? {})[0] ?? 0, error: null };
};

// Convenience: prepare-and-get (synchronous helper used in controllers)
const db = {
  prepare: (sql) => ({
    get: (...params) => queryOne(sql, params.flat()).data,
    all: (...params) => query(sql, params.flat()).data || [],
    run: (...params) => run(sql, params.flat()),
  }),
  run: (sql, params = []) => run(sql, params),
  exec: (sql) => {
    if (!_ready) throw new Error('DB not ready');
    _db.run(sql);
    _dirty = true;
  },
};

// ── schema ────────────────────────────────────────────────
const _initSchema = () => {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'patient',
      phone TEXT,
      avatar_url TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      head_doctor_id TEXT,
      floor TEXT,
      room_numbers TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
      specialization TEXT NOT NULL DEFAULT 'General Medicine',
      license_number TEXT,
      experience_years INTEGER DEFAULT 0,
      consultation_fee REAL DEFAULT 500.00,
      rating REAL DEFAULT 4.5,
      bio TEXT,
      education TEXT,
      is_available INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date_of_birth TEXT,
      gender TEXT,
      blood_group TEXT,
      address TEXT,
      emergency_contact TEXT,
      allergies TEXT,
      medical_history TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permissions TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS doctor_availability (
      id TEXT PRIMARY KEY,
      doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      day_of_week TEXT NOT NULL,
      start_time TEXT NOT NULL DEFAULT '09:00',
      end_time TEXT NOT NULL DEFAULT '17:00',
      slot_duration INTEGER DEFAULT 30,
      is_available INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(doctor_id, day_of_week)
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      reason TEXT,
      type TEXT DEFAULT 'regular',
      status TEXT DEFAULT 'pending',
      queue_token TEXT,
      token_number INTEGER,
      doctor_notes TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS queue_tokens (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      token_number INTEGER NOT NULL,
      token_code TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      status TEXT DEFAULT 'waiting',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY,
      appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      diagnosis TEXT NOT NULL,
      medicines TEXT DEFAULT '[]',
      instructions TEXT,
      follow_up_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS billing (
      id TEXT PRIMARY KEY,
      appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      items TEXT DEFAULT '[]',
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      amount REAL NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      payment_method TEXT,
      transaction_id TEXT,
      notes TEXT,
      paid_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      file_url TEXT,
      file_name TEXT,
      file_size INTEGER,
      file_type TEXT,
      mime_type TEXT,
      report_type TEXT DEFAULT 'general',
      uploaded_by TEXT REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS emergency_cases (
      id TEXT PRIMARY KEY,
      patient_id TEXT REFERENCES patients(id) ON DELETE SET NULL,
      doctor_id TEXT REFERENCES doctors(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      severity TEXT DEFAULT 'high',
      location TEXT,
      status TEXT DEFAULT 'active',
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS beds (
      id TEXT PRIMARY KEY,
      bed_number TEXT UNIQUE NOT NULL,
      department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
      patient_id TEXT REFERENCES patients(id) ON DELETE SET NULL,
      bed_type TEXT DEFAULT 'general',
      status TEXT DEFAULT 'available',
      floor TEXT,
      room_number TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `;
  _db.run(schema);
  _dirty = true;
  console.log('✅ SQLite schema initialized');
};

// ── seed ──────────────────────────────────────────────────
const _seedData = () => {
  const existingAdmin = _rawQueryOne('SELECT id FROM users WHERE email = ?', ['admin@smarthospital.com']).data;
  if (existingAdmin) return;
  console.log('🌱 Seeding initial data...');

  const now = new Date().toISOString();

  const depts = [
    ['Cardiology', 'Heart and cardiovascular system care', '3rd Floor', '301-315'],
    ['Neurology', 'Brain and nervous system disorders', '4th Floor', '401-410'],
    ['Orthopedics', 'Bone, joint and muscle care', '2nd Floor', '201-215'],
    ['Pediatrics', 'Children healthcare', '1st Floor', '101-120'],
    ['Oncology', 'Cancer diagnosis and treatment', '5th Floor', '501-510'],
    ['Dermatology', 'Skin, hair and nail conditions', '2nd Floor', '216-225'],
    ['Ophthalmology', 'Eye care and vision', '1st Floor', '121-130'],
    ['Gynecology', 'Women reproductive health', '3rd Floor', '316-325'],
    ['General Medicine', 'General health consultations', 'Ground Floor', 'G01-G20'],
    ['Emergency', '24/7 emergency care', 'Ground Floor', 'E01-E10'],
  ];
  for (const [name, desc, floor, rooms] of depts) {
    _db.run(`INSERT OR IGNORE INTO departments (id,name,description,floor,room_numbers,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
      [uuidv4(), name, desc, floor, rooms, now, now]);
  }

  // System admin (password: admin123)
  const adminId = uuidv4();
  _db.run(`INSERT OR IGNORE INTO users (id,email,password_hash,full_name,role,phone,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)`,
    [adminId, 'admin@smarthospital.com', '$2a$12$QvTCGr8ZN30Ohpi0zCVAp.l7h0UQ5.kToOhNnCLu0Iq9FgLqTfery', 'System Administrator', 'admin', '+91 98765 00001', now, now]);
  _db.run(`INSERT OR IGNORE INTO admins (id,user_id,created_at) VALUES (?,?,?)`, [uuidv4(), adminId, now]);

  // Demo users (password: demo123)
  const demoHash = '$2a$12$3DCnBL2icQfaHedbY3iwsOURhUBuBGJubuyz/O2I3NDucgjsVWqvu';
  const demoUsers = [
    ['patient@demo.com', 'Rahul Sharma', 'patient', '+91 98765 43210'],
    ['patient2@demo.com', 'Priya Patel', 'patient', '+91 98765 43211'],
    ['patient3@demo.com', 'Amit Kumar', 'patient', '+91 98765 43212'],
    ['doctor@demo.com', 'Anita Patel', 'doctor', '+91 98765 43220'],
    ['doctor2@demo.com', 'Rajesh Mehta', 'doctor', '+91 98765 43221'],
    ['doctor3@demo.com', 'Sunita Verma', 'doctor', '+91 98765 43222'],
    ['doctor4@demo.com', 'Vikram Singh', 'doctor', '+91 98765 43223'],
    ['admin@demo.com', 'Admin User', 'admin', '+91 98765 43200'],
  ];

  const userIds = {};
  for (const [email, name, role, phone] of demoUsers) {
    const id = uuidv4();
    _db.run(`INSERT OR IGNORE INTO users (id,email,password_hash,full_name,role,phone,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)`,
      [id, email, demoHash, name, role, phone, now, now]);
    const row = _rawQueryOne('SELECT id FROM users WHERE email = ?', [email]).data;
    userIds[email] = row?.id;
  }

  // Patient profiles
  const patientProfiles = [
    ['patient@demo.com', '1990-05-15', 'male', 'B+', 'Mumbai, Maharashtra', '+91 98765 43299'],
    ['patient2@demo.com', '1995-08-22', 'female', 'A+', 'Delhi, India', null],
    ['patient3@demo.com', '1985-12-10', 'male', 'O+', 'Bangalore, Karnataka', null],
  ];
  const patientIds = {};
  for (const [email, dob, gender, bg, addr, ec] of patientProfiles) {
    const pid = uuidv4();
    _db.run(`INSERT OR IGNORE INTO patients (id,user_id,date_of_birth,gender,blood_group,address,emergency_contact,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [pid, userIds[email], dob, gender, bg, addr, ec, now, now]);
    const row = _rawQueryOne('SELECT id FROM patients WHERE user_id = ?', [userIds[email]]).data;
    patientIds[email] = row?.id;
  }

  // Doctor profiles
  const getDept = (name) => _rawQueryOne('SELECT id FROM departments WHERE name = ?', [name]).data;
  const doctorData = [
    ['doctor@demo.com', 'Cardiology', 'Cardiology', 12, 800, 4.9, 'Experienced cardiologist with expertise in interventional cardiology.', 'MBBS - AIIMS Delhi, MD Cardiology - PGI'],
    ['doctor2@demo.com', 'Neurology', 'Neurology', 8, 700, 4.7, 'Specialist in neurological disorders including epilepsy and stroke.', 'MBBS - KEM Mumbai, MD Neurology - NIMHANS'],
    ['doctor3@demo.com', 'Pediatrics', 'Pediatrics', 10, 600, 4.8, 'Dedicated pediatrician providing comprehensive care for children.', 'MBBS - Grant Medical College, MD Pediatrics - AIIMS'],
    ['doctor4@demo.com', 'Orthopedics', 'Orthopedics', 15, 900, 4.6, 'Expert orthopedic surgeon specializing in joint replacement.', 'MBBS - Maulana Azad Medical College, MS Orthopedics'],
  ];
  const doctorIds = {};
  for (const [email, deptName, spec, exp, fee, rating, bio, edu] of doctorData) {
    const dept = getDept(deptName);
    const did = uuidv4();
    _db.run(`INSERT OR IGNORE INTO doctors (id,user_id,department_id,specialization,experience_years,consultation_fee,rating,bio,education,is_available,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`,
      [did, userIds[email], dept?.id || null, spec, exp, fee, rating, bio, edu, now, now]);
    const row = _rawQueryOne('SELECT id FROM doctors WHERE user_id = ?', [userIds[email]]).data;
    doctorIds[email] = row?.id;
  }

  // Doctor availability (Mon-Sat)
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const docId of Object.values(doctorIds)) {
    for (const day of days) {
      _db.run(`INSERT OR IGNORE INTO doctor_availability (id,doctor_id,day_of_week,start_time,end_time,slot_duration,is_available,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        [uuidv4(), docId, day, '09:00', '17:00', 30, day !== 'sunday' ? 1 : 0, now, now]);
    }
  }

  // Sample beds
  const bedData = [
    ['B001', 'general', 'available', 'Ground', 'G01'], ['B002', 'general', 'occupied', 'Ground', 'G01'],
    ['B003', 'icu', 'available', '1st', '101'], ['B004', 'icu', 'occupied', '1st', '101'],
    ['B005', 'private', 'available', '2nd', '201'], ['B006', 'private', 'available', '2nd', '202'],
    ['B007', 'semi_private', 'maintenance', '2nd', '203'], ['B008', 'emergency', 'available', 'Ground', 'E01'],
    ['B009', 'emergency', 'occupied', 'Ground', 'E01'], ['B010', 'general', 'available', 'Ground', 'G02'],
  ];
  for (const [num, type, status, floor, room] of bedData) {
    _db.run(`INSERT OR IGNORE INTO beds (id,bed_number,bed_type,status,floor,room_number,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      [uuidv4(), num, type, status, floor, room, now, now]);
  }

  _dirty = true;
  console.log('✅ Seed data inserted successfully');
};

// ── boot ──────────────────────────────────────────────────
_init().catch(err => {
  console.error('❌ Database initialization failed:', err);
  process.exit(1);
});

module.exports = { db, query, queryOne, run, count, waitReady };
