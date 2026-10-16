// Tên sự kiện server -> client, dạng '<module>:<hành động>'.
export const RealtimeEvent = {
  NotificationNew: 'notification:new',
  NotificationUnreadCount: 'notification:unread-count',
  // Chat
  MessageNew: 'message:new',
  MessageDeleted: 'message:deleted',
  ConversationRead: 'conversation:read',
  ConversationTyping: 'conversation:typing',
  ChatUnreadCount: 'chat:unread-count',
  // Trạng thái hoạt động của người đang chat cùng
  PresenceUpdate: 'presence:update',
} as const;

// Sự kiện client -> server
export const RealtimeClientEvent = {
  ConversationTyping: 'conversation:typing',
} as const;

export type RealtimeEventName =
  (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

// Mọi kết nối của 1 user (nhiều tab / thiết bị) nằm chung room này
export const userRoom = (userId: number) => `user:${userId}`;
