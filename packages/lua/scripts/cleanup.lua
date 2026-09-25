-- Mengeluarkan anggota antrean yang tidak mengirim heartbeat melewati batas waktu.
-- KEYS[1]=queue  KEYS[2]=hb
-- ARGV[1]=cutoffMs (now - timeout)  ARGV[2]=batas jumlah per panggilan
--
-- Return: jumlah pengguna yang dikeluarkan
local stale = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for _, user in ipairs(stale) do
  redis.call('ZREM', KEYS[1], user)
  redis.call('ZREM', KEYS[2], user)
end
return #stale
