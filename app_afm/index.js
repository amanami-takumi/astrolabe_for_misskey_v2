import { config } from 'dotenv';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';
import { sendDM, createNote, createNoteWithMedia } from './misskey_operation/create_note.js';
import { uploadMisskeyFile} from './misskey_operation/create_file.js';
import { getMultiFeed, getMultiFeed_v2} from './webpage_operation/get_feed.js';
import { getRandomDinner } from './db_operation/get_dinner.js';
import { executeMaintenance } from './maintenance.js';
import { getRandomDinnerText, getRandomNoteText} from './db_operation/get_note_text.js';
import { updateMultiMemorandum } from './db_operation/update_memorandum.js';
import { getMemorandumDinnerText, getMultiMemorandum} from './db_operation/get_memorandum.js';
import { updateMultiKVoperation, getMultiKVoperation } from './db_operation/multi_db_connection.js';
import {connectWebSocket_hybrid, connectWebSocket_main, connectWebSocket_global, checkWebSocketStatus} from './misskey_operation/connect_websocket.js';
import { writeLog } from './db_operation/create_logs.js';
import {getScraping} from './webpage_operation/get_scraping.js';
import schedule from 'node-schedule';
import { getMisskeyEmojiList, getMisskeyEmojiListSingle } from './misskey_operation/get_emoji.js';
import { send } from 'process';
import { summary_ollama } from './webpage_operation/connect_ollama.js';
import {createMisskeyRenote} from './misskey_operation/create_renote.js';
import { setupWebhookRoutes } from './receive_web_hook/receive_web_hook.js';
import express from 'express';
import http from 'http';
const app = express();


config();

const scheduleOptions = {
    tz: 'Asia/Tokyo'
  };
  
const __dirname = dirname(fileURLToPath(import.meta.url));
let noteText;




async function breakfast(){
    // 0-30分のランダムな待機時間を設定
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 31) * 60 * 1000));

    const breakfast_text = await getMemorandumDinnerText();
    if (breakfast_text == '満腹') {
        const info_message = '朝食の投稿はありません';
        await writeLog('info', 'breakfast', info_message, null, null);
        return;
    }
    else{
        const message = `むぅ……なんだかお腹が空いてきました。\nあ、そうだ！昨日の『${breakfast_text}』を温め直しましょう＾＾`;
        const result = await createNote(message); 
    }  
}

async function morning_greeting() {
    // 0-30分のランダムな待機時間を設定
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 31) * 60 * 1000));

    const message = await getRandomNoteText('morning_greeting');
    const result = await createNote(message);
    const info_message = '朝の挨拶を実行';
    await writeLog('info', 'morning_greeting', info_message, null, null);
}



async function bathing() {
    // 0-30分のランダムな待機時間を設定
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 31) * 60 * 1000));

    const message = await getRandomNoteText('bathing');
    const result = await createNote(message);
    const info_message = '入浴を実行';
    await writeLog('info', 'bathing', info_message, null, null);
}

async function night_greeting() {
    // 0-30分のランダムな待機時間を設定
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 31) * 60 * 1000));

    const message = await getRandomNoteText('night_greeting');
    const result = await createNote(message);
    
    const info_message = '夜の挨拶を実行';
    await writeLog('info', 'night_greeting', info_message, null, null);
}

async function multi_feed_v2(FeedURL) {
    try {
        // 0-30分のランダムな待機時間を設定
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 31) * 60 * 1000));
        const News = await getMultiFeed_v2(FeedURL);
        //console.log(News);

        // フィードが空または無効な場合の早期リターン
        // News が記事オブジェクトの配列であると仮定
        if (!News || !Array.isArray(News) || News.length === 0 || !News[0].link) {
            const warn_message = `フィードが空または無効です (News is not a valid array or is empty, or first item has no link): ${FeedURL}`;
            await writeLog('warn', 'multi_feed_v2', warn_message, null, null);
            return;
        }

        // DBに保存されている前回分のFeedリンクを取得
        let old_feed_links = await getMultiMemorandum(FeedURL); // URL文字列の配列を期待
        if (!Array.isArray(old_feed_links)) {
            old_feed_links = []; // nullまたは未定義の場合は空の配列で初期化
        }
        
        // 前回のリンクと最新のリンクを比較し、差分を取得する。
        // News は {link: string, title: string, ...} のようなオブジェクトの配列と仮定
        const new_feed_links = News.map(item => item.link); // URL文字列の配列
        const added_links = new_feed_links.filter(link => !old_feed_links.includes(link));
        // const removed_links = old_feed_links.filter(link => !new_feed_links.includes(link)); // removed_links は現在未使用

        // 追加されたリンクがない場合は処理を終了
        if (added_links.length === 0) {
            const info_message = `新しい記事はありませんでした: ${FeedURL}`;
            await writeLog('info', 'multi_feed_v2', info_message, null, null);
            return;
        }
        // 追加されたリンクの中からランダムで一つ抽出する
        await writeLog('info', 'multi_feed_v2', `新しい記事が見つかりました: ${added_links.length}件`, null, null);
        const randomLink = added_links[Math.floor(Math.random() * added_links.length)];

        // 取得したフィードの最新記事をスクレイピングして要約を生成
        const scrapingResult = await getScraping(randomLink, false); // { title, mainContent } を期待

        let news_comment;
        const MAX_CONTEXT_LENGTH = 2000;

        if (scrapingResult && scrapingResult.mainContent) {
            let contentToSummarize = scrapingResult.mainContent;
            if (contentToSummarize.length > MAX_CONTEXT_LENGTH) {
                contentToSummarize = contentToSummarize.substring(0, MAX_CONTEXT_LENGTH);
                await writeLog('info', 'multi_feed_v2', `Scraping text for ${randomLink} was truncated to ${MAX_CONTEXT_LENGTH} characters.`, null, null);
            }
            await writeLog('info', 'multi_feed_v2', `テキストのスクレイピング結果: ${contentToSummarize}`, null, null);
            news_comment = await summary_ollama(contentToSummarize);
            if (!news_comment) { // summary_ollamaがエラー等でnullを返した場合
                news_comment = "記事の要約を生成できませんでした。";
                await writeLog('warn', 'multi_feed_v2', `Failed to generate summary for ${randomLink}.`, null, null);
                return;
            }

        } else {
            await writeLog('warn', 'multi_feed_v2', `No main content found for scraping: ${randomLink}. Cannot generate summary.`, null, null);
            news_comment = "記事の要約を生成できませんでした。";
            return;
        }

        // 取得した最新記事のリンク(全件)をDBに保存
        await updateMultiMemorandum(FeedURL, new_feed_links); // new_feed_links (URL文字列の配列) を保存
        
        const FeedName = FeedURL.replace('https://', '').replace('.com', '').replace('.jp', '').replace('.co.jp', '').replace('/feed', '');
        const info_message_log = `Feed(${FeedName})の新記事(${randomLink})の投稿処理を実行`;
        await writeLog('info', 'multi_feed_v2', info_message_log, null, null);

        // スクレイピング結果のタイトルを優先し、なければフィード情報、それもなければ固定文字列
        const selectedArticleInFeed = News.find(article => article.link === randomLink);
        const articleTitle = scrapingResult.title || (selectedArticleInFeed ? selectedArticleInFeed.title : "タイトル不明");
        // articleTitleから「facebookhatebuPocket」と「ホームlogin」を除去、「GIGAZINEGIGAZINE」を「GIGAZINE」に置換
        let cleanedTitle = articleTitle.replace(/facebookhatebuPocket/g, '').replace(/ホームlogin/g, '').replace(/GIGAZINEGIGAZINE/g, 'GIGAZINE').trim();

        news_comment = news_comment.replace(/。$/, ' ').trim(); // 。を削除する。
        news_comment = news_comment.replace(/「|」/g, '').trim(); // 「」の記号だけを削除し、内容は保持する
        news_comment = news_comment.replace(/“.*?”/g, ' ').trim(); // ”を削除する。
        news_comment = news_comment.replace(/！.*?/g, ' ').trim(); // ！を削除する。
        const message = `${news_comment}らしい。\n\n${cleanedTitle}\n${randomLink}`;
        const result = await createNote(message);

    } catch (error) {
        const error_message = `フィード処理エラー (multi_feed_v2 for ${FeedURL}): ${error.message}`;
        await writeLog('error', 'multi_feed_v2', error_message, null, error.stack); // エラーオブジェクト全体やスタックトレースも記録するとデバッグに役立つ
        console.error(error_message, error);
    }
}

async function multi_feed(FeedURL) {
    try {
        // 0-30分のランダムな待機時間を設定
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 31) * 60 * 1000));
        const News = await getMultiFeed(FeedURL,1);
        
        // フィードが空または無効な場合の早期リターン
        if (!News || News.length === 0 || !News[0].link) {
            const FeedName = FeedURL.replace('https://', '').replace(/\.(com|jp|co\.jp)/, '').replace('/feed', '');
            const error_message = `Feed(${FeedName})の取得に失敗しました`;
            await writeLog('error', 'multi_feed', error_message, null, null);
            return;
        }

        const news_comment = await getRandomNoteText(`feed_text`);
        // debug用 console.log(News);
        const FeedResult = await getMultiMemorandum(FeedURL);
        if (FeedResult == News[0].link) {
            const FeedName = FeedURL.replace('https://', '').replace('.com', '').replace('.jp', '').replace('.co.jp', '').replace('/feed', '');
            const info_message = `Feed(${FeedName})は前回の実行から更新されていません`;
            await writeLog('info', 'multi_feed', info_message, null, null);
            return;
        }
        await updateMultiMemorandum(FeedURL, `${News[0].link}`);
        
        const FeedName = FeedURL.replace('https://', '').replace('.com', '').replace('.jp', '').replace('.co.jp', '').replace('/feed', '');
        const info_message = `Feed(${FeedName})の投稿を実行`;
        await writeLog('info', 'multi_feed', info_message, null, null);

        const message = `${news_comment}\n\n${News[0].title}\n${News[0].link}`;
        const result = await createNote(message);
    } catch (error) {
        const error_message = `フィード処理エラー: ${error.message}`;
        await writeLog('error', 'multi_feed', error_message, null, null);
    }
}

async function python_connect(endpoint) {
    try {
        // 0-30分のランダムな待機時間を設定
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 31) * 60 * 1000));



        const response = await axios.get(`http://python-afm:3000${endpoint}`);
        
        if (response.data && response.data.text) {
            const message = `${response.data.text}`;
            await createNote(message);
            // \n\n<i><small>(これは自動生成です。不適切な場合は@takumin3211までお伝え下さい)</small></i>
            // const info_message = 'Python生成テキストの投稿を実行';
            // await writeLog('info', 'python_connect', info_message, null, null);
        } else {
            throw new Error('テキストデータが見つかりません');
        }
    } catch (error) {
        const error_message = `Python接続エラー: ${error.message}`;
        await writeLog('error', 'python_connect', error_message, null, null);
        console.error(error_message);
    }
}

async function python_connect_wordcloud(endpoint) {
    try {
        const response = await axios.get(`http://python-afm:3000${endpoint}`, {
            responseType: 'arraybuffer'  // バイナリデータとして受け取る
        });
        
        if (response.data) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '');
            const filename = `wordcloud_${timestamp}.png`;
            
            // ファイルをMisskeyにアップロード
            const fileId = await uploadMisskeyFile(
                response.data,
                filename,
                'image/png'
            );

            if (fileId) {
                const message = `直近4時間のグローバルタイムラインから生成したワードクラウドができました！\n<i><small>頻出ワードや注意が必要な言葉は除外しています</small></i>`;
                await createNoteWithMedia(message, [fileId]);
                
                const info_message = 'ワードクラウドの投稿を実行';
                await writeLog('info', 'python_connect_wordcloud', info_message, null, null);
            } else {
                throw new Error('ファイルのアップロードに失敗しました');
            }
        } else {
            throw new Error('画像データが見つかりません');
        }
    } catch (error) {
        const error_message = `ワードクラウド生成エラー: ${error.message}`;
        await writeLog('error', 'python_connect_wordcloud', error_message, null, null);
        console.error(error_message);
    }
}

async function emoji_difference() {
    try {
        const emoji_list = await getMultiKVoperation('memorandum', 'emoji_list');

        const new_emoji_list = await getMisskeyEmojiList();
        

        // 新規絵文字リストの検証
        if (!Array.isArray(new_emoji_list) || new_emoji_list.length === 0) {
            const error_message = '新規絵文字リストの取得に失敗しました';
            await writeLog('error', 'emoji_difference', error_message, null, null);
            return;
        }

        // 初回実行時の処理
        if (!emoji_list) {
            console.log('初回の絵文字リストを保存します');
            try {
                await updateMultiKVoperation('memorandum', new_emoji_list, 'emoji_list');
                const info_message = '初回の絵文字リストを保存しました';
                await writeLog('info', 'emoji_difference', info_message, null, null);
            } catch (error) {
                const error_message = `初回絵文字リストの保存に失敗: ${error.message}`;
                await writeLog('error', 'emoji_difference', error_message, null, null);
            }
            return;
        }

        // 前回のリストを取得
        let oldEmojiList;
        
        // 文字列から配列への変換を試みる
        try {
            if (typeof emoji_list === 'string') {
                // 特殊な形式（{item1,item2,...}）を検出して配列に変換
                if (emoji_list.startsWith('{') && emoji_list.includes(',') && !emoji_list.includes(':')) {
                    console.log('特殊形式の絵文字リストを検出、配列に変換します');
                    const items = emoji_list.slice(1, -1).split(',').map(item => item.trim().replace(/"/g, ''));
                    oldEmojiList = items.map(name => ({ name }));
                } else if (emoji_list.startsWith('[')) {
                    // 既にJSON配列形式の場合
                    oldEmojiList = JSON.parse(emoji_list);
                } else {
                    // その他の形式は空配列で初期化
                    console.log('未知の形式の絵文字リスト、初期化します');
                    oldEmojiList = [];
                }
            } else if (Array.isArray(emoji_list)) {
                // 既に配列の場合はそのまま使用
                oldEmojiList = emoji_list;
            } else {
                // その他の型の場合は空配列
                oldEmojiList = [];
            }
        } catch (e) {
            console.error('絵文字リストの変換に失敗しました:', e);
            console.log('絵文字リスト内容:', emoji_list);
            oldEmojiList = [];
            const recovery_message = '絵文字リストの処理に失敗したため、リストを初期化しました';
            await writeLog('warning', 'emoji_difference', recovery_message, null, null);
        }
        
        // 新しいリストを保存（配列そのものを保存）
        await updateMultiKVoperation('memorandum', new_emoji_list, 'emoji_list');

        // 差分を検出する
        let addedEmojis = [];
        if (Array.isArray(oldEmojiList) && Array.isArray(new_emoji_list)) {
            // デバッグ情報を記録
            console.log(`oldEmojiList(${oldEmojiList.length}件)の例:`, oldEmojiList.slice(0, 3));
            console.log(`new_emoji_list(${new_emoji_list.length}件)の例:`, new_emoji_list.slice(0, 3));
            
            // 構造の違いを確認
            const oldIsObjectArray = oldEmojiList.length > 0 && typeof oldEmojiList[0] === 'object';
            const newIsStringArray = new_emoji_list.length > 0 && typeof new_emoji_list[0] === 'string';
            
            console.log('構造の違い:', { oldIsObjectArray, newIsStringArray });
            
            // 古いリストの絵文字名のセットを作成（構造の違いに対応）
            const oldEmojiNameSet = new Set(
                oldIsObjectArray 
                    ? oldEmojiList.map(emoji => emoji.name)
                    : oldEmojiList
            );
            
            // 新しいリストから追加された絵文字を検出（構造の違いに対応）
            addedEmojis = newIsStringArray
                ? new_emoji_list.filter(name => !oldEmojiNameSet.has(name))
                    .map(name => ({ name }))  // 表示用にオブジェクト形式に変換
                : new_emoji_list.filter(emoji => !oldEmojiNameSet.has(emoji.name));
            
            console.log(`検出された新しい絵文字: ${addedEmojis.length}件`);
            
            
            if (addedEmojis.length > 0) {
                let messageLines = ['新しい絵文字が追加されました！'];
                
                // 各絵文字の詳細情報を取得して整形
                for (const emoji of addedEmojis) {
                    const emojiName = typeof emoji === 'string' ? emoji : emoji.name;
                    
                    // 詳細情報を取得
                    const emojiDetails = await getMisskeyEmojiListSingle(emojiName);
                    
                    if (emojiDetails) {
                        const aliases = emojiDetails.aliases && emojiDetails.aliases.length > 0 
                            ? emojiDetails.aliases.join(', ')
                            : 'なし';
                        
                        messageLines.push(`:${emojiName}: 登録名：「${emojiName}」`);
                    } else {
                        // 詳細が取得できなかった場合はシンプルな表示
                        messageLines.push(`:${emojiName}: 登録名：「${emojiName}」`);
                    }
                }
                
                const fullMessage = messageLines.join('\n');
                
                // メッセージが3000文字を超える場合は分割して送信
                if (fullMessage.length > 3000) {
                    const messageParts = [];
                    let currentPart = '';
                    
                    // メッセージを行ごとに分割
                    for (const line of messageLines) {
                        // この行を追加すると3000文字を超える場合、新しいパートを開始
                        if (currentPart.length + line.length + 1 > 3000) {
                            messageParts.push(currentPart);
                            currentPart = line;
                        } else {
                            // 最初の行でなければ改行を追加
                            if (currentPart.length > 0) {
                                currentPart += '\n' + line;
                            } else {
                                currentPart = line;
                            }
                        }
                    }
                    
                    // 最後のパートを追加
                    if (currentPart.length > 0) {
                        messageParts.push(currentPart);
                    }
                    
                    // 各パートを順番に送信
                    for (let i = 0; i < messageParts.length; i++) {
                        const partMessage = `${messageParts[i]}\n(${i+1}/${messageParts.length})`;
                        await createNote(partMessage);
                    }
                } else {
                    // 3000文字以下の場合はそのまま送信
                    await createNote(fullMessage);
                }
                
                const info_message = `${addedEmojis.length}個の新しい絵文字を検出しました`;
                await writeLog('info', 'emoji_difference', info_message, null, null);
            } else {
                const info_message = '新しい絵文字はありませんでした';
                await writeLog('info', 'emoji_difference', info_message, null, null);
            }
        } else {
            console.error('絵文字リストの形式が不正です', { 
                oldEmojiListIsArray: Array.isArray(oldEmojiList),
                new_emoji_listIsArray: Array.isArray(new_emoji_list)
            });
            const error_message = '絵文字リストの形式が不正です';
            await writeLog('error', 'emoji_difference', error_message, null, null);
        }

        const emojis = addedEmojis.length > 0 ? addedEmojis : null;
        if (emojis) {
            console.log('絵文字取得成功:', emojis);
        } else {
            console.log('絵文字取得なし');
        }

    } catch (error) {
        console.error('絵文字取得エラー:', error);
        await writeLog('error', 'emoji_difference', `絵文字取得エラー: ${error.message}`, null, null);
    }
}




async function test_python_connect(endpoint) {
    try {
        const response = await axios.get(`http://python-afm:3000${endpoint}`);
        
        if (response.data && response.data.text) {
            const message = `${response.data.text}\n\n<small>(これは自動生成です。不適切な投稿は管理者@takumin3211までお伝え下さい)</small>`;
            await sendDM(message);
            
            const info_message = 'Python生成テキストの投稿を実行';
            await writeLog('info', 'test_python_connect', info_message, null, null);
        } else {
            throw new Error('テキストデータが見つかりません');
        }
    } catch (error) {
        const error_message = `Python接続エラー: ${error.message}`;
        await writeLog('error', 'test_python_connect', error_message, null, null);
        console.error(error_message);
    }
}

async function think_Dinner() {
    const dinner = await getRandomDinner();
    if (dinner) {
        // 0-30分のランダムな待機時間を設定
        
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 31) * 60 * 1000));
        if (Math.random() < 0.1) {
            const message = "はわわっ……\nおやつを食べ過ぎてしまいました。。\n\n今夜はお腹いっぱいです＞＜"
            const result = await createNote(message);
            const Note_Text = '満腹'
            await updateMultiMemorandum('dinner', Note_Text);
            return;
        }
        const Note_Text = await getRandomNoteText(`dinner_text`);
        const message = `${Note_Text}\n\n今夜の献立はこちら！\n『${dinner}』`;
        // メモランダムテーブルにNote_Textを保存
        await updateMultiMemorandum('dinner', dinner);
        const result = await createNote(message);
        const info_message = '夕食の投稿を実行';
        await writeLog('info', 'think_Dinner', info_message, null, null);
    } else {
        const error_message = '献立の取得に失敗しました';
        await writeLog('error', 'think_Dinner', error_message, null, null);
    }
}

async function test(endpoint) {
    try {
        const response = await axios.get(`http://python-afm:3000${endpoint}`);
        
        if (response.data && response.data.text) {
            const message = `${response.data.text}`;
            await sendDM(message);
            // \n\n<i><small>(これは自動生成です。不適切な場合は@takumin3211までお伝え下さい)</small></i>
            // const info_message = 'Python生成テキストの投稿を実行';
            // await writeLog('info', 'python_connect', info_message, null, null);
        } else {
            throw new Error('テキストデータが見つかりません');
        }
    } catch (error) {
        const error_message = `Python接続エラー: ${error.message}`;
        await writeLog('error', 'python_connect', error_message, null, null);
        console.error(error_message);
    }
}

// WebSocketの状態をチェックしてログに記録する関数
async function checkWebSocketConnections() {
    try {
        // WebSocketの状態を取得
        const status = checkWebSocketStatus();
        
        // 各接続の状態をログに記録
        const logMessages = [];
        let allConnected = true;
        
        for (const [type, info] of Object.entries(status)) {
            const connectionStatus = info.connected ? '正常に接続中' : `未接続 (状態: ${info.state})`;
            logMessages.push(`${type}: ${connectionStatus}, 再試行回数: ${info.retryCount}`);
            
            if (!info.connected) {
                allConnected = false;
            }
        }
        
        // ログメッセージを作成
        const summary = allConnected ? 
            'すべてのWebSocket接続は正常に機能しています' : 
            '一部のWebSocket接続に問題があります';
        
        await writeLog('info', 'checkWebSocketConnections', 
            `WebSocket接続状態の定期チェック: ${summary}\n${logMessages.join('\n')}`, null, null);
        
        console.log('WebSocket接続状態の定期チェック完了:', summary);
        
        // 問題がある場合は再接続を試みる
        if (!allConnected) {
            if (!status.hybrid.connected) {
                console.log('hybrid WebSocket接続を再確立します...');
                await connectWebSocket_hybrid();
            }
            if (!status.global.connected) {
                console.log('global WebSocket接続を再確立します...');
                await connectWebSocket_global();
            }
            if (!status.main.connected) {
                console.log('main WebSocket接続を再確立します...');
                await connectWebSocket_main();
            }
            
            await writeLog('info', 'checkWebSocketConnections', 
                '切断されたWebSocket接続の再確立を試みました', null, null);
        }
    } catch (error) {
        const errorMessage = `WebSocket状態チェック中にエラーが発生しました: ${error.message}`;
        console.error(errorMessage);
        await writeLog('error', 'checkWebSocketConnections', errorMessage, null, null);
    }
}

app.get('/', (req, res) => {
        const acceptHeader = req.headers.accept || '';
        const isHtmlRequest = acceptHeader.includes('text/html');
        
        const endpoints = [
            {
                path: '/webhook/earthquake',
                method: 'POST',
                description: '地震データの通知を受信',
                parameters: ['sensor_id', 'measure_scale', 'JMA_scale', 'resultant_gal', 'gal_x', 'gal_y', 'gal_z']
            },
            {
                path: '/webhook/temperature',
                method: 'POST',
                description: '温度データの通知を受信',
                parameters: ['temperature', 'timestamp', 'alert']
            },
            {
                path: '/webhook/pressure',
                method: 'POST',
                description: '気圧データの通知を受信',
                parameters: ['pressure', 'trend', 'location', 'timestamp', 'alert']
            },
            {
                path: '/webhook/scheduled',
                method: 'POST',
                description: '定時データの受信',
                parameters: ['sensor_id', 'temperature', 'pressure']
            },
            {
                path: '/webhook/monitoring',
                method: 'POST',
                description: '死活監視データの受信',
                parameters: ['sensor_id', 'temperature', 'pressure']
            },
            {
                path: '/webhook/general',
                method: 'POST',
                description: '汎用ウェブフックデータの受信',
                parameters: ['任意のデータ']
            },
            {
                path: '/webhook/health',
                method: 'GET',
                description: 'ヘルスチェック',
                parameters: []
            }
        ];
        
        if (isHtmlRequest) {
            // ブラウザからのアクセス時はHTMLを返す
            const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Webhook API ヘルプ</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background-color: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 2px solid #007acc; padding-bottom: 10px; }
        h2 { color: #555; margin-top: 30px; }
        .endpoint { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #007acc; }
        .method { font-weight: bold; color: #007acc; }
        .path { font-family: monospace; background: #e9ecef; padding: 2px 6px; border-radius: 3px; }
        .params { margin-top: 10px; }
        .param { display: inline-block; background: #e7f3ff; padding: 2px 6px; margin: 2px; border-radius: 3px; font-size: 0.9em; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔗 Webhook API ヘルプ</h1>
        <p>このサーバーは各種センサーデータやイベントの通知を受信するWebhook APIを提供しています。</p>
        
        <h2>📋 利用可能なエンドポイント</h2>
        ${endpoints.map(endpoint => `
        <div class="endpoint">
            <div>
                <span class="method">${endpoint.method}</span>
                <span class="path">${endpoint.path}</span>
            </div>
            <div style="margin-top: 5px; color: #666;">${endpoint.description}</div>
            ${endpoint.parameters.length > 0 ? `
            <div class="params">
                <strong>パラメータ:</strong>
                ${endpoint.parameters.map(param => `<span class="param">${param}</span>`).join('')}
            </div>
            ` : ''}
        </div>
        `).join('')}
        
        <h2>📝 使用例</h2>
        <div class="endpoint">
            <strong>温度データの送信例:</strong>
            <pre style="background: #f8f9fa; padding: 10px; margin-top: 10px; overflow-x: auto;">
curl -X POST http://localhost:5000/webhook/temperature \\
  -H "Content-Type: application/json" \\
  -d '{
    "temperature": 25.5,
    "timestamp": "2025-07-02T12:00:00Z",
    "alert": false
  }'</pre>
        </div>
        
        <div class="footer">
            <p>最終更新: ${new Date().toISOString()}</p>
            <p>サーバー稼働中 🟢</p>
        </div>
    </div>
</body>
</html>`;
            res.send(html);
        } else {
            // API呼び出し時はJSONを返す
            res.json({
                title: 'Webhook API ヘルプ',
                description: 'このサーバーは各種センサーデータやイベントの通知を受信するWebhook APIを提供しています。',
                server_status: 'running',
                timestamp: new Date().toISOString(),
                endpoints: endpoints
            });
        }
    });
    

const port = 5000;


// ウェブフックルートの設定
setupWebhookRoutes(app);
console.log('ウェブフックルートが設定されました');
await writeLog('info', 'main', 'ウェブフックルートが設定されました', null, null);

const server = http.createServer(app);

server.listen(port, () => {
    console.log(`Express app listening on port ${port}`);
    console.log('ウェブフック受信可能なエンドポイント:');
    console.log('- POST /webhook/earthquake (地震センサー)');
    console.log('- POST /webhook/temperature (温度センサー)');
    console.log('- POST /webhook/pressure (気圧センサー)');
    console.log('- POST /webhook/scheduled (定時データ)');
    console.log('- POST /webhook/general (汎用)');
    console.log('- GET /webhook/health (ヘルスチェック)');

    // サーバー起動後にスケジューラーを開始
});


async function main() {
    try {
        // WebSocket接続
        await connectWebSocket_hybrid();
        await connectWebSocket_main();
        await connectWebSocket_global();
        // 投稿関連のスケジュール

        schedule.scheduleJob({scheduleOptions, rule: '0 7 * * *'}, morning_greeting);
        schedule.scheduleJob({scheduleOptions, rule: '30 7 * * *'}, breakfast);
        schedule.scheduleJob({scheduleOptions, rule: '0 8 * * *'}, () => python_connect('/generate/text'));
        schedule.scheduleJob({scheduleOptions, rule: '0 9 * * *'}, () => multi_feed_v2('https://trafficnews.jp/feed'));
        schedule.scheduleJob({scheduleOptions, rule: '0 10 * * *'}, () => python_connect('/generate/text'));
        schedule.scheduleJob({scheduleOptions, rule: '30 11 * * *'}, () => multi_feed_v2('https://gourmet.watch.impress.co.jp/data/rss/1.0/grw/feed.rdf'));
        schedule.scheduleJob({scheduleOptions, rule: '0 12 * * *'}, () => multi_feed_v2('https://gigazine.net/news/rss_2.0/'));
        schedule.scheduleJob({scheduleOptions, rule: '0 13 * * *'}, () => python_connect('/generate/text'));
        schedule.scheduleJob({scheduleOptions, rule: '0 14 * * *'}, () => multi_feed_v2('https://sorae.info/feed'));
        schedule.scheduleJob({scheduleOptions, rule: '0 15 * * *'}, () => python_connect('/generate/text'));
        schedule.scheduleJob({scheduleOptions, rule: '0 16 * * *'}, () => multi_feed_v2('https://www.publickey1.jp/atom.xml'));
        schedule.scheduleJob({scheduleOptions, rule: '0 17 * * *'}, () => python_connect('/generate/text'));
        schedule.scheduleJob({scheduleOptions, rule: '0 18 * * *'}, () => multi_feed_v2('https://www.gamespark.jp/rss20/index.rdf'));
        schedule.scheduleJob({scheduleOptions, rule: '30 18 * * *'}, bathing);
        schedule.scheduleJob({scheduleOptions, rule: '0 19 * * *'}, think_Dinner);
        schedule.scheduleJob({scheduleOptions, rule: '0 20 * * *'}, () => python_connect_wordcloud('/generate/wordcloud'));
        schedule.scheduleJob({scheduleOptions, rule: '30 20 * * *'}, () => python_connect('/generate/text'));
        schedule.scheduleJob({scheduleOptions, rule: '0 21 * * *'}, () => multi_feed_v2('https://automaton-media.com/feed/'));
        schedule.scheduleJob({scheduleOptions, rule: '30 21 * * *'}, emoji_difference);
        schedule.scheduleJob({scheduleOptions, rule: '0 22 * * *'}, night_greeting);
        
        // WebSocketの状態を毎日23時にチェック
        schedule.scheduleJob({scheduleOptions, rule: '0 23 * * *'}, checkWebSocketConnections);
        
        // schedule.scheduleJob({scheduleOptions, rule: '20 23 * * *'}, () => test('test'));
        // python_connect_wordcloud('/generate/wordcloud')
        // 毎日3時にheatカウンターをリセット
        // test(`/generate/text`);
        schedule.scheduleJob('0 3 * * *', async () => {const result = await executeMaintenance();});
        // await test('https://gourmet.watch.impress.co.jp/data/rss/1.0/grw/feed.rdf')


        // 本番運用ではDMを送信する。sendDM("なんか起動したみたいですよ");

        
        //const renote_result = await createMisskeyRenote(`a8u4ldhsw3`)
        //const scrapingResult = await getScraping(`https://gigazine.net/news/20250613-nvidia-tensorrt/`, true); // { title, mainContent } を期待
        if (scrapingResult) {
            console.log('Scraping successful:', scrapingResult);
            await writeLog('info', 'main', `Scraping successful: ${JSON.stringify(scrapingResult)}`, null, null);
        } else {
            console.log('Scraping failed');
            await writeLog('error', 'main', `Scraping failed`, null, null);
        }


        console.log("起動しました（ウェブフック受信機能付き）");
        //await multi_feed_v2('https://trafficnews.jp/feed');
        await writeLog('info', 'main', `起動しました（ウェブフック受信機能付き）- ポート${port}で待機中`, null, null);
    } catch (error) {
        const error_message = `エラーが発生しました: ${error.message}`;
        console.error(error_message);
        await writeLog('error', 'main', error_message, null, null);
    }
}

// スクリプト実行
main();
