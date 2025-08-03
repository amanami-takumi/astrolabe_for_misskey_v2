import { config } from 'dotenv';
import axios from 'axios';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeLog } from '../db_operation/create_logs.js';
import { updateMultiKVoperation, getMultiKVoperation } from '../db_operation/multi_db_connection.js';

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

import express from 'express';
const __dirname = dirname(fileURLToPath(import.meta.url));

config();

// 環境変数の読み込み
const MISSKEY_TOKEN = process.env.NOTICE_MISSKEY_TOKEN;
const MISSKEY_URL = process.env.NOTICE_MISSKEY_URL;
const TARGET_USER_ID = process.env.NOTICE_MISSKEY_TARGET_USER_ID;

// ロガーの設定
const logger = {
    info: (message) => console.log(`INFO: ${message}`),
    error: (message) => console.error(`ERROR: ${message}`)
};

/**
 * Misskeyにノートを投稿する関数
 */
async function createMisskeyNote(token, {
    text = "none_text",
    visibility = "public",
    fileIds = null,
    mediaIds = null,
    poll = null,
    cw = null,
    localOnly = false,
    visibleUserIds = null,
    replyId = null,
    renoteId = null,
} = {}) {
    const url = `${MISSKEY_URL}/api/notes/create`;
    
    const headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
    };

    
    try {
        // テキストの前処理
        
        let processedText = text;
        
    // 禁止ワードの取得と置換処理    
    //    const forbiddenWords = await getMultiKVoperation('note_text', 'forbidden');
    
    //    
    //    if (forbiddenWords && Array.isArray(forbiddenWords)) {
    //        forbiddenWords.forEach(word => {
    //            const stars = '＊'.repeat(word.length);
    //            const regex = new RegExp(word, 'g');
    //            if (regex.test(processedText)) {
    //                const info_message = `禁止ワード「${word}」を検出し、置換しました`;
    //                writeLog('info', 'createMisskeyNote', info_message, null, null);
    //            }
    //            processedText = processedText.replace(regex, stars);
    //        });
    //    }

        const payload = {
            visibility,
            visibleUserIds: visibleUserIds || [],
            cw,
            localOnly,
            reactionAcceptance: null,
            noExtractMentions: false,
            noExtractHashtags: false,
            noExtractEmojis: false,
            channelId: null,
            text: processedText,
        };

        if (fileIds?.length) payload.fileIds = fileIds;
        if (mediaIds?.length) payload.mediaIds = mediaIds;
        if (poll) payload.poll = poll;
        if (replyId) payload.replyId = replyId;
        if (renoteId) payload.renoteId = renoteId;

        // 最大再試行回数
        const maxRetries = 10;
        let retries = 0;
        
        while (true) {
            try {
                const response = await axios.post(url, payload, { headers });
                console.debug(`Misskey APIリクエスト成功: ${response.status}`);
                
                // heat値の更新処理を修正
                const now_heat = await getMultiKVoperation('protection', 'heat');
                if (now_heat !== null) {
                    await updateMultiKVoperation('protection', Number(now_heat) + 1, 'heat');
                    const info_message = `heat値を${now_heat}から${Number(now_heat) + 1}に更新しました`;
                    await writeLog('info', 'createMisskeyNote', info_message, null, null);
                } else {
                    const error_message = 'heat値の取得に失敗しました';
                    await writeLog('error', 'createMisskeyNote', error_message, null, null);
                }
                
                return response.data;
                
            } catch (error) {
                // 500エラーの場合で、最大再試行回数に達していない場合は再試行
                if (error.response?.status === 500 && retries < maxRetries) {
                    retries++;
                    const retry_message = `500エラーが発生しました。30秒後に再試行します (${retries}/${maxRetries})`;
                    await writeLog('warning', 'createMisskeyNote', retry_message, null, null);
                    console.warn(retry_message);
                    
                    // 30秒待機
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    continue;
                }
                
                const error_message = `Misskey APIリクエストでエラーが発生: ${error.message}\nステータスコード: ${error.response?.status || 'N/A'}`;
                await writeLog('error', 'createMisskeyNote', error_message, null, null);
                // エラーレスポンスのJSONをより詳細に解析
                if (error.response?.data) {
                    if (typeof error.response.data === 'object') {
                        const error_message = `エラー詳細:${JSON.stringify(error.response.data, null, 2)}`;
                        await writeLog('error', 'createMisskeyNote', error_message, null, null);
                    } else {
                        const error_message = `レスポンス: ${error.response.data}`;
                        await writeLog('error', 'createMisskeyNote', error_message, null, null);
                    }
                }

                // エラーの種類に応じた追加情報
                if (error.code === 'ECONNREFUSED') {
                    const error_message = `Misskeyサーバー(${MISSKEY_URL})に接続できません`;
                    await writeLog('error', 'createMisskeyNote', error_message, null, null);
                }
                
                return null;
            }
        }
    } catch (error) {
        const error_message = `Misskey APIリクエスト前処理でエラーが発生: ${error.message}`;
        await writeLog('error', 'createMisskeyNote', error_message, null, null);
        return null;
    }
}

async function createNoteWithMedia(text, mediaIds) {
    const currentHeat = await getMultiKVoperation('protection', 'heat');
    const maxHeat = await getMultiKVoperation('settings', 'max_heat');
    if (Number(maxHeat) !== null && Number(currentHeat) > Number(maxHeat)) {
        const error_message = `投稿回数が制限(${maxHeat}回)を超えました。\n現在のHeat値は${currentHeat}です`;
        await writeLog('error', 'createNote', error_message, null, null); 
        return null;
    }
    
    const result = await createMisskeyNote(MISSKEY_TOKEN, {
        text,
        mediaIds
    });
    
    if (result) {
        const info_message = '投稿に成功しました';
        await writeLog('info', 'createNoteWithMedia', info_message, null, null);
    } else {
        const error_message = '投稿に失敗しました';
        await writeLog('error', 'createNoteWithMedia', error_message, null, null);
    }
    return result;
}

async function createNote(text) {
    const currentHeat = await getMultiKVoperation('protection', 'heat');
    const maxHeat = await getMultiKVoperation('settings', 'max_heat');
    if (Number(maxHeat) !== null && Number(currentHeat) > Number(maxHeat)) {
        const error_message = `投稿回数が制限(${maxHeat}回)を超えました。\n現在のHeat値は${currentHeat}です`;
        await writeLog('error', 'createNote', error_message, null, null); 
        return null;
    }
    
    const result = await createMisskeyNote(MISSKEY_TOKEN, {
        text
    });
    
    if (result) {
        const info_message = '投稿に成功しました';
        await writeLog('info', 'createNote', info_message, null, null);
    } else {
        const error_message = '投稿に失敗しました';
        await writeLog('error', 'createNote', error_message, null, null);
    }
    return result;
}

async function sendReply(text, visibility, replyId) {
    const currentHeat = await getMultiKVoperation('protection', 'heat');
    const maxHeat = await getMultiKVoperation('settings', 'max_heat');
    
    if (Number(maxHeat) !== null && Number(currentHeat) > Number(maxHeat)) {
        const error_message = `投稿回数が制限(${maxHeat}回)を超えました。\n現在のHeat値は${currentHeat}です`;
        await writeLog('error', 'sendReply', error_message, null, null); 
        return null;
    }
    
    const result = await createMisskeyNote(MISSKEY_TOKEN, {
        text,
        visibility,
        replyId
    });
    
    if (result) {
        const info_message = 'リプライ投稿に成功しました';
        await writeLog('info', 'createNote', info_message, null, null);
    } else {
        const error_message = 'リプライ投稿に失敗しました';
        await writeLog('error', 'createNote', error_message, null, null);
    }
    return result;
}

async function sendDM(text) {
    const currentHeat = await getMultiKVoperation('protection', 'heat');
    const maxHeat = await getMultiKVoperation('settings', 'max_heat');
    
    if (Number(maxHeat) !== null && Number(currentHeat) > Number(maxHeat)) {
        const error_message = `投稿回数が制限(${maxHeat}回)を超えました。\n現在のHeat値は${currentHeat}です`;
        await writeLog('error', 'sendDM', error_message, null, null); 
        return null;
    }

    const result = await createMisskeyNote(MISSKEY_TOKEN, {
        text,
        visibility: "specified",
        visibleUserIds: [TARGET_USER_ID]
    });
    
    if (result) {
        const info_message = '管理者へのDM投稿に成功しました';
        await writeLog('info', 'createNote', info_message, null, null);
    } else {
        const error_message = '管理者へのDM投稿に失敗しました';
        await writeLog('error', 'createNote', error_message, null, null);
    }
    return result;
}

// アプリケーション起動時にDB接続テストを実行
checkDBConnection().then(async success => {
    if (!success) {
        const error_message = 'データベース接続テストに失敗しました。設定を確認してください。';
        await writeLog('error', 'createNote', error_message, null, null);
    }
});

// エクスポート
export {
    createMisskeyNote,
    sendDM,
    sendReply,
    createNote,
    createNoteWithMedia
};
