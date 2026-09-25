-- Join ruang tunggu / antrean secara atomik.
-- KEYS[1]=queue:{event}  KEYS[2]=status:{event}  KEYS[3]=hb:{event}
-- KEYS[4]=admitted:{event}:{user}  KEYS[5]=active:{event}
-- ARGV[1]=userId  ARGV[2]=nowMs  ARGV[3]=skor acak [0,1) untuk pre-queue
--
-- Return: { kode, rank, baru }
--   kode: QUEUED | PREQUEUE | ADMITTED | SOLD_OUT | CLOSED | NOT_OPEN
local status = redis.call('GET', KEYS[2])
if not status then return { 'NOT_OPEN', -1, 0 } end
if status == 'SOLD_OUT' or status == 'CLOSED' then return { status, -1, 0 } end
if status ~= 'PREQUEUE' and status ~= 'OPEN' and status ~= 'PAUSED' then
  return { 'NOT_OPEN', -1, 0 }
end

local user = ARGV[1]
local now = tonumber(ARGV[2])

-- Sudah di-admit dan sesinya masih berlaku: tidak perlu antre lagi.
if redis.call('EXISTS', KEYS[4]) == 1 and redis.call('ZSCORE', KEYS[5], user) then
  return { 'ADMITTED', -1, 0 }
end

-- Pre-queue: skor acak (undian). Setelah jam buka: timestamp ms (> 1), otomatis di belakang
-- semua peserta pre-queue dan berurutan FIFO. NX: join ulang tidak mengubah posisi.
local score = now
if status == 'PREQUEUE' then score = tonumber(ARGV[3]) end

local added = redis.call('ZADD', KEYS[1], 'NX', score, user)
redis.call('ZADD', KEYS[3], now, user)
local rank = redis.call('ZRANK', KEYS[1], user)

if status == 'PREQUEUE' then return { 'PREQUEUE', rank, added } end
return { 'QUEUED', rank, added }
