import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const candidates = [process.env.PG_BIN, '/Applications/Postgres.app/Contents/Versions/17/bin', '/usr/bin', '/opt/homebrew/opt/postgresql@17/bin'].filter(Boolean);
const bin = candidates.find((path) => existsSync(join(path, 'initdb')));
if (!bin) throw new Error('Isolated SQL check requires PostgreSQL binaries; set PG_BIN to their directory. No existing database will be used.');
const directory = mkdtempSync('/tmp/payment-portal-db-');
const socket = join(directory, 'socket');
mkdirSync(socket);
const data = join(directory, 'data');
const port = '55432';
const psql = (sql) => execFileSync(join(bin, 'psql'), ['-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let started = false;
try {
  execFileSync(join(bin, 'initdb'), ['-D', data, '--username=postgres', '--encoding=UTF8', '--no-locale', '--auth=trust'], { stdio: 'pipe' });
  // Socket-only fresh cluster: no connection to a pre-existing or remote database.
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(directory, 'server.log'), '-o', `-h '' -p ${port} -k ${socket}`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  psql(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.payment_links(id uuid primary key default gen_random_uuid(), order_number text not null,
      amount numeric not null, customer_name text not null, customer_email text not null,
      status text not null check(status in ('pending','paid')), paid_at timestamptz, retref text);`);
  const migration = readFileSync(new URL('../supabase/migrations/202610120001_payment_integrity.sql', import.meta.url), 'utf8');
  psql(migration); psql(migration);
  const id = '00000000-0000-4000-8000-000000000001';
  psql(`insert into payment_links(id,order_number,amount,customer_name,customer_email,status) values('${id}','TEST',10.00,'Synthetic buyer','buyer@example.invalid','pending');`);
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => {
    const attempt = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const order = 'p' + String(index + 1).padStart(18, '0');
    return run(join(bin, 'psql'), ['-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', `select portal_claim_payment('${id}','${attempt}','${order}',10.00)->>'code';`]);
  }));
  assert.equal(results.filter((result) => result.stdout.trim() === 'claimed').length, 1);
  assert.equal(results.filter((result) => result.stdout.trim() === 'pending').length, 11);
  assert.equal(psql('select count(*) from payment_attempts;'), '1');
  const attempt = psql('select id from payment_attempts limit 1;');
  psql(`select portal_finish_payment('${attempt}','unknown');`);
  assert.equal(psql(`select portal_claim_payment('${id}',gen_random_uuid(),'paaaaaaaaaaaaaaaaaa',10.00)->>'code';`), 'pending');
  psql(`select portal_finish_payment('${attempt}','paid','123456789012');`);
  assert.equal(psql(`select status from payment_links where id='${id}';`), 'paid');
  assert.equal(psql(`select portal_claim_payment('${id}',gen_random_uuid(),'pbbbbbbbbbbbbbbbbbb',10.00)->>'code';`), 'paid');
  assert.equal(psql(`select has_table_privilege('anon','public.payment_links','select');`), 'f');
  assert.equal(psql(`select has_function_privilege('anon','public.portal_claim_payment(uuid,uuid,text,numeric)','execute');`), 'f');
  assert.equal(psql(`select has_function_privilege('service_role','public.portal_claim_payment(uuid,uuid,text,numeric)','execute');`), 't');
  for (let i = 0; i < 5; i++) assert.equal(psql(`select portal_rate_limit('synthetic-login',5,300);`), 't');
  assert.equal(psql(`select portal_rate_limit('synthetic-login',5,300);`), 'f');
  psql(`select portal_rate_limit('synthetic-lookup',60,60);`);
  assert.equal(psql(`select portal_rate_limit('synthetic-login',5,300);`), 'f');
  const request = '20000000-0000-4000-8000-000000000001';
  const hash = 'a'.repeat(64);
  const create = `select portal_create_link('${request}','${hash}','TEST-2',15.00,'Synthetic buyer','buyer@example.invalid')->'link'->>'id';`;
  assert.equal(psql(create), psql(create));
  assert.equal(psql(`select count(*) from payment_links where request_id='${request}';`), '1');
  assert.equal(psql(`select portal_create_link('${request}','${'b'.repeat(64)}','TEST-2',20.00,'Synthetic buyer','buyer@example.invalid')->>'code';`), 'conflict');
  console.log('PASS: isolated migration twice; 12 concurrent claims -> one attempt; unknown/paid replay locks; service-only grants; durable mixed-window rate limits; creation recovery.');
} finally {
  if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  rmSync(directory, { recursive: true, force: true });
}
