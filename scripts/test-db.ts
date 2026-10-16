import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const pg = await PGlite.create();
try {
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  const files = (await readdir("supabase/migrations"))
    .filter((v) => v.endsWith(".sql"))
    .sort();
  for (const file of files)
    await pg.exec(await readFile("supabase/migrations/" + file, "utf8"));
  const rows = await pg.query<{ tablename: string; rowsecurity: boolean }>(
    "SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='app'",
  );
  assert.equal(rows.rows.length, 24);
  assert(rows.rows.every((r) => r.rowsecurity));
  for (const role of ["anon", "authenticated", "fe_worker"]) {
    await pg.exec("SET ROLE " + role);
    await assert.rejects(pg.query("SELECT * FROM app.users"));
    await pg.exec("RESET ROLE");
  }
  await pg.exec("SET ROLE fe_server");
  const u = await pg.query<{ id: string }>(
    "INSERT INTO app.users(telegram_user_id,display_name) VALUES(1,'Organizer'),(2,'Other') RETURNING id",
  );
  const e = await pg.query<{ id: string; public_id: string }>(
    "INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES($1,'abcdefghijklmnopqrstuv','Birthday','birthday','2027-01-01','Europe/Moscow','2026-12-31T21:00Z') RETURNING id,public_id",
    [u.rows[0].id],
  );
  await assert.rejects(
    pg.query(
      "UPDATE app.events SET public_id='bbbbbbbbbbbbbbbbbbbbbb' WHERE id=$1",
      [e.rows[0].id],
    ),
  );
  const w = await pg.query<{ id: string }>(
    "INSERT INTO app.wishlists(event_id) VALUES($1) RETURNING id",
    [e.rows[0].id],
  );
  const g = await pg.query<{ id: string }>(
    "INSERT INTO app.gifts(wishlist_id,title) VALUES($1,'Gift') RETURNING id",
    [w.rows[0].id],
  );
  const guests = await pg.query<{ id: string }>(
    "INSERT INTO app.guest_identities(display_name) VALUES('Guest One'),('Guest Two') RETURNING id",
  );
  const r = await pg.query("SELECT * FROM app.reserve_gift($1,$2,$3)", [
    e.rows[0].public_id,
    g.rows[0].id,
    guests.rows[0].id,
  ]);
  assert.equal(r.rows.length, 1);
  const repeated = await pg.query("SELECT * FROM app.reserve_gift($1,$2,$3)", [
    e.rows[0].public_id,
    g.rows[0].id,
    guests.rows[0].id,
  ]);
  assert.deepEqual(repeated.rows, r.rows);
  await assert.rejects(
    pg.query("SELECT * FROM app.reserve_gift($1,$2,$3)", [
      e.rows[0].public_id,
      g.rows[0].id,
      guests.rows[1].id,
    ]),
  );
  await pg.query("SELECT app.cancel_reservation($1,$2,$3)", [
    e.rows[0].public_id,
    g.rows[0].id,
    guests.rows[1].id,
  ]);
  assert.equal(
    (
      await pg.query(
        "SELECT * FROM app.gift_reservations WHERE status='active'",
      )
    ).rows.length,
    1,
  );
  await assert.rejects(
    pg.query(
      "INSERT INTO app.rsvps(event_id,guest_identity_id,guest_name,status,adults_count,children_count) VALUES($1,$2,'Guest','no',1,0)",
      [e.rows[0].id, guests.rows[0].id],
    ),
  );
  await assert.rejects(
    pg.query(
      "INSERT INTO app.notification_subscriptions(event_id,user_id,role,enabled,consented_at) VALUES($1,$2,'organizer',true,now())",
      [e.rows[0].id, u.rows[0].id],
    ),
  );
  await assert.rejects(
    pg.query("SELECT app.soft_delete_event($1,$2,1)", [
      e.rows[0].id,
      u.rows[1].id,
    ]),
  );
  await assert.rejects(
    pg.query("SELECT app.soft_delete_event($1,$2,9)", [
      e.rows[0].id,
      u.rows[0].id,
    ]),
  );
  await pg.query("SELECT app.soft_delete_event($1,$2,1)", [
    e.rows[0].id,
    u.rows[0].id,
  ]);
  assert.equal(
    (
      await pg.query(
        "SELECT * FROM app.gift_reservations WHERE status='active'",
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    pg.query("SELECT * FROM app.reserve_gift($1,$2,$3)", [
      e.rows[0].public_id,
      g.rows[0].id,
      guests.rows[1].id,
    ]),
  );
  await pg.exec("RESET ROLE; SET ROLE fe_worker;");
  assert.equal(
    (await pg.query("SELECT * FROM app.claim_notifications(10)")).rows.length,
    0,
  );
  console.info(
    "PASS: clean migrations, 24 tables, RLS/grants, reservation uniqueness/idempotency, own cancel, cross-owner delete, optimistic version, soft deletion, worker isolation.",
  );
} finally {
  await pg.close();
}
