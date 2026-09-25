-- Rate limiter sliding window log untuk beberapa aturan sekaligus (satu round-trip per request).
-- KEYS[i]=rl:{scope}:{id}
-- ARGV[1]=nowMs  ARGV[2]=member unik untuk request ini
-- ARGV[1+2i]=windowMs aturan ke-i  ARGV[2+2i]=limit aturan ke-i
--
-- Semua aturan dicek dulu; request hanya dicatat bila lolos di semua aturan,
-- sehingga request yang ditolak tidak ikut menghabiskan kuota.
-- Return: { indeksAturanYangMemblokir (0 = lolos), ms sampai boleh mencoba lagi }
local now = tonumber(ARGV[1])
local blocked = 0
local retry = 0

for i = 1, #KEYS do
  local window = tonumber(ARGV[1 + 2 * i])
  local limit = tonumber(ARGV[2 + 2 * i])

  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - window)

  if redis.call('ZCARD', KEYS[i]) >= limit then
    local oldest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    local wait = window
    if oldest[2] then wait = tonumber(oldest[2]) + window - now end
    if wait < 1 then wait = 1 end
    if wait > retry then
      retry = wait
      blocked = i
    end
  end
end

if blocked > 0 then return { blocked, retry } end

for i = 1, #KEYS do
  redis.call('ZADD', KEYS[i], now, ARGV[2])
  redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[1 + 2 * i]))
end

return { 0, 0 }
