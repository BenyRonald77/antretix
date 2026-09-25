-- Operasi yang menyentuh baris TicketCategory ("hot row" yang diperebutkan semua pembeli) dijalankan
-- sepenuhnya di dalam PostgreSQL. Satu panggilan = satu statement = satu transaksi, sehingga kunci baris
-- hanya dipegang di sisi database sampai commit, tanpa menunggu round-trip ke aplikasi.

-- Reservasi tiket (lapis 2 anti-oversell).
-- Return: 'OK' | 'LIMIT_EXCEEDED' | 'OUT_OF_STOCK'
CREATE OR REPLACE FUNCTION antretix_reserve_order(
  p_order_id text,
  p_code text,
  p_user_id text,
  p_event_id text,
  p_category_id text,
  p_qty integer,
  p_max_per_user integer,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_item_id text
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_held integer;
  v_price integer;
BEGIN
  -- Serialisasi per (akun, event) agar cek batas per akun tidak bisa balapan.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id || ':' || p_event_id));

  SELECT COALESCE(SUM(oi.qty), 0) INTO v_held
  FROM "OrderItem" oi
  JOIN "Order" o ON o.id = oi."orderId"
  WHERE o."userId" = p_user_id AND o."eventId" = p_event_id AND o.status IN ('PENDING', 'PAID');

  IF v_held + p_qty > p_max_per_user THEN
    RETURN 'LIMIT_EXCEEDED';
  END IF;

  -- UPDATE bersyarat: penjaga terakhir yang tidak bisa dilewati (ditambah CHECK constraint di tabel).
  -- Harga dikunci pada saat yang sama.
  UPDATE "TicketCategory"
  SET reserved = reserved + p_qty
  WHERE id = p_category_id AND "eventId" = p_event_id AND sold + reserved + p_qty <= quota
  RETURNING price INTO v_price;

  IF NOT FOUND THEN
    RETURN 'OUT_OF_STOCK';
  END IF;

  INSERT INTO "Order" (id, code, "userId", "eventId", status, "totalPrice", "expiresAt", "idempotencyKey", "createdAt")
  VALUES (p_order_id, p_code, p_user_id, p_event_id, 'PENDING', v_price * p_qty, p_expires_at, p_idempotency_key, now());

  INSERT INTO "OrderItem" (id, "orderId", "categoryId", qty, "unitPrice")
  VALUES (p_item_id, p_order_id, p_category_id, p_qty, v_price);

  RETURN 'OK';
END;
$$;

-- Pembayaran sukses: PENDING -> PAID, terbitkan tiket, pindahkan reserved ke sold.
-- p_codes berisi satu kode unik per tiket (dibuat aplikasi). Return false bila order sudah bukan PENDING.
CREATE OR REPLACE FUNCTION antretix_pay_order(
  p_order_id text,
  p_payment_ref text,
  p_codes text[]
) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Order"
  SET status = 'PAID', "paidAt" = now(), "paymentRef" = p_payment_ref
  WHERE id = p_order_id AND status = 'PENDING';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO "Ticket" (id, "orderId", "categoryName", code, "checkedIn")
  SELECT gen_random_uuid()::text, p_order_id, t.name, p_codes[t.n], false
  FROM (
    SELECT c.name, row_number() OVER (ORDER BY oi.id, s.i)::integer AS n
    FROM "OrderItem" oi
    JOIN "TicketCategory" c ON c.id = oi."categoryId"
    CROSS JOIN generate_series(1, oi.qty) AS s(i)
    WHERE oi."orderId" = p_order_id
  ) t;

  -- Baris kategori dikunci paling akhir.
  UPDATE "TicketCategory" c
  SET reserved = c.reserved - oi.qty, sold = c.sold + oi.qty
  FROM "OrderItem" oi
  WHERE oi."orderId" = p_order_id AND c.id = oi."categoryId";

  RETURN true;
END;
$$;

-- Melepas order PENDING (kedaluwarsa atau dibatalkan) dan mengembalikan kuota di PostgreSQL.
-- Transisi bersyarat membuatnya idempoten: hanya pemanggil pertama yang mendapat baris item,
-- dan hanya dia yang boleh mengembalikan stok Redis.
CREATE OR REPLACE FUNCTION antretix_release_order(
  p_order_id text,
  p_reason text,
  p_require_expired boolean
) RETURNS TABLE (event_id text, user_id text, category_id text, qty integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_event_id text;
  v_user_id text;
BEGIN
  UPDATE "Order"
  SET status = p_reason::"OrderStatus"
  WHERE id = p_order_id AND status = 'PENDING' AND (NOT p_require_expired OR "expiresAt" < now())
  RETURNING "eventId", "userId" INTO v_event_id, v_user_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE "TicketCategory" c
  SET reserved = c.reserved - oi.qty
  FROM "OrderItem" oi
  WHERE oi."orderId" = p_order_id AND c.id = oi."categoryId";

  RETURN QUERY
  SELECT v_event_id, v_user_id, oi."categoryId", oi.qty
  FROM "OrderItem" oi
  WHERE oi."orderId" = p_order_id;
END;
$$;
