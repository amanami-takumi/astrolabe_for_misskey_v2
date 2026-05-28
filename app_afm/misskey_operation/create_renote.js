import { config } from 'dotenv';
import axios from 'axios';
import { promises as fs, write } from 'fs';
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
        await writeLog('info', 'createNote', info_message, null, null); // createNote を createRenote に変更する方が適切かもしれませんが、元のコードに合わせています
        return true;
    } catch (error) {
        // logger.error(`データベース接続テスト失敗: ${error.message}`); // logger はこのファイルでは未定義
        const error_message_main = `データベース接続テスト失敗: ${error.message}`;
        await writeLog('error', 'createRenote', error_message_main, null, null); // createNote を createRenote に変更
        if (error.code === 'ECONNREFUSED') {
            const error_message_econn = `データベースサーバー(${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT})に接続できません\nデータベースサーバーが起動しているか確認してください`;
            await writeLog('error', 'createRenote', error_message_econn, null, null); // createNote を createRenote に変更
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
    await writeLog('info', 'createMisskeyRenote', `Renoteが請求されました: ${noteId}`, null, null);
    // Heatによる暴走抑止の処理
    const currentHeat = await getMultiKVoperation('protection', 'renote_heat');
    const maxHeat = await getMultiKVoperation('settings', 'max_renote_heat');
    if (Number(maxHeat) !== null && Number(currentHeat) > Number(maxHeat)) {
        const error_message = `Renote回数が制限(${maxHeat}回)を超えました。\n現在のHeat値は${currentHeat}です`;
        await writeLog('error', 'createMisskeyRenote', error_message, null, null); 
        return null;
    }

    const payload = {
        renoteId: noteId
    };

    const options = {
        method: 'POST',
        url: `${MISSKEY_URL}/api/notes/create`, // エンドポイントを修正
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${MISSKEY_TOKEN}`
        },
        data: payload // ペイロードを修正
    };
    
    try {
        const { data } = await axios.request(options);
        // console.log(data); // 必要に応じてデバッグ情報を残す
        await writeLog('info', 'createMisskeyRenote', `Renoteを実行: ${noteId}, Response: ${JSON.stringify(data)}`, null, null);
        // Heatの更新
        // renote_heat の値は文字列として保存されている可能性があるため、取得した値を数値に変換してから加算し、再度文字列として保存します。
        // getMultiKVoperationが数値を返す場合は String() は不要です。
        const newHeat = Number(currentHeat) + 1;
        await updateMultiKVoperation('protection', String(newHeat) , 'renote_heat'); // 'renote_heat' のキー名を修正, 値を文字列に変換
        const info_message = `renote_heat値を${currentHeat}から${newHeat}に更新しました`;
        await writeLog('info', 'createMisskeyRenote', info_message, null, null);
        return data; // 成功時はレスポンスデータを返す
    } catch (error) {
        const error_message = `Misskey API Renoteリクエストでエラーが発生: ${error.message}\nステータスコード: ${error.response?.status || 'N/A'}\nNote ID: ${noteId}`;
        await writeLog('error', 'createMisskeyRenote', error_message, null, null);
        if (error.response?.data) {
            const error_detail_message = `エラー詳細: ${JSON.stringify(error.response.data, null, 2)}`;
            await writeLog('error', 'createMisskeyRenote', error_detail_message, null, null);
        }
        // console.error(error); // writeLogで詳細を記録するため、重複する可能性のあるconsole.errorはコメントアウトまたは削除
        return null; // 失敗時はnullを返す
    }
}


export { createMisskeyRenote };