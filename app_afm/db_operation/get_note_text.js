import { config } from 'dotenv';
import pkg from 'pg';
import { writeLog } from './create_logs.js';
const { Client } = pkg;


config();

const createDBClient = () => {
    return new Client({
        user: process.env.POSTGRES_USER,
        host: process.env.POSTGRES_HOST,
        database: process.env.POSTGRES_DB,
        password: process.env.POSTGRES_PASSWORD,
        port: process.env.POSTGRES_PORT,
    });
};

async function getRandomDinnerText() {
    let client = createDBClient();
    let connected = false;
    
    try {
        await client.connect();
        connected = true;

        const query = 'SELECT value FROM note_text WHERE key = $1';
        const result = await client.query(query, ['dinner_text']);
        console.log(`DBからのdinner_text取得: ${JSON.stringify(result.rows)}`);
        if (result.rows.length === 0 || !result.rows[0].value) {
            console.error('dinner_textが見つかりません');

            return null;
        }

        const dinnerTexts = result.rows[0].value;
        const randomIndex = Math.floor(Math.random() * dinnerTexts.length);
        return dinnerTexts[randomIndex];

    } catch (error) {
        console.error(`dinner_text取得中にエラーが発生: ${error.message}`);
        return null;
    } finally {
        if (connected) {
            try {
                await client.end();
            } catch (e) {
                console.error(`DB接続のクローズ中にエラーが発生: ${e.message}`);
            }
        }
    }
}

async function getRandomNoteText(key) {
    let client = createDBClient();
    let connected = false;
    
    try {
        await client.connect();
        connected = true;

        const query = 'SELECT value FROM note_text WHERE key = $1';
        const result = await client.query(query, [`${key}`]);

        if (result.rows.length === 0 || !result.rows[0].value) {
            const error_message = `${key}が見つかりません`;
            await writeLog('error', 'breakfast', error_message, null, null);
            return null;
        }

        const dinnerTexts = result.rows[0].value;
        const randomIndex = Math.floor(Math.random() * dinnerTexts.length);
        // データベースから取得したテキストの\nを実際の改行に変換
        return dinnerTexts[randomIndex].replace(/\\n/g, '\n');

    } catch (error) {
        const error_message = `${key}取得中にエラーが発生: ${error.message}`;
        await writeLog('error', 'breakfast', error_message, null, null);
        return null;
    } finally {
        if (connected) {
            try {
                await client.end();
            } catch (e) {
                const error_message = `DB接続のクローズ中にエラーが発生: ${e.message}`;
                await writeLog('error', 'breakfast', error_message, null, null);
            }
        }
    }
}


export {
    getRandomDinnerText,
    getRandomNoteText
};
