/**
 * Semua nama key Redis dikumpulkan di satu tempat agar API, worker, dan test
 * selalu memakai format yang sama.
 */
export const keys = {
  queue: (eventId: string) => `queue:${eventId}`,
  active: (eventId: string) => `active:${eventId}`,
  admitted: (eventId: string, userId: string) => `admitted:${eventId}:${userId}`,
  heartbeat: (eventId: string) => `hb:${eventId}`,
  stock: (eventId: string, categoryId: string) => `stock:${eventId}:${categoryId}`,
  bought: (eventId: string, userId: string) => `bought:${eventId}:${userId}`,
  status: (eventId: string) => `status:${eventId}`,
  config: (eventId: string) => `config:${eventId}`,
  categories: (eventId: string) => `categories:${eventId}`,
  rateLimit: (scope: string, id: string) => `rl:${scope}:${id}`,
  admitStats: (eventId: string) => `stats:${eventId}:admit`,
  orderStats: (eventId: string) => `stats:${eventId}:orders`,
  paidStats: (eventId: string) => `stats:${eventId}:paid`,
  admissionLock: (eventId: string) => `lock:admission:${eventId}`,
  jobLock: (job: string) => `lock:job:${job}`,
  idempotency: (userId: string, key: string) => `idem:${userId}:${key}`,
  signupIp: (ip: string) => `signup:ip:${ip}`,
  reconcileDiff: (eventId: string, categoryId: string) => `reconcile:${eventId}:${categoryId}`,
} as const;
