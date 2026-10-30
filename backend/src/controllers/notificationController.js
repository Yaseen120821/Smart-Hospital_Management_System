/**
 * Notification Controller
 * Uses SQLite via better-sqlite3
 */

const { db } = require('../config/database');

const getNotifications = async (req, res) => {
  try {
    const notifications = db.prepare(`
      SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(req.user.id);
    const unreadCount = notifications.filter(n => !n.is_read).length;
    res.json({ success: true, data: notifications, unread_count: unreadCount });
  } catch (error) {
    console.error('GetNotifications error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const markAsRead = async (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(new Date().toISOString(), req.params.id, req.user.id);
    res.json({ success: true, message: 'Notification marked as read.' });
  } catch (error) {
    console.error('MarkAsRead error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1, updated_at = ? WHERE user_id = ? AND is_read = 0')
      .run(new Date().toISOString(), req.user.id);
    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    console.error('MarkAllAsRead error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const deleteNotification = async (req, res) => {
  try {
    db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true, message: 'Notification deleted.' });
  } catch (error) {
    console.error('DeleteNotification error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getNotifications, markAsRead, markAllAsRead, deleteNotification };
