/**
 * Smart Hospital Management System - Backend Server
 * Main entry point for the Express.js API
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import routes
const authRoutes = require('./src/routes/authRoutes');
const appointmentRoutes = require('./src/routes/appointmentRoutes');
const doctorRoutes = require('./src/routes/doctorRoutes');
const patientRoutes = require('./src/routes/patientRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const prescriptionRoutes = require('./src/routes/prescriptionRoutes');
const billingRoutes = require('./src/routes/billingRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const queueRoutes = require('./src/routes/queueRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const feedbackRoutes = require('./src/routes/feedbackRoutes');
const { analyzeSymptoms } = require('./src/services/aiService');

// Import error handlers
const { errorHandler, notFound } = require('./src/middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================================
// SECURITY MIDDLEWARE
// ============================================================

// Helmet for security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Rate limiting — generous limits for development (3 portals + frequent /auth/me calls)
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 500,
  message: { success: false, message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'development', // disable in dev
});
app.use('/api/', limiter);

// Auth rate limit — higher limit so 3 portals + /auth/me polling don't get blocked
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 500 : 30,
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'development', // disable in dev
});
app.use('/api/auth/', authLimiter);

// ============================================================
// GENERAL MIDDLEWARE
// ============================================================

// CORS configuration — allow all three portal ports
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5173',  // Patient portal
    'http://localhost:5151',  // Doctor portal
    'http://localhost:5152',  // Admin portal
    'http://localhost:3000',  // fallback dev
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: '🏥 Smart Hospital API is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🏥 Smart Hospital Management System API',
    version: '1.0.0',
    docs: '/api/docs'
  });
});

// ============================================================
// API ROUTES
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/payments', billingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/feedback', feedbackRoutes);

// AI Symptom Checker (public endpoint)
app.post('/api/ai/symptoms', (req, res) => {
  const { symptoms } = req.body;
  if (!symptoms || !Array.isArray(symptoms)) {
    return res.status(400).json({ success: false, message: 'symptoms array is required' });
  }
  const result = analyzeSymptoms(symptoms);
  res.json(result);
});

// ============================================================
// ERROR HANDLING
// ============================================================

app.use(notFound);
app.use(errorHandler);

// ============================================================
// START SERVER (wait for SQLite DB to be ready first)
// ============================================================

const { waitReady } = require('./src/config/database');

const startServer = async () => {
  await waitReady();
  app.listen(PORT, () => {
    console.log('\n🏥 ================================');
    console.log('   Smart Hospital Management System');
    console.log('        (SQLite Edition)');
    console.log('================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(`📡 API URL: http://localhost:${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/health`);
    console.log('================================\n');
  });
};

startServer().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
