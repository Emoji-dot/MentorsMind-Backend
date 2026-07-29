import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Use random port for tests
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/testdb';
