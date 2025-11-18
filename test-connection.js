// test-connection.js - Run this to test your database connection

require('dotenv').config();
const { Pool } = require('pg');

console.log('Testing database connection...\n');

const pool = new Pool({
    user: process.env.DB_USER, 
    host: process.env.DB_HOST, 
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD, 
    port: process.env.DB_PORT,
});

console.log('Attempting to connect with:');
console.log('  Host:', process.env.DB_HOST);
console.log('  Database:', process.env.DB_DATABASE);
console.log('  User:', process.env.DB_USER);
console.log('  Port:', process.env.DB_PORT);
console.log('  Password:', process.env.DB_PASSWORD ? '[SET]' : '[MISSING]');
console.log('');

async function testConnection() {
    try {
        // Test basic connection
        const result = await pool.query('SELECT NOW()');
        console.log('✓ Connection successful!');
        console.log('✓ Server time:', result.rows[0].now);
        console.log('');

        // Test if images table exists
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'images'
        `);
        
        if (tableCheck.rows.length > 0) {
            console.log('✓ Table "images" exists');
            
            // Get sample data
            const images = await pool.query('SELECT id, name, rating, matches_played FROM images LIMIT 5');
            console.log(`✓ Found ${images.rows.length} images:`);
            images.rows.forEach(img => {
                console.log(`  - ID: ${img.id}, Name: ${img.name}, Rating: ${img.rating}, Matches: ${img.matches_played}`);
            });
        } else {
            console.log('✗ Table "images" does NOT exist!');
            console.log('  You need to create the table first.');
        }

        await pool.end();
        console.log('\nTest completed successfully!');
        
    } catch (error) {
        console.error('✗ Connection failed!');
        console.error('Error details:', error.message);
        console.error('');
        
        if (error.message.includes('password authentication failed')) {
            console.log('Suggestion: Check your DB_PASSWORD in .env file');
        } else if (error.message.includes('database') && error.message.includes('does not exist')) {
            console.log('Suggestion: Check your DB_DATABASE name in .env file');
        } else if (error.message.includes('connect ECONNREFUSED')) {
            console.log('Suggestion: Check your DB_HOST and DB_PORT in .env file');
        }
        
        process.exit(1);
    }
}

testConnection();
