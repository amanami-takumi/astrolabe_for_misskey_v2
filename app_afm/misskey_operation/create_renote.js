import { config } from 'dotenv';
import axios from 'axios';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeLog } from '../db_operation/create_logs.js';
import { updateMultiKVoperation, getMultiKVoperation } from '../db_operation/multi_db_connection.js';
config();

// 環境変数の読み込み
const MISSKEY_TOKEN = process.env.NOTICE_MISSKEY_TOKEN;
const MISSKEY_URL = process.env.NOTICE_MISSKEY_URL;
const TARGET_USER_ID = process.env.NOTICE_MISSKEY_TARGET_USER_ID;


import pkg from 'pg';
const { Client } = pkg;

const createDBClient = () => {
    return new Client({
        user: process.env.POSTGRES_USER,
        host: process.env.POSTGRES_HOST,
        database: process.env.POSTGRES_DB,
        password: process.env.POSTGRES_PASSWORD,
        port: process.env.POSTGRES_PORT,
    });
};

let client = createDBClient();

async function checkDBConnection() {


    const testClient = createDBClient();
    try {
        await testClient.connect();
        await testClient.query('SELECT NOW()');
        const info_message = 'データベース接続テスト成功';
        await writeLog('info', 'createNote', info_message, null, null);
        return true;
    } catch (error) {
        logger.error(`データベース接続テスト失敗: ${error.message}`);
        const error_message = `データベース接続テスト失敗: ${error.message}`;
        await writeLog('error', 'createNote', error_message, null, null);
        if (error.code === 'ECONNREFUSED') {
            const error_message = `データベースサーバー(${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT})に接続できません\nデータベースサーバーが起動しているか確認してください`;
            await writeLog('error', 'createNote', error_message, null, null);
        }
        return false;
    } finally {
        try {
            await testClient.end();
        } catch (e) {
            // 接続が既に切れている場合のエラーは無視
        }
    }
}



async function createMisskeyRenote(noteId) {
    
    // Heatによる暴走抑止の処理
    const currentHeat = await getMultiKVoperation('protection', 'renote_heat');
    const maxHeat = await getMultiKVoperation('settings', 'max_renote_heat');
    if (Number(maxHeat) !== null && Number(currentHeat) > Number(maxHeat)) {
        const error_message = `Renote回数が制限(${maxHeat}回)を超えました。\n現在のHeat値は${currentHeat}です`;
        await writeLog('error', 'createMisskeyRenote', error_message, null, null); 
        return null;
    }

    const options = {
        method: 'POST',
        url: 'https://misskey.seitendan.com/api/notes/renotes',
        headers: {'Content-Type': 'application/json'},
        data: {noteId: noteId, limit: 10, sinceId: '', untilId: ''}
    };
    
    try {
        const { data } = await axios.request(options);
        console.log(data);
        await writeLog('info', 'createMisskeyRenote', `Renoteを実行: ${noteId}`, null, null);
    } catch (error) {
    console.error(error);
    }
}


export { createMisskeyRenote };