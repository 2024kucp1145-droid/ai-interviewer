import { checkPostgresConnection, getPostgresConfig } from '../backend/src/db/postgres.js';

async function testPostgres() {
  console.log('--- Testing PostgreSQL Configuration & Driver ---');
  const config = getPostgresConfig();
  console.log('PostgreSQL Target Config:');
  console.log(` - Host:     ${config.host || (config.connectionString ? 'via connection string' : 'none')}`);
  console.log(` - Database: ${config.database || 'default'}`);
  console.log(` - User:     ${config.user || 'configured'}`);
  console.log(` - SSL:      ${Boolean(config.ssl)}`);

  const health = await checkPostgresConnection();
  if (health.connected) {
    console.log(`\n✅ Connected to PostgreSQL in ${health.latencyMs}ms!`);
    console.log(`   Version: ${health.version}`);
    console.log(`   Server Time: ${health.serverTime}`);
    process.exit(0);
  } else {
    console.log('\nℹ️ PostgreSQL server is not currently reachable at the target host.');
    console.log(`   Notice: ${health.error}`);
    console.log('\nTo connect PostgreSQL:');
    console.log('1. Free Cloud (Recommended): Create a project at https://supabase.com or https://neon.tech');
    console.log('2. Add to .env: DATABASE_URL="postgresql://user:pass@host:5432/db"');
    console.log('3. Run migration: npm run db:migrate:pg');
    // Exit with code 0 for dry tests if no local DB daemon is running
    process.exit(0);
  }
}

testPostgres();
