-- Lapis 1 anti-oversell: cek dan kurangi stok secara atomik.
-- KEYS[1]=stock:{event}:{cat}  KEYS[2]=bought:{event}:{user}
-- ARGV[1]=qty  ARGV[2]=max_per_user
--
-- Return: sisa stok (>= 0), -1 = stok habis, -2 = melebihi batas per akun, -3 = stok belum diinisialisasi
local rawStock = redis.call('GET', KEYS[1])
if not rawStock then return -3 end

local stock = tonumber(rawStock)
local bought = tonumber(redis.call('GET', KEYS[2]) or '0')
local qty = tonumber(ARGV[1])

if bought + qty > tonumber(ARGV[2]) then return -2 end
if stock < qty then return -1 end

redis.call('DECRBY', KEYS[1], qty)
redis.call('INCRBY', KEYS[2], qty)
return stock - qty
