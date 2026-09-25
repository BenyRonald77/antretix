-- Ambil atau perpanjang leader lock.
-- KEYS[1]=lock key  ARGV[1]=id instance  ARGV[2]=ttl ms
--
-- Return: 1 jika instance ini leader, 0 jika bukan.
local owner = redis.call('GET', KEYS[1])
if owner == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
if not owner then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
return 0
