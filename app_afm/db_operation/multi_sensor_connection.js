import { config } from 'dotenv';
import { writeLog } from './create_logs.js';
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

// environmental_sensor_logs テーブル用の関数
async function insertSensorLog({ sensor_id, temperature, pressure }) {
    const client = createDBClient();
    await client.connect();
    try {
        const query = `
            INSERT INTO environmental_sensor_logs (sensor_id, temperature, pressure)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const values = [sensor_id, temperature, pressure];
        const result = await client.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error inserting sensor log:', error);
        await writeLog('error', 'insertSensorLog', 'Sensor log insert failed', JSON.stringify({ sensor_id, temperature, pressure }), error.stack);
        throw error;
    } finally {
        await client.end();
    }
}


// earthquake_sensor_logs テーブル用の関数
async function insertEarthquakeLog({ sensor_id, measure_scale, resultant_gal, gal_x, gal_y, gal_z }) {
    const client = createDBClient();
    await client.connect();
    try {
        const query = `
            INSERT INTO earthquake_sensor_logs (sensor_id, gal_x, gal_y, gal_z, measure_scale, resultant_gal)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;
        const values = [sensor_id, gal_x, gal_y, gal_z, measure_scale, resultant_gal];
        const result = await client.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error inserting earthquake log:', error);
        await writeLog('error', 'insertEarthquakeLog', 'Earthquake log insert failed', JSON.stringify({ sensor_id, gal_x, gal_y, gal_z, measure_scale, resultant_gal }), error.stack);
        throw error;
    } finally {
        await client.end();
    }
}

async function retrieveSensorLogs(sensor_id, limit) {
    const client = createDBClient();
    await client.connect();
    try {
        const query = `
            SELECT * FROM environmental_sensor_logs
            WHERE sensor_id = $1
            ORDER BY timestamp DESC
            LIMIT $2
        `;
        const values = [sensor_id, limit];
        const result = await client.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error retrieving sensor logs:', error);
        await writeLog('error', 'retrieveSensorLogs', 'Sensor log retrieval failed', JSON.stringify({ sensor_id }), error.stack);
        throw error;
    } finally {
        await client.end();
    }
}

export { insertSensorLog, insertEarthquakeLog, retrieveSensorLogs };
