// server.js (With Debug Logging & Fix Applied)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const ImageKit = require('imagekit');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Setup clients
const pool = new Pool({
    user: process.env.DB_USER, 
    host: process.env.DB_HOST, 
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD, 
    port: process.env.DB_PORT,
});

const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

const upload = multer({ storage: multer.memoryStorage() });

// --- Elo Logic ---
const K_FACTOR = 32;

function calculateExpectedScore(ratingA, ratingB) { 
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400)); 
}

// --- API ROUTES ---
app.get('/api/matchup', async (req, res) => { 
    try { 
        const r = await pool.query('SELECT * FROM images ORDER BY RANDOM() LIMIT 2'); 
        if (r.rows.length < 2) return res.status(404).json({ error: 'Not enough images.' }); 
        console.log('Matchup fetched:', r.rows.map(img => ({ id: img.id, name: img.name, rating: img.rating })));
        res.json(r.rows); 
    } catch (e) { 
        console.error('Error fetching matchup:', e); 
        res.status(500).json({ error: 'Server error' }); 
    } 
});

app.get('/api/rankings', async (req, res) => { 
    try { 
        const r = await pool.query('SELECT * FROM images ORDER BY rating DESC'); 
        res.json(r.rows); 
    } catch (e) { 
        console.error('Error fetching rankings:', e); 
        res.status(500).json({ error: 'Server error' }); 
    } 
});

app.post('/api/vote', async (req, res) => { 
    console.log('\n=== VOTE RECEIVED ===');
    console.log('Request body:', req.body);
    
    const { winnerId, loserId } = req.body; 
    
    if (!winnerId || !loserId) {
        console.error('Missing winnerId or loserId');
        return res.status(400).json({ error: 'winnerId and loserId are required' });
    }
    
    try { 
        console.log('Fetching ratings for winner:', winnerId, 'and loser:', loserId);
        
        // Get current ratings
        const wr = await pool.query('SELECT id, name, rating FROM images WHERE id = $1', [winnerId]); 
        const lr = await pool.query('SELECT id, name, rating FROM images WHERE id = $1', [loserId]); 
        
        if (!wr.rows[0] || !lr.rows[0]) {
            console.error('Could not find one or both images');
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // --- FIX APPLIED HERE ---
        // The pg library returns NUMERIC types as strings to preserve precision.
        // We must convert them to numbers before doing any math.
        const winnerRating = parseFloat(wr.rows[0].rating); 
        const loserRating = parseFloat(lr.rows[0].rating); 
        // ------------------------
        
        console.log('Current ratings:');
        console.log(`  Winner (${wr.rows[0].name}): ${winnerRating}`);
        console.log(`  Loser (${lr.rows[0].name}): ${loserRating}`);
        
        // Calculate expected scores for both
        const expectedWinner = calculateExpectedScore(winnerRating, loserRating);
        const expectedLoser = calculateExpectedScore(loserRating, winnerRating);
        
        console.log('Expected scores:');
        console.log(`  Winner: ${expectedWinner.toFixed(4)}`);
        console.log(`  Loser: ${expectedLoser.toFixed(4)}`);
        
        // Calculate new ratings
        const newWinnerRating = winnerRating + K_FACTOR * (1 - expectedWinner);
        const newLoserRating = loserRating + K_FACTOR * (0 - expectedLoser);
        
        console.log('New ratings:');
        console.log(`  Winner: ${winnerRating.toFixed(2)} -> ${newWinnerRating.toFixed(2)} (change: ${(newWinnerRating - winnerRating).toFixed(2)})`);
        console.log(`  Loser: ${loserRating.toFixed(2)} -> ${newLoserRating.toFixed(2)} (change: ${(newLoserRating - loserRating).toFixed(2)})`);
        
        // Update database in a transaction
        const c = await pool.connect(); 
        try { 
            await c.query('BEGIN');
            console.log('Transaction started');
            
            const updateWinner = await c.query(
                'UPDATE images SET rating = $1, matches_played = matches_played + 1 WHERE id = $2 RETURNING rating, matches_played', 
                [newWinnerRating, winnerId]
            ); 
            console.log('Winner updated:', updateWinner.rows[0]);
            
            const updateLoser = await c.query(
                'UPDATE images SET rating = $1, matches_played = matches_played + 1 WHERE id = $2 RETURNING rating, matches_played', 
                [newLoserRating, loserId]
            ); 
            console.log('Loser updated:', updateLoser.rows[0]);
            
            await c.query('COMMIT'); 
            console.log('Transaction committed successfully');
        } catch (e) { 
            await c.query('ROLLBACK'); 
            console.error('Transaction rolled back due to error:', e);
            throw e; 
        } finally { 
            c.release(); 
        } 
        
        console.log('=== VOTE COMPLETED ===\n');
        
        res.json({ 
            success: true,
            winnerRating: newWinnerRating,
            loserRating: newLoserRating
        }); 
    } catch (e) { 
        console.error('Error processing vote:', e); 
        res.status(500).json({ error: 'Vote failed', details: e.message }); 
    } 
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded.' });
    }
    
    const { name } = req.body;
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Meme name is required.' });
    }
    
    try {
        const uploadResponse = await imagekit.upload({
            file: req.file.buffer,
            fileName: `meme-${Date.now()}`,
            folder: "elo-ranker-memes"
        });
        
        await pool.query(
            'INSERT INTO images (name, image_url, rating, matches_played) VALUES ($1, $2, $3, $4)', 
            [name, uploadResponse.url, 1200, 0]
        );
        
        res.status(201).json({ imageUrl: uploadResponse.url });
    } catch (error) {
        console.error("\n--- ERROR DURING IMAGE UPLOAD ---");
        console.error("The full error object is:", error);
        console.error("--- END OF ERROR DETAILS ---\n");
        res.status(500).json({ error: 'Failed to upload the image.' });
    }
});

// --- Serve Static Files ---
app.use(express.static('public'));

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Database config:', {
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        user: process.env.DB_USER,
        port: process.env.DB_PORT
    });
});