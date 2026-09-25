-- Satu tick admission worker (dijalankan leader setiap 1 detik).
-- KEYS[1]=queue  KEYS[2]=active  KEYS[3]=status  KEYS[4]=hb  KEYS[5]=stats:{event}:admit
-- KEYS[6..]=stock:{event}:{cat}
-- ARGV[1]=nowMs  ARGV[2]=admitPerSec  ARGV[3]=maxActive  ARGV[4]=sessionTtlMs  ARGV[5]=eventId
--
-- Return: { jumlahDiadmit, jumlahAktif, alasan, stockTotal }
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local maxActive = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local eventId = ARGV[5]

-- 1. Buang sesi aktif yang sudah kedaluwarsa.
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local active = redis.call('ZCARD', KEYS[2])

local stockTotal = 0
for i = 6, #KEYS do
  stockTotal = stockTotal + tonumber(redis.call('GET', KEYS[i]) or '0')
end

local status = redis.call('GET', KEYS[3])
if status ~= 'OPEN' then return { 0, active, status or 'NONE', stockTotal } end
if stockTotal <= 0 then return { 0, active, 'NO_STOCK', stockTotal } end

-- 2. Hitung kursi kosong. Tidak ada gunanya memasukkan lebih banyak orang daripada sisa tiket.
local slot = math.min(rate, maxActive - active, stockTotal)
if slot <= 0 then return { 0, active, 'FULL', stockTotal } end

-- 3. Ambil pengguna terdepan.
local popped = redis.call('ZPOPMIN', KEYS[1], slot)
local admitted = 0
local expiresAt = now + ttl

-- 4. Pindahkan ke sesi aktif dan tandai sudah di-admit.
for i = 1, #popped, 2 do
  local user = popped[i]
  redis.call('ZADD', KEYS[2], expiresAt, user)
  redis.call('SET', 'admitted:' .. eventId .. ':' .. user, '1', 'PX', ttl)
  redis.call('ZREM', KEYS[4], user)
  admitted = admitted + 1
end

if admitted > 0 then
  redis.call('ZADD', KEYS[5], now, ARGV[1] .. ':' .. admitted)
end
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now - 300000)

return { admitted, active + admitted, 'OK', stockTotal }
