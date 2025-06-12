import { config } from 'dotenv';
import OpenAI from 'openai';
import { writeLog } from '../db_operation/create_logs.js';
import axios from 'axios';
import { sendDM, createNote, createNoteWithMedia } from '../misskey_operation/create_note.js';
import {createMisskeyRenote} from '../misskey_operation/create_renote.js';
import { updateMultiKVoperation, getMultiKVoperation } from '../db_operation/multi_db_connection.js';


config();

// OLLAMA APIのURLを環境変数から取得するか、デフォルト値を設定
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || '192.168.0.176:11434';





async function air_reply_ollama(input_text,note_id) {
    try {
        // Heatによる暴走抑止の処理
        const currentHeat = await getMultiKVoperation('protection', 'air_reply_heat');
        const maxHeat = await getMultiKVoperation('settings', 'max_air_reply_heat');
        if (Number(maxHeat) !== null && Number(currentHeat) > Number(maxHeat)) {
            const error_message = `投稿回数が制限(${maxHeat}回)を超えました。\n現在のHeat値は${currentHeat}です`;
            await writeLog('error', 'summary_ollama', error_message, null, null); 
            return null;
        }

        // 頻回なエアリプ投稿を防ぐための時間制限
        const air_reply_check_neer = await getMultiKVoperation('memorandum', 'air_reply_check_neer');
        const now = new Date();
        const neerTime = new Date(air_reply_check_neer);
        if (!isNaN(neerTime.getTime()) && now < neerTime) {
            // air_reply_check_neerが有効な日付として設定されていて、現在時刻がその時刻より前の場合
            const info_message = `エアリプ投稿はまだ許可されていません（次回許可時刻: ${air_reply_check_neer}）`;
            await writeLog('info', 'air_reply_ollama', info_message, null, null);
            return null;
        } else if (isNaN(neerTime.getTime())) {
            // air_reply_check_neerが設定されていない場合
            // 次回のエアリプ投稿許可時刻を4時間後に設定
            const nextNeerTime = new Date(now.getTime() + 4 * 60 * 60 * 1000);
            await updateMultiKVoperation('memorandum', nextNeerTime.toISOString(), 'air_reply_check_neer');
            const info_message = `air_reply_check_neerを4時間後に設定しました（次回許可時刻: ${nextNeerTime.toISOString()}）`;
            await writeLog('info', 'air_reply_ollama', info_message, null, null);
            return null;
        }


        // Renoteを実行する
        let renote_result = await createMisskeyRenote(note_id);
        if (!renote_result) {
            const error_message = `Renoteの実行に失敗しました: note_id=${note_id}`;
            await writeLog('error', 'air_reply_ollama', error_message, null, null);
            return null;
        } else {
            const info_message = `Renoteの実行に成功: note_id=${note_id}`;
            await writeLog('info', 'air_reply_ollama', info_message, null, null);
        }

        // 0-5分のランダムな待機時間を設定
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 6) * 60 * 1000));
        // システムプロンプトの作成
        const system_prompt = `
あなたはSNS上で人間らしく振る舞うための小規模言語モデルです。以下の条件に従って、投稿に対する「エアリプ」を出力してください。

- 入力される投稿は引用符（「」）で囲まれた文章です。
- その投稿に対する、間接的・非明示的な反応を1文で出力してください。
- 投稿の内容を明示的に引用したり、話題に直接触れたりしないでください。
- 投稿から類推される経験・事例・感想・違和感・疑問などを、間接的に言及してください。
- 出力は50字以内に収めてください。
- 丁寧語は禁止です（例：「です」「ます」などは使わない）。
- 出力は1文のみで、余計な装飾や文頭の記号などはつけないこと。
`;


        
        // OllamaのAPI仕様に合わせたリクエストボディを作成
        const requestBody = {
            model: "phi4",
            messages: [
                {
                    role: "system",
                    content: system_prompt
                },
                {
                    role: "user",
                    content: `「${input_text}」`
                }
            ],
            stream: false
        };

        // OLLAMA_API_URLへの疎通確認
        const accessURL = `http://${OLLAMA_API_URL}/api/chat`;
        try {
            await axios.post(accessURL);
            console.log(`Ollama APIへの疎通確認に成功: ${accessURL}`);
        } catch (connErr) {
            console.error(`Ollama APIへの疎通確認に失敗: ${accessURL} - ${connErr.message}`);
            //throw new Error('Ollama APIへの接続に失敗しました');
        }        

        // API呼び出し開始時間
        const startTime = performance.now();

        // Ollamaサーバーに対してPOSTリクエストを送信
        const response = await axios.post(accessURL, requestBody);

        // Heat値を更新
        const newHeat = Number(currentHeat) + 1;
        await updateMultiKVoperation('protection', newHeat, 'air_reply_heat');
        // air_reply_check_neerを4時間後に更新
        const nextNeerTime = new Date(now.getTime() + 4 * 60 * 60 * 1000);
        await updateMultiKVoperation('memorandum', nextNeerTime.toISOString(), 'air_reply_check_neer');

        // API呼び出し終了時間
        const endTime = performance.now();
        const duration = endTime - startTime; // 処理時間（ミリ秒）

        // レスポンスからテキストを取得
        if (response.data && response.data.message && response.data.message.content) {
            const message = response.data.message.content.trim();
            await createNote(message);
            
            const info_message = `Ollama生成テキストの投稿を実行 (処理時間: ${duration.toFixed(2)}ms)`;
            await writeLog('info', 'ollama_connect', info_message, null, null);
        } else {
            throw new Error('有効なレスポンスデータが見つかりません');
        }
    }
    catch (error) {
        const error_message = `Ollama接続エラー: ${error.message}`;
        await writeLog('error', 'ollama_connect', error_message, null, null);
        console.error(error_message);
    }
}



async function summary_ollama(input_text) {
    try {
        // システムプロンプトの作成
        const system_prompt = `
あなたは人間らしく振る舞うための小規模言語モデルです。以下の条件に従って、記事を要約してください。

- 出力は50字以内に収めてください。
- 丁寧語は禁止です（例：「です」「ます」などは使わない）。
- 出力は1文のみで、余計な装飾や文頭の記号などはつけないこと。
`;

        const requestBody = {
            model: "hf.co/SakanaAI/TinySwallow-1.5B-Instruct-GGUF:latest",
            messages: [
                {
                    role: "system",
                    content: system_prompt
                },
                {
                    role: "user",
                    content: `「${input_text}」`
                }
            ],
            stream: false
        };

        const accessURL = `http://${OLLAMA_API_URL}/api/chat`;
        try {
            await axios.post(accessURL);
            console.log(`Ollama APIへの疎通確認に成功: ${accessURL}`);
        } catch (connErr) {
            console.error(`Ollama APIへの疎通確認に失敗: ${accessURL} - ${connErr.message}`);
        }

        let message = null;
        let duration = 0;
        let attempts = 0;
        const maxAttempts = 3; // 初回＋2回まで

        while (attempts < maxAttempts) {
            attempts++;
            const startTime = performance.now();
            const response = await axios.post(accessURL, requestBody);
            const endTime = performance.now();
            duration = endTime - startTime;

            if (response.data && response.data.message && response.data.message.content) {
                message = response.data.message.content.trim();
                if (message.length < 100) {
                    break;
                } else {
                    await writeLog('warn', 'summary_ollama', `要約が100字以上のため再生成を試みます（${attempts}回目）`, null, null);
                }
            } else {

                throw new Error('有効なレスポンスデータが見つかりません');
            }
        }

        if (message && message.length < 100) {
            const info_message = `Ollama要約生成を実行 (処理時間: ${duration.toFixed(2)}ms)`;
            await writeLog('info', 'summary_ollama', info_message, null, null);
            return message;
        } else {
            const warn_message = `Ollama要約生成で100字未満の要約が得られませんでした（${attempts}回試行）`;
            await writeLog('warn', 'summary_ollama', warn_message, null, null);
            return null;
        }
    }
    catch (error) {
        const error_message = `Ollama接続エラー (summary_ollama): ${error.message}`;
        await writeLog('error', 'summary_ollama', error_message, null, null);
        console.error(error_message);
        return null;
    }
}

export {
    air_reply_ollama,
    summary_ollama
};