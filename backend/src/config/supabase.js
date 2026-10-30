/**
 * Legacy compatibility shim - redirects to SQLite database
 * This file replaces the old Supabase client config
 */

// Re-export from new SQLite config for backward compatibility
module.exports = require('./database');
