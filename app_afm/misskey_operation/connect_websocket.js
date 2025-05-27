import WebSocket from 'ws';
import { config } from 'dotenv';
import { processMentions } from '../processing_mentions.js';
import { processFollow } from '../prosessing_follow.js';
import { processGtlNote } from '../misskey_operation/processing_gtl_note.js';
import { writeLog } from '../db_operation/create_logs.js';

config();

const MISSKEY_TOKEN = process.env.NOTICE_MISSKEY_TOKEN;
const MISSKEY_URL = process.env.NOTICE_MISSKEY_URL;

// 再試行回数を追跡する変数を追加
let retryCount_hybrid = 0;
let retryCount_global = 0;
let retryCount_main = 0;

// 現在のWebSocket接続を保持する変数を追加
let currentWs_hybrid = null;
let currentWs_global = null;
let currentWs_main = null;

// WebSocketを安全に切断するヘルパー関数
async function safelyCloseWebSocket(ws) {
    return new Promise((resolve) => {
        if (!ws || ws.readyState === WebSocket.CLOSED) {
            resolve();
            return;
        }

        const onClose = () => {
            ws.removeEventListener('close', onClose);
            resolve();
        };

        ws.addEventListener('close', onClose);

        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        } else if (ws.readyState === WebSocket.CLOSING) {
            // すでにクローズ中なので、closeイベントを待つだけ
        } else {
            // 接続中でもクローズ中でもない場合はすぐに解決
            resolve();
        }
    });
}

function connectWebSocket_hybrid() {
    const wsHost = MISSKEY_URL.replace('https://', '');
    const wsUrl = `wss://${wsHost}/streaming?i=${MISSKEY_TOKEN}`;
    
    // 既存の接続があれば切断
    if (currentWs_hybrid && currentWs_hybrid.readyState !== WebSocket.CLOSED) {
        safelyCloseWebSocket(currentWs_hybrid).then(() => {
            console.log("既存のhybrid WebSocket接続を切断しました");
        });
    }
    
    const ws = new WebSocket(wsUrl);
    currentWs_hybrid = ws; // 新しい接続を保存

    ws.on('open', async () => {
        retryCount_hybrid = 0; // 接続成功時にリセット
        await writeLog('info', 'connectWebSocket_hybrid', 'WebSocket接続が確立されました', null, null);
        
        const connectMessage = {
            type: 'connect',
            body: {
                channel: 'hybridTimeline',
                id: 'hybrid-timeline',
                params: {}
            }
        };
        
        ws.send(JSON.stringify(connectMessage));
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            // メッセージタイプに基づいて処理を分岐
            if (message.type === 'channel' && message.body.type === 'note') {
                const note = message.body.body;
                handleNote(note);
            }

        } catch (error) {
            writeLog('error', 'connectWebSocket_hybrid', `メッセージのパース中にエラーが発生: ${error}`, null, null);
        }
    });

    // ノート処理関数を修正
    function handleNote(note) {
        // メンションを含むノートの場合、処理を実行
        if (note.mentions && note.mentions.length > 0) {
            processMentions(note);
        }
    }

    ws.on('error', async (error) => {
        await writeLog('error', 'connectWebSocket_hybrid', `WebSocketエラー: ${error}`, null, null);
    });

    ws.on('close', async () => {
        // 現在のインスタンスが自分自身であることを確認
        if (currentWs_hybrid === ws) {
            currentWs_hybrid = null;
        }
        
        const retryDelay = retryCount_hybrid >= 12 ? 3600000 : 5000; // 12回以上は1時間待機
        await writeLog('info', 'connectWebSocket_hybrid', 
            `WebSocket接続が閉じられました。${retryDelay/1000}秒後に再接続を試みます。(試行回数: ${retryCount_hybrid + 1})`, 
            null, null);
        
        setTimeout(() => {
            console.log('WebSocket再接続を試みます...');
            retryCount_hybrid++;
            connectWebSocket_hybrid();
        }, retryDelay);
    });

    return ws;
}

function connectWebSocket_global() {
    const wsHost = MISSKEY_URL.replace('https://', '');
    const wsUrl = `wss://${wsHost}/streaming?i=${MISSKEY_TOKEN}`;
    
    // 既存の接続があれば切断
    if (currentWs_global && currentWs_global.readyState !== WebSocket.CLOSED) {
        safelyCloseWebSocket(currentWs_global).then(() => {
            console.log("既存のglobal WebSocket接続を切断しました");
        });
    }
    
    const ws = new WebSocket(wsUrl);
    currentWs_global = ws; // 新しい接続を保存

    ws.on('open', async () => {
        retryCount_global = 0; // 接続成功時にリセット
        await writeLog('info', 'connectWebSocket_global', 'WebSocket_global接続が確立されました', null, null);
        
        const connectMessage = {
            type: 'connect',
            body: {
                channel: 'globalTimeline',
                id: 'global-Timeline',
                params: {}
            }
        };
        
        ws.send(JSON.stringify(connectMessage));
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            // メッセージタイプに基づいて処理を分岐
            if (message.type === 'channel' && message.body.type === 'note') {
                const note = message.body.body;
                handleNote(note);
            }

        } catch (error) {
            writeLog('error', 'connectWebSocket_global', `メッセージのパース中にエラーが発生: ${error}`, null, null);
        }
    });

    // ノート処理関数を修正
    function handleNote(note) {
        processGtlNote(note);        

    }

    ws.on('error', async (error) => {
        await writeLog('error', 'connectWebSocket_global', `WebSocketエラー: ${error}`, null, null);
    });

    ws.on('close', async () => {
        // 現在のインスタンスが自分自身であることを確認
        if (currentWs_global === ws) {
            currentWs_global = null;
        }
        
        const retryDelay = retryCount_global >= 12 ? 3600000 : 5000; // 12回以上は1時間待機
        await writeLog('info', 'connectWebSocket_global', 
            `WebSocket接続が閉じられました。${retryDelay/1000}秒後に再接続を試みます。(試行回数: ${retryCount_global + 1})`, 
            null, null);
        
        setTimeout(() => {
            console.log('WebSocket再接続を試みます...');
            retryCount_global++;
            connectWebSocket_global();
        }, retryDelay);
    });

    return ws;
}

function connectWebSocket_main() {
    const wsHost = MISSKEY_URL.replace('https://', '');
    const wsUrl = `wss://${wsHost}/streaming?i=${MISSKEY_TOKEN}`;
    
    // 既存の接続があれば切断
    if (currentWs_main && currentWs_main.readyState !== WebSocket.CLOSED) {
        safelyCloseWebSocket(currentWs_main).then(() => {
            console.log("既存のmain WebSocket接続を切断しました");
        });
    }
    
    const ws = new WebSocket(wsUrl);
    currentWs_main = ws; // 新しい接続を保存

    ws.on('open', async () => {
        retryCount_main = 0; // 接続成功時にリセット
        await writeLog('info', 'connectWebSocket_main', 'WebSocket_main接続が確立されました', null, null);
        
        const connectMessage = {
            type: 'connect',
            body: {
                channel: 'main',
                id: 'main',
                params: {}
            }
        };
        
        ws.send(JSON.stringify(connectMessage));
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
           
            if (message.type === 'channel') {
                if (message.body.type === 'followed') {
                    writeLog('info', 'connectWebSocket_main', `フォローイベント受信: ${JSON.stringify(message.body)}`, null, null);
                    const notice = message.body.body;
                    handleFollow(notice);
                }
            }

        } catch (error) {
            writeLog('error', 'connectWebSocket_main', `メッセージのパース中にエラーが発生: ${error}`, null, null);
        }
    });

    // follow処理関数を修正
    function handleFollow(notice) {
        processFollow(notice);

    }

    ws.on('error', async (error) => {
        await writeLog('error', 'connectWebSocket_main', `WebSocket_mainエラー: ${error}`, null, null);
    });

    ws.on('close', async () => {
        // 現在のインスタンスが自分自身であることを確認
        if (currentWs_main === ws) {
            currentWs_main = null;
        }
        
        const retryDelay = retryCount_main >= 12 ? 3600000 : 5000; // 12回以上は1時間待機
        await writeLog('info', 'connectWebSocket_main', 
            `WebSocket_main接続が閉じられました。${retryDelay/1000}秒後に再接続を試みます。(試行回数: ${retryCount_main + 1})`, 
            null, null);
        
        setTimeout(() => {
            console.log('WebSocket_main再接続を試みます...');
            retryCount_main++;
            connectWebSocket_main();
        }, retryDelay);
    });

    return ws;
}

export { connectWebSocket_hybrid, connectWebSocket_main, connectWebSocket_global };
