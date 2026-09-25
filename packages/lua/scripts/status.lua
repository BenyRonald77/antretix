-- Membaca status antrean seorang pengguna dalam satu round-trip, sekaligus mencatat heartbeat.
-- KEYS[1]=queue  KEYS[2]=status  KEYS[3]=hb  KEYS[4]=admitted:{event}:{user}
-- KEYS[5]=active  KEYS[6]=stats:{event}:admit  KEYS[7]=config  KEYS[8..]=stock:{event}:{cat}
-- ARGV[1]=userId  ARGV[2]=nowMs  ARGV[3]=jendela ETA (ms)
--
-- Return: { status, admittedPttl, activeExpiresAt, rank, total, admitsInWindow, admitPerSec, stockTotal }
local user = ARGV[1]
local now = tonumber(ARGV[2])
local window = tonumber(ARGV[3])

local status = redis.call('GET', KEYS[2]) or 'SCHEDULED'
local admittedPttl = redis.call('PTTL', KEYS[4])
local activeScore = redis.call('ZSCORE', KEYS[5], user)
local rank = redis.call('ZRANK', KEYS[1], user)

if rank then
  -- Heartbeat hanya diperbarui untuk anggota antrean (XX), agar tidak menambah anggota baru.
  redis.call('ZADD', KEYS[3], 'XX', now, user)
else
  rank = -1
end

local total = redis.call('ZCARD', KEYS[1])

local admits = 0
local entries = redis.call('ZRANGEBYSCORE', KEYS[6], now - window, '+inf')
for _, entry in ipairs(entries) do
  local count = string.match(entry, ':(%d+)$')
  if count then admits = admits + tonumber(count) end
end

local rate = tonumber(redis.call('HGET', KEYS[7], 'admitPerSec') or '0')

local stockTotal = 0
for i = 8, #KEYS do
  stockTotal = stockTotal + tonumber(redis.call('GET', KEYS[i]) or '0')
end

local activeExpiresAt = -1
if activeScore then activeExpiresAt = tonumber(activeScore) end

return { status, admittedPttl, tostring(activeExpiresAt), rank, total, admits, rate, stockTotal }
