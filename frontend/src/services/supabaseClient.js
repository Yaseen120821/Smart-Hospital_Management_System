/**
 * Real-time polling client (replaces Supabase real-time)
 * Since SQLite is local and has no WebSocket support,
 * we use efficient polling against our REST API endpoints.
 */

import api from '../utils/api';

// No-op supabase stub for any leftover imports
export const supabase = {
  channel: () => ({ on: () => ({ subscribe: () => {} }) }),
  removeChannel: () => {}
};

/**
 * Poll the queue for a doctor every N ms
 * Mirrors the old subscribeToQueue(doctorId, callback) API
 * @param {string} doctorId
 * @param {Function} callback  called with the API response on each poll
 * @param {number} intervalMs  polling interval (default 5 seconds)
 * @returns {Function} unsubscribe / stop polling
 */
export const subscribeToQueue = (doctorId, callback, intervalMs = 5000) => {
  let active = true;

  const poll = async () => {
    if (!active) return;
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await api.get(`/queue/${doctorId}?date=${today}`);
      if (data.success) callback({ new: data.data, type: 'POLL' });
    } catch {
      // silently ignore network errors during polling
    }
    if (active) setTimeout(poll, intervalMs);
  };

  // Start with a short initial delay
  setTimeout(poll, 500);

  return () => { active = false; };
};

/**
 * Poll notifications for a user
 * @param {string} userId  (unused – auth is via Bearer token)
 * @param {Function} callback  called with new notifications array
 * @param {number} intervalMs
 * @returns {Function} stop polling
 */
export const subscribeToNotifications = (userId, callback, intervalMs = 10000) => {
  let active = true;
  let lastCount = null;

  const poll = async () => {
    if (!active) return;
    try {
      const { data } = await api.get('/notifications');
      if (data.success) {
        const unread = data.data.filter(n => !n.is_read);
        // Only call callback when there are new unread notifications
        if (lastCount === null || unread.length > lastCount) {
          unread.slice(lastCount ?? 0).forEach(n => callback(n));
        }
        lastCount = unread.length;
      }
    } catch {
      // ignore
    }
    if (active) setTimeout(poll, intervalMs);
  };

  setTimeout(poll, 1000);
  return () => { active = false; };
};

/**
 * Poll appointment status for a patient
 * @param {string} patientId  (unused – auth is via token)
 * @param {Function} callback  called with updated appointment data
 * @param {number} intervalMs
 * @returns {Function} stop polling
 */
export const subscribeToAppointments = (patientId, callback, intervalMs = 8000) => {
  let active = true;

  const poll = async () => {
    if (!active) return;
    try {
      const { data } = await api.get('/appointments');
      if (data.success) callback({ new: data.data, type: 'POLL' });
    } catch {
      // ignore
    }
    if (active) setTimeout(poll, intervalMs);
  };

  setTimeout(poll, 1000);
  return () => { active = false; };
};

/**
 * Poll emergency cases (admin)
 * @param {Function} callback
 * @param {number} intervalMs
 * @returns {Function} stop polling
 */
export const subscribeToEmergencies = (callback, intervalMs = 10000) => {
  let active = true;

  const poll = async () => {
    if (!active) return;
    try {
      const { data } = await api.get('/admin/emergency');
      if (data.success) callback({ new: data.data, type: 'POLL' });
    } catch {
      // ignore
    }
    if (active) setTimeout(poll, intervalMs);
  };

  setTimeout(poll, 1000);
  return () => { active = false; };
};

export default supabase;
