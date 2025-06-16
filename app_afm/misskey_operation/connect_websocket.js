import WebSocket from 'ws';
import { config } from 'dotenv';
import { processMentions } from '../processing_mentions.js';
import { processFollow } from '../prosessing_follow.js';
import { processGtlNote } from '../misskey_operation/processing_gtl_note.js';
import { writeLog } from '../db_operation/create_logs.js';
import { air_reply_ollama } from '../webpage_operation/connect_ollama.js';
import { createMisskeyReaction } from './create_reaction.js';   
config();


const MISSKEY_TOKEN = process.env.NOTICE_MISSKEY_TOKEN;
const MISSKEY_URL = process.env.NOTICE_MISSKEY_URL;
const MISSKEY_USER_ID = process.env.NOTICE_MISSKEY_BOT_USER_ID;
const EXCLUSION_MISSKEY_HOST = process.env.EXCLUSION_MISSKEY_HOST || 'misskey.seitendan.com';

// 再試行回数を追跡する変数を追加
let retryCount_hybrid = 0;
let retryCount_global = 0;
let retryCount_main = 0;

// 現在のWebSocket接続を保持する変数を追加
let currentWs_hybrid = null;
let currentWs_global = null;
let currentWs_main = null;

// WebSocketのオプション設定
const WS_OPTIONS = {
    handshakeTimeout: 30000, // 30秒のハンドシェイクタイムアウト
    timeout: 30000, // 30秒の接続タイムアウト
    headers: {
        'User-Agent': 'MisskeyBot/1.0'
    },
    followRedirects: true
};

// WebSocketを安全に切断するヘルパー関数
async function safelyCloseWebSocket(ws) {
    return new Promise((resolve) => {
        if (!ws || ws.readyState === WebSocket.CLOSED) {
            console.log("WebSocketは既に閉じられているか無効です");
            resolve();
            return;
        }

        // タイムアウト処理を追加（5秒後に強制的に解決）
        const timeout = setTimeout(() => {
            console.log("WebSocket切断がタイムアウトしました - 強制解決します");
            resolve();
        }, 5000);

        const onClose = () => {
            clearTimeout(timeout);
            ws.removeEventListener('close', onClose);
            console.log("WebSocketが正常に閉じられました");
            resolve();
        };

        ws.addEventListener('close', onClose);

        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        } else if (ws.readyState === WebSocket.CLOSING) {
            // すでにクローズ中なので、closeイベントを待つだけ
            console.log("WebSocketは既にクローズ中です");
        } else {
            // 接続中でもクローズ中でもない場合はすぐに解決
            clearTimeout(timeout);
            resolve();
        }
    });
}

function connectWebSocket_hybrid() {
    try {
        const wsHost = MISSKEY_URL.replace('https://', '');
        const wsUrl = `wss://${wsHost}/streaming?i=${MISSKEY_TOKEN}`;
        
        // 既存の接続があれば切断
        if (currentWs_hybrid && currentWs_hybrid.readyState !== WebSocket.CLOSED) {
            console.log("既存のhybrid WebSocket接続を切断します...");
            return safelyCloseWebSocket(currentWs_hybrid)
                .then(() => {
                    console.log("既存のhybrid WebSocket接続を切断しました、新たに接続を確立します");
                    return createHybridWebSocket(wsUrl);
                });
        } else {
            return createHybridWebSocket(wsUrl);
        }
    } catch (error) {
        writeLog('error', 'connectWebSocket_hybrid', `接続試行中に例外が発生: ${error.message || error}`, null, null);
        
        // 接続試行エラー後の再試行
        const retryDelay = retryCount_hybrid >= 12 ? 3600000 : 5000 * Math.pow(1.5, retryCount_hybrid);
        return new Promise(resolve => {
            setTimeout(() => {
                console.log('WebSocket_hybridの再接続を試みます...');
                retryCount_hybrid++;
                resolve(connectWebSocket_hybrid());
            }, retryDelay);
        });
    }
}

// 実際の接続を作成する関数を分離
function createHybridWebSocket(wsUrl) {
    return new Promise((resolve, reject) => {
        try {
            const ws = new WebSocket(wsUrl, WS_OPTIONS);
            currentWs_hybrid = ws; // 新しい接続を保存

            // ピンポンでの接続維持
            let pingInterval;
            
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
                
                // 60秒ごとにpingを送信して接続を維持
                pingInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.ping();
                    }
                }, 60000);
                
                resolve(ws);
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
                
                if (note.text && note.text.includes('ラーベちゃん') && Math.floor(Math.random() * 5) === 0) {
                    createMisskeyReaction(note.id, ':astrolabe_icon:'); // ラーベちゃんの投稿にリアクションを追加
                    writeLog('info', 'connectWebSocket_hybrid', `ラーベちゃんの投稿にリアクションを追加: ${note.id}`, null, null);
                    return; // ラーベちゃんの投稿はここで処理を終了
                }

                // エアリプOllama処理を実行
                if (note.text && note.userId !== MISSKEY_USER_ID ) {
                    // HTMLタグを除去し、空白をトリム
                    let Ollama_note_text = note.text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(); 
                    // URLを除去
                    Ollama_note_text = Ollama_note_text.replace(/https?:\/\/[^\s]+/g, '');
                    // :emoji: のようなカスタム絵文字を除去
                    Ollama_note_text = Ollama_note_text.replace(/:[a-zA-Z0-9_]+:/g, '');
                    if (Math.floor(Math.random() * 20) === 0 && note.user.host === null && Ollama_note_text.length >= 10) {
                        air_reply_ollama(Ollama_note_text,note.id);
                        writeLog('info', 'connectWebSocket_hybrid',
                            `エアリプOllama処理を実行_ホストインスタンスの投稿: ${Ollama_note_text}`, null, null)
                        return; // エアリプOllama処理を実行
                    } // else if (Math.floor(Math.random() * 50) === 0 && Ollama_note_text.length >= 40) {
                    //    air_reply_ollama(Ollama_note_text,note.id);
                    //    writeLog('info', 'connectWebSocket_hybrid',
                    //        `エアリプOllama処理を実行_一般インスタンスの投稿: ${Ollama_note_text}`, null, null);
                    //    return; // エアリプOllama処理を実行
                    //}
                     else {
                        console.log('エアリプOllama処理はスキップされました',note.user.host, note);
                        writeLog('info', 'connectWebSocket_hybrid',
                            `エアリプOllama処理はスキップされました:${note.user.host} ${Ollama_note_text}`, null, null);
                        return; // エアリプOllama処理をスキップ
                    }
                }
            }

            ws.on('error', async (error) => {
                clearInterval(pingInterval);
                await writeLog('error', 'connectWebSocket_hybrid', `WebSocketエラー: ${error.message || error}`, null, null);
                
                // エラー後に自動再接続させるため、closeイベントが発火しない場合は明示的にクローズ
                if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
                    safelyCloseWebSocket(ws).then(() => {
                        console.log("エラー後にWebSocket_hybrid接続を切断しました");
                        reject(error);
                    });
                } else {
                    reject(error);
                }
            });

            ws.on('close', async () => {
                clearInterval(pingInterval);
                // 現在のインスタンスが自分自身であることを確認
                if (currentWs_hybrid === ws) {
                    currentWs_hybrid = null;
                }
                
                // 指数バックオフを実装 (最大1時間)
                const baseDelay = 5000;
                const maxDelay = 3600000; // 1時間
                const delay = Math.min(baseDelay * Math.pow(1.5, retryCount_hybrid), maxDelay);
                
                await writeLog('info', 'connectWebSocket_hybrid', 
                    `WebSocket接続が閉じられました。${delay/1000}秒後に再接続を試みます。(試行回数: ${retryCount_hybrid + 1})`, 
                    null, null);
                
                setTimeout(() => {
                    console.log('WebSocket_hybridの再接続を試みます...');
                    retryCount_hybrid++;
                    connectWebSocket_hybrid();
                }, delay);
            });

            // pingに対するpongイベント
            ws.on('pong', () => {
                console.log('Pong received from server (hybrid)');
            });

        } catch (error) {
            reject(error);
        }
    });
}

function connectWebSocket_global() {
    try {
        const wsHost = MISSKEY_URL.replace('https://', '');
        const wsUrl = `wss://${wsHost}/streaming?i=${MISSKEY_TOKEN}`;
        
        // 既存の接続があれば切断
        if (currentWs_global && currentWs_global.readyState !== WebSocket.CLOSED) {
            console.log("既存のglobal WebSocket接続を切断します...");
            return safelyCloseWebSocket(currentWs_global)
                .then(() => {
                    console.log("既存のglobal WebSocket接続を切断しました、新たに接続を確立します");
                    return createGlobalWebSocket(wsUrl);
                });
        } else {
            return createGlobalWebSocket(wsUrl);
        }
    } catch (error) {
        writeLog('error', 'connectWebSocket_global', `接続試行中に例外が発生: ${error.message || error}`, null, null);
        
        // 接続試行エラー後の再試行
        const retryDelay = retryCount_global >= 12 ? 3600000 : 5000 * Math.pow(1.5, retryCount_global);
        return new Promise(resolve => {
            setTimeout(() => {
                console.log('WebSocket_globalの再接続を試みます...');
                retryCount_global++;
                resolve(connectWebSocket_global());
            }, retryDelay);
        });
    }
}

// 実際の接続を作成する関数を分離
function createGlobalWebSocket(wsUrl) {
    return new Promise((resolve, reject) => {
        try {
            const ws = new WebSocket(wsUrl, WS_OPTIONS);
            currentWs_global = ws; // 新しい接続を保存

            // ピンポンでの接続維持
            let pingInterval;

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
                
                // 60秒ごとにpingを送信して接続を維持
                pingInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.ping();
                    }
                }, 60000);
                
                resolve(ws);
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

            // ノート処理関数
            function handleNote(note) {
                processGtlNote(note);        
            }

            ws.on('error', async (error) => {
                clearInterval(pingInterval);
                await writeLog('error', 'connectWebSocket_global', `WebSocketエラー: ${error.message || error}`, null, null);
                
                // エラー後に自動再接続させるため、closeイベントが発火しない場合は明示的にクローズ
                if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
                    safelyCloseWebSocket(ws).then(() => {
                        console.log("エラー後にWebSocket_global接続を切断しました");
                        reject(error);
                    });
                } else {
                    reject(error);
                }
            });

            ws.on('close', async () => {
                clearInterval(pingInterval);
                // 現在のインスタンスが自分自身であることを確認
                if (currentWs_global === ws) {
                    currentWs_global = null;
                }
                
                // 指数バックオフを実装 (最大1時間)
                const baseDelay = 5000;
                const maxDelay = 3600000; // 1時間
                const delay = Math.min(baseDelay * Math.pow(1.5, retryCount_global), maxDelay);
                
                await writeLog('info', 'connectWebSocket_global', 
                    `WebSocket接続が閉じられました。${delay/1000}秒後に再接続を試みます。(試行回数: ${retryCount_global + 1})`, 
                    null, null);
                
                setTimeout(() => {
                    console.log('WebSocket_globalの再接続を試みます...');
                    retryCount_global++;
                    connectWebSocket_global();
                }, delay);
            });

            // pingに対するpongイベント
            ws.on('pong', () => {
                console.log('Pong received from server (global)');
            });

        } catch (error) {
            reject(error);
        }
    });
}

function connectWebSocket_main() {
    try {
        const wsHost = MISSKEY_URL.replace('https://', '');
        const wsUrl = `wss://${wsHost}/streaming?i=${MISSKEY_TOKEN}`;
        
        // 既存の接続があれば切断
        if (currentWs_main && currentWs_main.readyState !== WebSocket.CLOSED) {
            console.log("既存のmain WebSocket接続を切断します...");
            return safelyCloseWebSocket(currentWs_main)
                .then(() => {
                    console.log("既存のmain WebSocket接続を切断しました、新たに接続を確立します");
                    return createMainWebSocket(wsUrl);
                });
        } else {
            return createMainWebSocket(wsUrl);
        }
    } catch (error) {
        writeLog('error', 'connectWebSocket_main', `接続試行中に例外が発生: ${error.message || error}`, null, null);
        
        // 接続試行エラー後の再試行
        const retryDelay = retryCount_main >= 12 ? 3600000 : 5000 * Math.pow(1.5, retryCount_main);
        return new Promise(resolve => {
            setTimeout(() => {
                console.log('WebSocket_mainの再接続を試みます...');
                retryCount_main++;
                resolve(connectWebSocket_main());
            }, retryDelay);
        });
    }
}

// 実際の接続を作成する関数を分離
function createMainWebSocket(wsUrl) {
    return new Promise((resolve, reject) => {
        try {
            const ws = new WebSocket(wsUrl, WS_OPTIONS);
            currentWs_main = ws; // 新しい接続を保存

            // ピンポンでの接続維持
            let pingInterval;

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
                
                // 60秒ごとにpingを送信して接続を維持
                pingInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.ping();
                    }
                }, 60000);
                
                resolve(ws);
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

            // follow処理関数
            function handleFollow(notice) {
                processFollow(notice);
            }

            ws.on('error', async (error) => {
                clearInterval(pingInterval);
                await writeLog('error', 'connectWebSocket_main', `WebSocket_mainエラー: ${error.message || error}`, null, null);
                
                // エラー後に自動再接続させるため、closeイベントが発火しない場合は明示的にクローズ
                if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
                    safelyCloseWebSocket(ws).then(() => {
                        console.log("エラー後にWebSocket_main接続を切断しました");
                        reject(error);
                    });
                } else {
                    reject(error);
                }
            });

            ws.on('close', async () => {
                clearInterval(pingInterval);
                // 現在のインスタンスが自分自身であることを確認
                if (currentWs_main === ws) {
                    currentWs_main = null;
                }
                
                // 指数バックオフを実装 (最大1時間)
                const baseDelay = 5000;
                const maxDelay = 3600000; // 1時間
                const delay = Math.min(baseDelay * Math.pow(1.5, retryCount_main), maxDelay);
                
                await writeLog('info', 'connectWebSocket_main', 
                    `WebSocket接続が閉じられました。${delay/1000}秒後に再接続を試みます。(試行回数: ${retryCount_main + 1})`, 
                    null, null);
                
                setTimeout(() => {
                    console.log('WebSocket_mainの再接続を試みます...');
                    retryCount_main++;
                    connectWebSocket_main();
                }, delay);
            });

            // pingに対するpongイベント
            ws.on('pong', () => {
                console.log('Pong received from server (main)');
            });
            
        } catch (error) {
            reject(error);
        }
    });
}

// WebSocketの状態を確認する関数
function checkWebSocketStatus() {
    const states = {
        0: 'CONNECTING',
        1: 'OPEN',
        2: 'CLOSING',
        3: 'CLOSED'
    };
    
    const status = {
        hybrid: {
            connected: currentWs_hybrid !== null && currentWs_hybrid.readyState === WebSocket.OPEN,
            state: currentWs_hybrid ? states[currentWs_hybrid.readyState] : 'NULL',
            retryCount: retryCount_hybrid
        },
        global: {
            connected: currentWs_global !== null && currentWs_global.readyState === WebSocket.OPEN,
            state: currentWs_global ? states[currentWs_global.readyState] : 'NULL',
            retryCount: retryCount_global
        },
        main: {
            connected: currentWs_main !== null && currentWs_main.readyState === WebSocket.OPEN,
            state: currentWs_main ? states[currentWs_main.readyState] : 'NULL',
            retryCount: retryCount_main
        }
    };
    
    return status;
}

export { connectWebSocket_hybrid, connectWebSocket_main, connectWebSocket_global, checkWebSocketStatus };
