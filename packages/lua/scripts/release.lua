-- Mengembalikan stok yang direservasi (order gagal dibuat, atau order kedaluwarsa).
-- KEYS[1]=stock:{event}:{cat}  KEYS[2]=bought:{event}:{user}
-- ARGV[1]=qty
--
-- Return: stok setelah dikembalikan
local qty = tonumber(ARGV[1])
local stock = redis.call('INCRBY', KEYS[1], qty)

local bought = tonumber(redis.call('GET', KEYS[2]) or '0')
local next = bought - qty
if next <= 0 then
  redis.call('DEL', KEYS[2])
else
  redis.call('SET', KEYS[2], next)
end

return stock
