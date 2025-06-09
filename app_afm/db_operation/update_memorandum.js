import { config } from 'dotenv';
import pkg from 'pg';
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

async function updateMultiMemorandum( key='dinner',value) {
    let client = createDBClient();
    let connected = false;
    
    try {
        await client.connect();
        connected = true;

        const query = 'UPDATE memorandum SET value = $1 WHERE key = $2';
        const result = await client.query(query, [value, key]);
        if (result.rowCount === 0) {
            console.error(`${key}のメモが見つかりません`);
            return false;
        }

        console.log(`${key}のメモを更新しました`);
        return true;

    } catch (error) {
        console.error(`${key}メモ更新中にエラーが発生: ${error.message}`);
        return false;
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

export {
    updateMultiMemorandum
};
